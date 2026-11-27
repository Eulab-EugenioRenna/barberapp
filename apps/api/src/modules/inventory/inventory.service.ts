import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Prisma, InventoryOperation } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { lockOperationalTenant } from "../../common/operational-lock";
import type { OperationalScope } from "../locations/operational-scope";
import { decimalInput } from "../pricing/money";
import { quoteReceipt, valueStockChange } from "./stock-valuation";
import type { InventoryCommandDto } from "./inventory-command.dto";

type Tx = Prisma.TransactionClient;
const INVENTORY_REASONS: Record<InventoryCommandDto["kind"], string> = {
  opening: "Giacenza iniziale",
  receipt: "Carico di magazzino",
  issue: "Scarico di magazzino",
  adjust: "Rettifica inventario",
  transfer: "Trasferimento tra sedi",
  return: "Reso a magazzino",
};
type MovementInput = {
  locationId: string;
  productId: string;
  kind: string;
  quantity: string;
  direction: "in" | "out";
  incomingValue?: string;
  opening?: boolean;
  sectorId?: string;
  saleId?: string;
  saleItemId?: string;
  origin?: Prisma.InputJsonValue;
  returnOfId?: string;
  purchaseVatRate?: string;
  purchaseTax?: string;
};
@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  private fingerprint(value: unknown) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }

  async requireLocations(
    scope: OperationalScope,
    ids: string[],
    selected = true,
  ) {
    const allowed = await this.prisma.sector.findMany({
      where: {
        tenantId: scope.tenantId,
        id: { in: selected ? scope.sectorIds : scope.allowedSectorIds },
      },
      select: { locationId: true },
    });
    if (ids.some((id) => !allowed.some((row) => row.locationId === id)))
      throw new ForbiddenException("Sede di magazzino non accessibile");
  }

  async balances(scope: OperationalScope, locationId: string) {
    await this.requireLocations(scope, [locationId]);
    const [products, balances] = await Promise.all([
      this.prisma.product.findMany({
        where: { tenantId: scope.tenantId, stockTracked: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, sku: true, isActive: true },
      }),
      this.prisma.stockBalance.findMany({
        where: { tenantId: scope.tenantId, locationId },
      }),
    ]);
    return products.map((product) => {
      const balance = balances.find((row) => row.productId === product.id);
      return {
        ...product,
        locationId,
        initialized: balance?.initialized ?? false,
        quantity: balance?.initialized ? balance.quantity.toFixed(3) : null,
        value: balance?.initialized ? balance.value.toFixed(6) : null,
        averageCost: balance?.initialized
          ? balance.quantity.isZero()
            ? "0.000000"
            : balance.value.dividedBy(balance.quantity).toFixed(6)
          : null,
      };
    });
  }

  async movements(
    scope: OperationalScope,
    locationId: string,
    page = 1,
    productId?: string,
  ) {
    await this.requireLocations(scope, [locationId]);
    const where = {
      tenantId: scope.tenantId,
      locationId,
      OR: [{ sectorId: null }, { sectorId: { in: scope.sectorIds } }],
      ...(productId ? { productId } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * 50,
        take: 50,
        include: {
          operation: {
            select: { kind: true, actorUserId: true, reason: true },
          },
          product: { select: { name: true, sku: true } },
          returns: { select: { quantityDelta: true } },
        },
      }),
      this.prisma.stockMovement.count({ where }),
    ]);
    return {
      items: items.map(({ returns, ...row }) => ({
        ...row,
        returnableQuantity: row.quantityDelta.isNegative()
          ? Prisma.Decimal.max(
              row.quantityDelta
                .abs()
                .minus(
                  returns.reduce(
                    (sum, r) => sum.plus(r.quantityDelta),
                    new Prisma.Decimal(0),
                  ),
                ),
              0,
            ).toFixed(3)
          : "0.000",
      })),
      total,
      page,
      pageSize: 50,
      hasMore: page * 50 < total,
    };
  }

  /** Net unit cost of the latest load, then the product cost, then zero. */
  private async lastUnitCost(
    tx: Tx,
    tenantId: string,
    locationId: string,
    productId: string,
  ) {
    const last = await tx.stockMovement.findFirst({
      where: {
        tenantId,
        productId,
        locationId,
        quantityDelta: { gt: 0 },
        kind: { in: ["opening", "receipt", "adjust_in", "transfer_in"] },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    if (last && last.quantityDelta.greaterThan(0))
      return last.valueDelta
        .dividedBy(last.quantityDelta)
        .toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP)
        .toFixed(6);
    const product = await tx.product.findFirst({
      where: { id: productId, tenantId },
      select: { cost: true },
    });
    return (product?.cost ?? new Prisma.Decimal(0)).toFixed(6);
  }

  private async productName(tx: Tx, productId: string) {
    return (
      (
        await tx.product.findUnique({
          where: { id: productId },
          select: { name: true },
        })
      )?.name ?? "Prodotto"
    );
  }

  /**
   * Called inside a tenant-locked transaction. Movement and balance always commit together.
   * Never blocks a sale: an unknown balance starts from zero and an issue above the
   * stock takes what is there (warning in `warnings`). Returns null when nothing moved.
   */
  async movement(
    tx: Tx,
    operation: InventoryOperation,
    input: MovementInput,
    warnings: string[] = [],
  ) {
    let balance = await tx.stockBalance.upsert({
      where: {
        locationId_productId: {
          locationId: input.locationId,
          productId: input.productId,
        },
      },
      create: {
        tenantId: operation.tenantId,
        locationId: input.locationId,
        productId: input.productId,
      },
      update: {},
    });
    if (!balance.initialized && !input.opening) {
      // No opening recorded yet: the balance starts from zero.
      await this.movement(tx, operation, {
        locationId: input.locationId,
        productId: input.productId,
        kind: "opening",
        direction: "in",
        quantity: "0.000",
        incomingValue: "0.000000",
        opening: true,
      });
      balance = await tx.stockBalance.findUniqueOrThrow({
        where: { id: balance.id },
      });
    }
    if (input.direction === "out") {
      const wanted = new Prisma.Decimal(input.quantity);
      if (wanted.greaterThan(balance.quantity)) {
        const name = await this.productName(tx, input.productId);
        const available = balance.quantity;
        warnings.push(
          available.isZero()
            ? `${name}: giacenza esaurita, scarico di ${wanted.toFixed(0)} non registrato`
            : `${name}: giacenza insufficiente, scaricate ${available.toFixed(0)} unità su ${wanted.toFixed(0)}`,
        );
        if (available.lte(0)) return null;
        input = { ...input, quantity: available.toFixed(3) };
      }
    }
    let valued: ReturnType<typeof valueStockChange>;
    try {
      valued = valueStockChange(
        {
          initialized: balance.initialized,
          quantity: balance.quantity.toFixed(3),
          value: balance.value.toFixed(6),
        },
        input,
      );
    } catch (error) {
      if (error instanceof Error && error.constructor === Error)
        throw new BadRequestException(error.message);
      throw error;
    }
    const record = await tx.stockMovement.create({
      data: {
        tenantId: operation.tenantId,
        operationId: operation.id,
        locationId: input.locationId,
        productId: input.productId,
        kind: input.kind,
        sectorId: input.sectorId,
        saleId: input.saleId,
        saleItemId: input.saleItemId,
        origin: input.origin,
        returnOfId: input.returnOfId,
        purchaseVatRate: input.purchaseVatRate,
        purchaseTax: input.purchaseTax,
        quantityDelta: valued.quantityDelta,
        valueDelta: valued.valueDelta,
        quantityAfter: valued.quantity,
        valueAfter: valued.value,
      },
    });
    await tx.stockBalance.update({
      where: { id: balance.id },
      data: {
        quantity: valued.quantity,
        value: valued.value,
        initialized: true,
        version: { increment: 1 },
      },
    });
    return record;
  }

  /** «Annulla vendita»: every unit still out for the sale comes back as a return. */
  async reverseOrder(
    tx: Tx,
    saleId: string,
    actorUserId: string,
    reason: string,
  ) {
    const sale = await tx.sale.findUniqueOrThrow({ where: { id: saleId } });
    const movements = await tx.stockMovement.findMany({
      where: { tenantId: sale.tenantId, saleId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const open = movements.flatMap((source) => {
      if (!source.quantityDelta.isNegative()) return [];
      const returns = movements.filter((row) => row.returnOfId === source.id);
      const quantity = source.quantityDelta
        .abs()
        .minus(
          returns.reduce((sum, row) => sum.plus(row.quantityDelta), new Prisma.Decimal(0)),
        );
      const value = source.valueDelta
        .abs()
        .minus(
          returns.reduce((sum, row) => sum.plus(row.valueDelta), new Prisma.Decimal(0)),
        );
      return quantity.greaterThan(0) ? [{ source, quantity, value }] : [];
    });
    if (!open.length) return 0;
    const key = `order:${saleId}:cancel:${sale.revision}`;
    const operation = await tx.inventoryOperation.create({
      data: {
        tenantId: sale.tenantId,
        idempotencyKey: key,
        fingerprint: this.fingerprint({ saleId, cancel: sale.revision }),
        kind: "return",
        actorUserId,
        reason,
      },
    });
    const records = [];
    for (const { source, quantity, value } of open)
      records.push(
        await this.movement(tx, operation, {
          locationId: source.locationId,
          productId: source.productId,
          sectorId: source.sectorId ?? undefined,
          saleId,
          saleItemId: source.saleItemId ?? undefined,
          kind: "return",
          direction: "in",
          quantity: quantity.toFixed(3),
          incomingValue: Prisma.Decimal.max(value, 0).toFixed(6),
          returnOfId: source.id,
          origin: { saleId, cancelled: true },
        }),
      );
    await tx.inventoryOperation.update({
      where: { id: operation.id },
      data: {
        result: {
          movementIds: records.flatMap((row) => (row ? [row.id] : [])),
        },
      },
    });
    return records.length;
  }

  /** Same transaction as order confirmation. Legacy rows never create retroactive stock. */
  async postOrder(
    tx: Tx,
    saleId: string,
    actorUserId: string,
  ): Promise<string[]> {
    const warnings: string[] = [];
    const sale = await tx.sale.findUniqueOrThrow({
      where: { id: saleId },
      include: {
        items: { include: { booking: { select: { status: true } } } },
      },
    });
    if (sale.orderStatus !== "confirmed") return warnings;
    const movements = await tx.stockMovement.findMany({
      where: { tenantId: sale.tenantId, saleId },
    });
    const pending = sale.items.filter((row) => row.stockState !== "legacy");
    if (!pending.length && !movements.length) return warnings;
    const key = `order:${saleId}:revision:${sale.revision}`;
    const fingerprint = this.fingerprint({ saleId, revision: sale.revision });
    const prior = await tx.inventoryOperation.findUnique({
      where: {
        tenantId_idempotencyKey: {
          tenantId: sale.tenantId,
          idempotencyKey: key,
        },
      },
    });
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new ConflictException("Revisione inventario incoerente");
      return warnings;
    }
    if (
      !movements.length &&
      ["cancelled", "refunded"].includes(sale.paymentStatus)
    )
      return warnings;
    const operation = await tx.inventoryOperation.create({
      data: {
        tenantId: sale.tenantId,
        idempotencyKey: key,
        fingerprint,
        kind: "order",
        actorUserId,
        reason: `Movimenti del conto ${sale.id}, revisione ${sale.revision}`,
      },
    });
    type Requirement = { productId: string; units: string; kind: string };
    const target = new Map<
      string,
      {
        rowId: string;
        productId: string;
        quantity: Prisma.Decimal;
        kind: string;
        sectorId: string;
      }
    >();
    const nonPerformed = new Set(
      sale.items
        .filter(
          (row) =>
            row.booking &&
            ["cancelled", "no_show"].includes(row.booking.status),
        )
        .map((row) => row.id),
    );
    for (const row of pending) {
      if (nonPerformed.has(row.id)) continue;
      let requirements: Requirement[] = [];
      const old = row.inventoryRequirements as {
        serviceId?: string | null;
        productId?: string | null;
        requirements?: Requirement[];
      } | null;
      if (
        old &&
        old.serviceId === row.serviceId &&
        old.productId === row.productId &&
        Array.isArray(old.requirements)
      )
        requirements = old.requirements;
      else {
        if (
          row.productId &&
          (await tx.product.count({
            where: {
              id: row.productId,
              tenantId: sale.tenantId,
              stockTracked: true,
            },
          }))
        )
          requirements.push({
            productId: row.productId,
            units: "1.000",
            kind: "sale",
          });
        if (row.serviceId) {
          const links = await tx.serviceProduct.findMany({
            where: {
              serviceId: row.serviceId,
              consumptionUnits: { not: null },
              product: { tenantId: sale.tenantId, stockTracked: true },
            },
          });
          requirements.push(
            ...links.map((link) => ({
              productId: link.productId,
              units: link.consumptionUnits!.toFixed(3),
              kind: "consumption",
            })),
          );
        }
        await tx.saleItem.update({
          where: { id: row.id },
          data: {
            inventoryRequirements: {
              serviceId: row.serviceId,
              productId: row.productId,
              requirements,
            },
            stockState: "posted",
          },
        });
      }
      for (const req of requirements) {
        const k = `${row.id}:${req.productId}`;
        const previous = target.get(k);
        target.set(k, {
          rowId: row.id,
          productId: req.productId,
          quantity: (previous?.quantity ?? new Prisma.Decimal(0)).plus(
            new Prisma.Decimal(req.units).times(row.quantity),
          ),
          kind: req.kind,
          sectorId: row.sectorId,
        });
      }
    }
    const posted = new Map<
      string,
      {
        rowId: string;
        productId: string;
        quantity: Prisma.Decimal;
        value: Prisma.Decimal;
        returned: Prisma.Decimal;
        sectorId: string | undefined;
      }
    >();
    for (const move of movements) {
      if (!move.saleItemId) continue;
      const k = `${move.saleItemId}:${move.productId}`;
      const current = posted.get(k) ?? {
        rowId: move.saleItemId,
        productId: move.productId,
        quantity: new Prisma.Decimal(0),
        value: new Prisma.Decimal(0),
        returned: new Prisma.Decimal(0),
        sectorId: move.sectorId ?? undefined,
      };
      current.quantity = current.quantity.minus(move.quantityDelta);
      current.value = current.value.minus(move.valueDelta);
      if (move.kind === "return")
        current.returned = current.returned.plus(move.quantityDelta);
      posted.set(k, current);
    }
    // Cancellation must neither consume unperformed services nor silently return prior issues.
    for (const [key, actual] of posted)
      if (nonPerformed.has(actual.rowId))
        target.set(key, {
          rowId: actual.rowId,
          productId: actual.productId,
          quantity: actual.quantity.plus(actual.returned),
          kind: "consumption",
          sectorId:
            actual.sectorId ||
            sale.items.find((row) => row.id === actual.rowId)!.sectorId,
        });
    const changes = [];
    for (const k of new Set([...target.keys(), ...posted.keys()])) {
      const desired = target.get(k),
        actual = posted.get(k);
      const wanted = Prisma.Decimal.max(
        (desired?.quantity ?? new Prisma.Decimal(0)).minus(
          actual?.returned ?? 0,
        ),
        0,
      );
      const difference = wanted.minus(actual?.quantity ?? 0);
      if (difference.isZero()) continue;
      const productId = desired?.productId ?? actual!.productId,
        rowId = desired?.rowId ?? actual!.rowId;
      const incoming = difference.isNegative(),
        quantity = difference.abs();
      if (incoming) {
        let remaining = quantity;
        const sources = movements
          .filter(
            (move) =>
              move.saleItemId === rowId &&
              move.productId === productId &&
              move.quantityDelta.isNegative(),
          )
          .sort(
            (a, b) =>
              b.createdAt.getTime() - a.createdAt.getTime() ||
              b.id.localeCompare(a.id),
          );
        for (const source of sources) {
          const returns = movements.filter(
            (move) => move.returnOfId === source.id,
          );
          const returned = returns.reduce(
            (sum, row) => sum.plus(row.quantityDelta),
            new Prisma.Decimal(0),
          );
          const available = source.quantityDelta.abs().minus(returned);
          if (available.lte(0)) continue;
          const taken = Prisma.Decimal.min(remaining, available);
          const returnedValue = returns.reduce(
            (sum, row) => sum.plus(row.valueDelta),
            new Prisma.Decimal(0),
          );
          const value = taken.equals(available)
            ? source.valueDelta.abs().minus(returnedValue)
            : source.valueDelta
                .abs()
                .times(taken)
                .dividedBy(source.quantityDelta.abs())
                .toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
          changes.push(
            await this.movement(tx, operation, {
              locationId: sale.locationId,
              productId,
              sectorId: source.sectorId ?? undefined,
              saleId,
              saleItemId: rowId,
              kind: "order_adjust_in",
              direction: "in",
              quantity: taken.toFixed(3),
              incomingValue: value.toFixed(6),
              returnOfId: source.id,
              origin: { saleId, saleItemId: rowId, revision: sale.revision },
            }),
          );
          remaining = remaining.minus(taken);
          if (remaining.isZero()) break;
        }
        // Units never issued (stock was short) have nothing to come back.
      } else
        changes.push(
          await this.movement(tx, operation, {
            locationId: sale.locationId,
            productId,
            sectorId: desired?.sectorId ?? actual?.sectorId,
            saleId,
            saleItemId: rowId,
            kind: desired?.kind ?? "order_adjust_out",
            direction: "out",
            quantity: quantity.toFixed(3),
            origin: { saleId, saleItemId: rowId, revision: sale.revision },
          }, warnings),
        );
    }
    await tx.inventoryOperation.update({
      where: { id: operation.id },
      data: {
        result: JSON.parse(
          JSON.stringify({
            movementIds: changes.flatMap((row) => (row ? [row.id] : [])),
            ...(warnings.length ? { warnings } : {}),
          }),
        ) as Prisma.InputJsonValue,
      },
    });
    return warnings;
  }

  async execute(
    scope: OperationalScope,
    actorUserId: string,
    input: InventoryCommandDto,
  ) {
    // The reason is optional: each operation has a default text.
    const reason =
      (input.reason ?? "").trim().length >= 3
        ? (input.reason ?? "").trim().slice(0, 500)
        : INVENTORY_REASONS[input.kind];
    if (input.kind !== "transfer" && input.toLocationId)
      throw new BadRequestException(
        "La destinazione è ammessa solo per i trasferimenti",
      );
    if (input.kind !== "return" && input.returnOfId)
      throw new BadRequestException(
        "Il riferimento al reso non è valido per questa operazione",
      );
    await this.requireLocations(scope, [input.locationId]);
    if (input.kind === "transfer") {
      if (!input.toLocationId || input.toLocationId === input.locationId)
        throw new BadRequestException(
          "Seleziona una sede di destinazione diversa",
        );
      await this.requireLocations(scope, [input.toLocationId], false);
    }
    try {
      const quantity = decimalInput(input.quantity, "Quantità", 3).toFixed(3);
      const command = {
        kind: input.kind,
        locationId: input.locationId,
        productId: input.productId,
        quantity,
        reason,
        toLocationId: input.toLocationId ?? null,
        returnOfId: input.returnOfId ?? null,
        unitCost:
          input.unitCost === undefined
            ? null
            : decimalInput(input.unitCost, "Costo", 6).toFixed(6),
        purchaseVatRate:
          input.purchaseVatRate === undefined
            ? null
            : decimalInput(input.purchaseVatRate, "IVA acquisto").toFixed(2),
        costMode: input.costMode ?? null,
        actorUserId,
      };
      const fingerprint = this.fingerprint(command);
      return await this.prisma.$transaction(async (tx) => {
        await lockOperationalTenant(tx, scope.tenantId);
        const prior = await tx.inventoryOperation.findUnique({
          where: {
            tenantId_idempotencyKey: {
              tenantId: scope.tenantId,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        if (prior) {
          if (prior.fingerprint !== fingerprint)
            throw new ConflictException(
              "Chiave già usata per un'operazione diversa",
            );
          if (!prior.result)
            throw new ConflictException(
              "Operazione in attesa di riconciliazione",
            );
          return prior.result;
        }
        const product = await tx.product.findFirst({
          where: {
            id: input.productId,
            tenantId: scope.tenantId,
            stockTracked: true,
          },
        });
        if (!product)
          throw new BadRequestException(
            "Abilita il tracciamento del prodotto prima di movimentarlo",
          );
        const activeLocations = await tx.location.count({
          where: {
            tenantId: scope.tenantId,
            id: {
              in: [
                input.locationId,
                ...(input.toLocationId ? [input.toLocationId] : []),
              ],
            },
            isActive: true,
          },
        });
        if (activeLocations !== (input.toLocationId ? 2 : 1))
          throw new BadRequestException("Sede disattivata");
        const operation = await tx.inventoryOperation.create({
          data: {
            tenantId: scope.tenantId,
            idempotencyKey: input.idempotencyKey,
            fingerprint,
            kind: input.kind,
            actorUserId,
            reason,
          },
        });
        const warnings: string[] = [];
        const records: Array<Awaited<ReturnType<InventoryService["movement"]>>> = [];
        const current = await tx.stockBalance.findUnique({
          where: {
            locationId_productId: {
              locationId: input.locationId,
              productId: input.productId,
            },
          },
        });
        // Opening twice becomes a count; a count without opening becomes the opening.
        let kind: InventoryCommandDto["kind"] = input.kind;
        if (kind === "opening" && current?.initialized) kind = "adjust";
        else if (kind === "adjust" && !current?.initialized) kind = "opening";
        // Load cost is optional: last net unit cost, product cost or zero.
        const unitCost =
          input.unitCost ??
          (["opening", "receipt", "adjust"].includes(kind)
            ? await this.lastUnitCost(
                tx,
                scope.tenantId,
                input.locationId,
                input.productId,
              )
            : undefined);
        const base = {
          locationId: input.locationId,
          productId: input.productId,
        };
        const receipt = () =>
          quoteReceipt({
            quantity,
            unitCost,
            purchaseVatRate:
              input.purchaseVatRate ??
              (input.unitCost === undefined
                ? "0"
                : (product.purchaseVatRate?.toFixed(2) ?? "0")),
            costMode:
              input.costMode ??
              (input.unitCost !== undefined && product.costMode === "gross"
                ? "gross"
                : "net"),
          });
        if (kind === "opening" || kind === "receipt") {
          const quote =
            kind === "opening"
              ? {
                  netValue: new Prisma.Decimal(quantity).isZero()
                    ? "0.000000"
                    : decimalInput(unitCost, "Costo netto iniziale", 6)
                        .times(quantity)
                        .toFixed(6),
                  purchaseTax: undefined,
                  purchaseVatRate: undefined,
                }
              : receipt();
          records.push(
            await this.movement(tx, operation, {
              ...base,
              kind,
              direction: "in",
              quantity,
              incomingValue: quote.netValue,
              opening: kind === "opening",
              purchaseTax: quote.purchaseTax,
              purchaseVatRate: quote.purchaseVatRate,
            }),
          );
        } else if (kind === "issue") {
          records.push(
            await this.movement(
              tx,
              operation,
              {
                ...base,
                kind: "issue",
                direction: "out",
                quantity,
              },
              warnings,
            ),
          );
        } else if (kind === "adjust") {
          const balance = current!;
          const difference = new Prisma.Decimal(quantity).minus(
            balance.quantity,
          );
          if (!difference.isZero()) {
            const incoming = difference.isPositive();
            records.push(
              await this.movement(tx, operation, {
                ...base,
                kind: incoming ? "adjust_in" : "adjust_out",
                direction: incoming ? "in" : "out",
                quantity: difference.abs().toFixed(3),
                ...(incoming
                  ? {
                      incomingValue: new Prisma.Decimal(unitCost ?? 0)
                        .times(difference)
                        .toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP)
                        .toFixed(6),
                    }
                  : {}),
              }),
            );
          }
        } else if (kind === "transfer") {
          const outgoing = await this.movement(
            tx,
            operation,
            {
              ...base,
              kind: "transfer_out",
              direction: "out",
              quantity,
            },
            warnings,
          );
          records.push(outgoing);
          if (outgoing)
            records.push(
              await this.movement(tx, operation, {
                locationId: input.toLocationId!,
                productId: input.productId,
                kind: "transfer_in",
                direction: "in",
                quantity: outgoing.quantityDelta.abs().toFixed(3),
                incomingValue: outgoing.valueDelta.abs().toFixed(6),
              }),
            );
        } else if (kind === "return") {
          if (!input.returnOfId)
            throw new BadRequestException(
              "Seleziona il movimento di scarico da restituire",
            );
          const source = await tx.stockMovement.findFirst({
            where: {
              id: input.returnOfId,
              tenantId: scope.tenantId,
              locationId: input.locationId,
              productId: input.productId,
              quantityDelta: { lt: 0 },
              kind: { not: "transfer_out" },
              OR: [{ sectorId: null }, { sectorId: { in: scope.sectorIds } }],
            },
            include: { returns: true },
          });
          if (!source)
            throw new BadRequestException("Scarico non valido per il reso");
          if (source.saleId && source.saleItemId) {
            const net = await tx.stockMovement.aggregate({
              where: {
                tenantId: scope.tenantId,
                saleId: source.saleId,
                saleItemId: source.saleItemId,
                productId: source.productId,
              },
              _sum: { quantityDelta: true },
            });
            if (
              new Prisma.Decimal(quantity).greaterThan(
                (net._sum.quantityDelta ?? new Prisma.Decimal(0)).negated(),
              )
            )
              throw new BadRequestException(
                "Le quantità del conto sono già state restituite o rettificate",
              );
          }
          const returned = source.returns.reduce(
            (sum, row) => sum.plus(row.quantityDelta),
            new Prisma.Decimal(0),
          );
          const remaining = source.quantityDelta.abs().minus(returned),
            requested = new Prisma.Decimal(quantity);
          if (requested.isZero() || requested.greaterThan(remaining))
            throw new BadRequestException(
              "Il reso supera la quantità ancora restituibile",
            );
          const returnedValue = source.returns.reduce(
            (sum, row) => sum.plus(row.valueDelta),
            new Prisma.Decimal(0),
          );
          const value = requested.equals(remaining)
            ? source.valueDelta.abs().minus(returnedValue)
            : source.valueDelta
                .abs()
                .times(requested)
                .dividedBy(source.quantityDelta.abs())
                .toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
          records.push(
            await this.movement(tx, operation, {
              ...base,
              kind: "return",
              direction: "in",
              quantity,
              incomingValue: value.toFixed(6),
              returnOfId: source.id,
              sectorId: source.sectorId ?? undefined,
              saleId: source.saleId ?? undefined,
              saleItemId: source.saleItemId ?? undefined,
            }),
          );
        }
        const balances = await tx.stockBalance.findMany({
          where: {
            tenantId: scope.tenantId,
            productId: input.productId,
            locationId: {
              in: [
                input.locationId,
                ...(input.toLocationId ? [input.toLocationId] : []),
              ],
            },
          },
        });
        const result = JSON.parse(
          JSON.stringify({
            operationId: operation.id,
            movements: records.filter(Boolean),
            balances,
            ...(warnings.length ? { warnings } : {}),
          }),
        ) as Prisma.InputJsonValue;
        await tx.inventoryOperation.update({
          where: { id: operation.id },
          data: { result },
        });
        return result;
      });
    } catch (error) {
      if (error instanceof Error && error.constructor === Error)
        throw new BadRequestException(error.message);
      throw error;
    }
  }
}
