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

  /** Called inside a tenant-locked transaction. Movement and balance always commit together. */
  async movement(tx: Tx, operation: InventoryOperation, input: MovementInput) {
    const balance = await tx.stockBalance.upsert({
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

  /** Same transaction as order confirmation. Legacy rows never create retroactive stock. */
  async postOrder(tx: Tx, saleId: string, actorUserId: string) {
    const sale = await tx.sale.findUniqueOrThrow({
      where: { id: saleId },
      include: {
        items: { include: { booking: { select: { status: true } } } },
      },
    });
    if (sale.orderStatus !== "confirmed") return;
    const movements = await tx.stockMovement.findMany({
      where: { tenantId: sale.tenantId, saleId },
    });
    const pending = sale.items.filter((row) => row.stockState !== "legacy");
    if (!pending.length && !movements.length) return;
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
      return;
    }
    if (
      !movements.length &&
      ["cancelled", "refunded"].includes(sale.paymentStatus)
    )
      return;
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
        if (!remaining.isZero())
          throw new ConflictException(
            "Quantità del conto da riconciliare con gli scarichi originali",
          );
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
          }),
        );
    }
    await tx.inventoryOperation.update({
      where: { id: operation.id },
      data: {
        result: JSON.parse(
          JSON.stringify({ movementIds: changes.map((row) => row.id) }),
        ) as Prisma.InputJsonValue,
      },
    });
  }

  async execute(
    scope: OperationalScope,
    actorUserId: string,
    input: InventoryCommandDto,
  ) {
    if (input.reason.trim().length < 3)
      throw new BadRequestException("Indica il motivo dell'operazione");
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
        reason: input.reason.trim(),
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
            reason: input.reason.trim(),
          },
        });
        const records = [];
        const base = {
          locationId: input.locationId,
          productId: input.productId,
        };
        const receipt = () =>
          quoteReceipt({
            quantity,
            unitCost: input.unitCost,
            purchaseVatRate: input.purchaseVatRate,
            costMode: input.costMode as "net" | "gross",
          });
        if (input.kind === "opening" || input.kind === "receipt") {
          const quote =
            input.kind === "opening"
              ? {
                  netValue: new Prisma.Decimal(quantity).isZero()
                    ? "0.000000"
                    : decimalInput(input.unitCost, "Costo netto iniziale", 6)
                        .times(quantity)
                        .toFixed(6),
                  purchaseTax: undefined,
                  purchaseVatRate: undefined,
                }
              : receipt();
          records.push(
            await this.movement(tx, operation, {
              ...base,
              kind: input.kind,
              direction: "in",
              quantity,
              incomingValue: quote.netValue,
              opening: input.kind === "opening",
              purchaseTax: quote.purchaseTax,
              purchaseVatRate: quote.purchaseVatRate,
            }),
          );
        } else if (input.kind === "issue") {
          records.push(
            await this.movement(tx, operation, {
              ...base,
              kind: "issue",
              direction: "out",
              quantity,
            }),
          );
        } else if (input.kind === "adjust") {
          const balance = await tx.stockBalance.findUnique({
            where: {
              locationId_productId: {
                locationId: input.locationId,
                productId: input.productId,
              },
            },
          });
          if (!balance?.initialized)
            throw new BadRequestException(
              "Registra prima la giacenza iniziale",
            );
          const difference = new Prisma.Decimal(quantity).minus(
            balance.quantity,
          );
          if (!difference.isZero()) {
            const incoming = difference.isPositive();
            if (incoming && input.unitCost === undefined)
              throw new BadRequestException(
                "Indica il costo netto delle quantità aggiunte dalla rettifica",
              );
            records.push(
              await this.movement(tx, operation, {
                ...base,
                kind: incoming ? "adjust_in" : "adjust_out",
                direction: incoming ? "in" : "out",
                quantity: difference.abs().toFixed(3),
                ...(incoming
                  ? {
                      incomingValue: new Prisma.Decimal(input.unitCost!)
                        .times(difference)
                        .toFixed(6),
                    }
                  : {}),
              }),
            );
          }
        } else if (input.kind === "transfer") {
          const outgoing = await this.movement(tx, operation, {
            ...base,
            kind: "transfer_out",
            direction: "out",
            quantity,
          });
          records.push(outgoing);
          records.push(
            await this.movement(tx, operation, {
              locationId: input.toLocationId!,
              productId: input.productId,
              kind: "transfer_in",
              direction: "in",
              quantity,
              incomingValue: outgoing.valueDelta.abs().toFixed(6),
            }),
          );
        } else if (input.kind === "return") {
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
            movements: records,
            balances,
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
