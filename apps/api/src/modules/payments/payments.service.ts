import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type PaymentEntry, type Sale } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import {
  lockOperationalTenant,
  setOperationalActor,
} from "../../common/operational-lock";
import {
  saleFilter,
  type OperationalScope,
} from "../locations/operational-scope";
import { paymentBalance, settledStatus } from "./payment-balance";
import type { PaymentCommandDto } from "./payment-command.dto";

type Tx = Prisma.TransactionClient;
type Method = "cash" | "card" | "bank" | "other";
type Line = {
  amount: string;
  method: string | null;
  receivedAt: string | null;
  refundOfId: string | null;
};
const METHODS: Method[] = ["cash", "card", "bank", "other"];
const D = Prisma.Decimal;
const DEFAULT_REASONS = {
  refund: "Rimborso registrato dal conto",
  reconcile: "Saldo storico riconciliato dal conto",
} as const;
const isMethod = (value: unknown): value is Method =>
  typeof value === "string" && (METHODS as string[]).includes(value);

/** Receipts and openings with what can still be refunded from each. */
function refundable(entries: PaymentEntry[]) {
  const refunded = new Map<string, Prisma.Decimal>();
  for (const row of entries)
    if (row.kind === "refund" && row.refundOfId)
      refunded.set(
        row.refundOfId,
        (refunded.get(row.refundOfId) ?? new D(0)).plus(row.amount),
      );
  return entries
    .filter((row) => row.kind !== "refund")
    .map((row) => ({
      row,
      left: new D(row.amount).minus(refunded.get(row.id) ?? 0),
    }));
}
function netOf(entries: PaymentEntry[]) {
  return entries.reduce(
    (sum, row) =>
      row.kind === "refund" ? sum.minus(row.amount) : sum.plus(row.amount),
    new D(0),
  );
}

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  private async accessibleSale(tx: Tx, scope: OperationalScope, id: string) {
    const sale = await tx.sale.findFirst({
      where: { id, tenantId: scope.tenantId, ...saleFilter(scope) },
    });
    if (!sale) throw new NotFoundException("Conto non accessibile");
    return sale;
  }

  async read(scope: OperationalScope, saleId: string, page = 1) {
    if (!Number.isInteger(page) || page < 1 || page > 100000)
      throw new BadRequestException("Pagina non valida");
    // Repeatable snapshot: a concurrent receipt must not mix a new balance with old rows.
    return this.prisma.$transaction(
      async (tx) => {
        const sale = await this.accessibleSale(tx, scope, saleId);
        const all = await tx.paymentEntry.findMany({
          where: { saleId, tenantId: scope.tenantId },
        });
        const items = await tx.paymentEntry.findMany({
          where: { saleId, tenantId: scope.tenantId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (page - 1) * 50,
          take: 50,
          include: {
            operation: {
              select: { actorUserId: true, reason: true, kind: true },
            },
            refunds: { select: { amount: true } },
          },
        });
        return {
          saleId,
          revision: sale.revision,
          orderStatus: sale.orderStatus,
          legacyStatus:
            sale.paymentBasis === "legacy_unknown" ? sale.paymentStatus : null,
          summary: paymentBalance(sale.total, sale.paymentBasis, all),
          items: items.map(({ refunds, ...row }) => ({
            ...row,
            amount: row.amount.toFixed(2),
            refundableAmount:
              row.kind === "refund"
                ? "0.00"
                : row.amount
                    .minus(
                      refunds.reduce(
                        (sum, refund) => sum.plus(refund.amount),
                        new Prisma.Decimal(0),
                      ),
                    )
                    .toFixed(2),
          })),
          total: all.length,
          page,
          pageSize: 50,
          hasMore: page * 50 < all.length,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private command(body: PaymentCommandDto) {
    // Validation also applies to callers inside the application, outside HTTP DTOs.
    if (
      !/^[A-Za-z0-9._:-]{8,128}$/.test(body.idempotencyKey ?? "") ||
      !Number.isInteger(body.revision) ||
      body.revision < 0 ||
      body.revision > 2147483646 ||
      !["receive", "refund", "reconcile"].includes(body.kind) ||
      !Array.isArray(body.entries) ||
      body.entries.length < 1 ||
      body.entries.length > 10
    )
      throw new BadRequestException("Operazione pagamento non valida");
    // The reason is optional: refunds and reconciliations get a default text.
    let reason = body.reason?.trim().slice(0, 500) || null;
    if (reason && reason.length < 3) reason = null;
    if (!reason && body.kind !== "receive") reason = DEFAULT_REASONS[body.kind];
    if (body.kind === "reconcile" && body.entries.length !== 1)
      throw new BadRequestException("Indica un solo saldo iniziale");
    const entries = body.entries.map((row) => {
      if (
        !row ||
        typeof row.amount !== "string" ||
        !/^\d{1,8}(\.\d{1,2})?$/.test(row.amount)
      )
        throw new BadRequestException(
          "Importo non valido: usa al massimo due decimali",
        );
      const amount = new Prisma.Decimal(row.amount);
      if (body.kind === "reconcile") {
        if (row.method || row.receivedAt || row.refundOfId)
          throw new BadRequestException(
            "Il saldo storico non è un incasso datato",
          );
      } else {
        if (
          amount.isZero() ||
          !["cash", "card", "bank", "other"].includes(row.method ?? "")
        )
          throw new BadRequestException(
            "Indica importo positivo e metodo effettivo",
          );
        if (
          body.kind === "refund" &&
          (!row.refundOfId || row.refundOfId.length > 100)
        )
          throw new BadRequestException(
            "Seleziona l'incasso originale da rimborsare",
          );
        if (body.kind === "receive" && row.refundOfId)
          throw new BadRequestException(
            "Un incasso non può riferirsi a un rimborso",
          );
      }
      const receivedAt = row.receivedAt ? new Date(row.receivedAt) : null;
      if (receivedAt && !Number.isFinite(receivedAt.getTime()))
        throw new BadRequestException("Data incasso non valida");
      return {
        amount: amount.toFixed(2),
        method: row.method ?? null,
        receivedAt: receivedAt?.toISOString() ?? null,
        refundOfId: row.refundOfId ?? null,
      };
    });
    return { kind: body.kind, revision: body.revision, reason, entries };
  }

  async execute(
    scope: OperationalScope,
    actorId: string,
    saleId: string,
    body: PaymentCommandDto,
  ) {
    return this.prisma.$transaction((tx) =>
      this.recordInTransaction(tx, scope, actorId, saleId, body),
    );
  }

  /**
   * Writes one payment operation and moves the sale to the next revision.
   * Balance checks belong to the caller; the deferred database check verifies
   * the final state before commit.
   */
  private async post(
    tx: Tx,
    sale: Sale,
    actorId: string,
    input: {
      kind: "receive" | "refund" | "reconcile";
      lines: Line[];
      reason: string | null;
      idempotencyKey?: string;
      fingerprint?: string;
    },
  ) {
    const operationId = randomUUID();
    const now = new Date();
    const current = await tx.paymentEntry.findMany({
      where: { saleId: sale.id, tenantId: sale.tenantId },
    });
    const entries = input.lines.map((row) => ({
      id: randomUUID(),
      tenantId: sale.tenantId,
      saleId: sale.id,
      operationId,
      kind:
        input.kind === "reconcile"
          ? "opening"
          : input.kind === "receive"
            ? "receipt"
            : "refund",
      amount: row.amount,
      method: input.kind === "reconcile" ? null : row.method,
      refundOfId: row.refundOfId,
      receivedAt:
        input.kind === "reconcile"
          ? null
          : row.receivedAt
            ? new Date(row.receivedAt)
            : now,
    }));
    const all = [
      ...current,
      ...entries.map((row) => ({ ...row, amount: new D(row.amount) })),
    ] as PaymentEntry[];
    const status = settledStatus(sale.total, all);
    let summary: ReturnType<typeof paymentBalance> | null = null;
    try {
      summary = paymentBalance(sale.total, "ledger", all);
    } catch {
      // Interim state of an automatic correction (e.g. total lowered below the net).
    }
    const idempotencyKey =
      input.idempotencyKey ?? `auto:${sale.id}:${sale.revision}:${input.kind}`;
    const result = JSON.parse(
      JSON.stringify({
        operationId,
        saleId: sale.id,
        revision: sale.revision + 1,
        summary,
        entries: entries.map((row) => ({
          ...row,
          receivedAt: row.receivedAt?.toISOString() ?? null,
        })),
      }),
    ) as Prisma.InputJsonObject;
    await tx.paymentOperation.create({
      data: {
        id: operationId,
        tenantId: sale.tenantId,
        saleId: sale.id,
        actorUserId: actorId,
        idempotencyKey,
        fingerprint:
          input.fingerprint ??
          createHash("sha256").update(idempotencyKey).digest("hex"),
        kind: input.kind,
        expectedRevision: sale.revision,
        reason: input.reason,
        result,
      },
    });
    await tx.paymentEntry.createMany({ data: entries });
    const held = refundable(all).filter((row) => row.left.greaterThan(0));
    const live = held.filter((row) => row.row.kind === "receipt");
    const methods = [
      ...new Set(
        (live.length
          ? live.map((row) => row.row)
          : all.filter((row) => row.kind === "receipt")
        ).map((row) => row.method),
      ),
    ];
    await tx.sale.update({
      where: { id: sale.id, tenantId: sale.tenantId },
      data: {
        paymentBasis: "ledger",
        revision: { increment: 1 },
        paymentStatus: status,
        // A historic opening keeps the method declared before the ledger.
        paymentMethod:
          methods.length > 1
            ? "mixed"
            : (methods[0] ??
              (held.some((row) => row.row.kind === "opening")
                ? sale.paymentMethod
                : null)),
      },
    });
    return result;
  }

  /** Reuses the caller's order transaction; never commits money separately from the sale. */
  async recordInTransaction(
    tx: Tx,
    scope: OperationalScope,
    actorId: string,
    saleId: string,
    body: PaymentCommandDto,
  ) {
    const command = this.command(body);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ actorId, saleId, ...command }))
      .digest("hex");
    await lockOperationalTenant(tx, scope.tenantId);
    await setOperationalActor(tx, actorId);
    // Authorization precedes idempotency replay. A key never grants access to a prior result.
    let sale = await this.accessibleSale(tx, scope, saleId);
    const previous = await tx.paymentOperation.findUnique({
      where: {
        tenantId_idempotencyKey: {
          tenantId: scope.tenantId,
          idempotencyKey: body.idempotencyKey,
        },
      },
    });
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new ConflictException("Chiave già usata per un'altra operazione");
      return previous.result;
    }
    if (sale.revision !== command.revision)
      throw new ConflictException(
        "Il conto è cambiato: aggiorna prima di registrare",
      );
    if (
      sale.orderStatus === "superseded" ||
      (sale.orderStatus === "cancelled" && command.kind === "receive")
    )
      throw new ConflictException("Il conto non accetta nuovi incassi");
    let current = await tx.paymentEntry.findMany({
      where: { saleId, tenantId: scope.tenantId },
    });
    if (command.kind === "reconcile") {
      if (sale.paymentBasis !== "legacy_unknown" || current.length)
        throw new ConflictException("Saldo iniziale già riconciliato");
    } else if (sale.paymentBasis !== "ledger") {
      // Historic sale: reconcile to its declared status, then record the movement.
      sale = await this.autoReconcile(tx, actorId, sale);
      current = await tx.paymentEntry.findMany({
        where: { saleId, tenantId: scope.tenantId },
      });
    }
    const now = new Date();
    if (
      command.entries.some(
        (row) =>
          row.receivedAt &&
          new Date(row.receivedAt).getTime() > now.getTime() + 300000,
      )
    )
      throw new BadRequestException("La data di incasso non può essere futura");
    try {
      paymentBalance(sale.total, "ledger", [
        ...current,
        ...command.entries.map((row, index) => ({
          id: `new-${index}`,
          kind:
            command.kind === "reconcile"
              ? "opening"
              : command.kind === "receive"
                ? "receipt"
                : "refund",
          amount: row.amount,
          refundOfId: row.refundOfId,
        })),
      ]);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "Incassi non coerenti",
      );
    }
    const result = await this.post(tx, sale, actorId, {
      kind: command.kind,
      lines: command.entries,
      reason: command.reason,
      idempotencyKey: body.idempotencyKey,
      fingerprint,
    });
    // Surface deferred PostgreSQL checks before Prisma commits the transaction.
    await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
    return result;
  }

  /** Historic sale: the declared status becomes the opening balance (paid = whole total). */
  private async autoReconcile(tx: Tx, actorId: string, sale: Sale) {
    if (sale.paymentBasis !== "legacy_unknown") return sale;
    await this.post(tx, sale, actorId, {
      kind: "reconcile",
      lines: [
        {
          amount:
            sale.paymentStatus === "paid" ? sale.total.toFixed(2) : "0.00",
          method: null,
          receivedAt: null,
          refundOfId: null,
        },
      ],
      reason: "Saldo storico riconciliato automaticamente dallo stato dichiarato",
    });
    return tx.sale.findUniqueOrThrow({ where: { id: sale.id } });
  }

  private async reload(tx: Tx, saleId: string) {
    const sale = await tx.sale.findUniqueOrThrow({ where: { id: saleId } });
    const entries = await tx.paymentEntry.findMany({
      where: { saleId, tenantId: sale.tenantId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return { sale, entries };
  }

  /** Refunds `amount` (or everything matching `pick`) starting from the latest receipts. */
  private async autoRefund(
    tx: Tx,
    actorId: string,
    saleId: string,
    amount: Prisma.Decimal | "all",
    reason: string,
    pick: (row: PaymentEntry) => boolean = () => true,
  ) {
    let { sale, entries } = await this.reload(tx, saleId);
    let remaining = amount === "all" ? null : amount;
    const lines: Line[] = [];
    for (const source of refundable(entries).reverse()) {
      if (remaining?.lte(0)) break;
      if (source.left.lte(0) || !pick(source.row)) continue;
      const taken = remaining ? D.min(remaining, source.left) : source.left;
      lines.push({
        amount: taken.toFixed(2),
        method:
          source.row.method ??
          (isMethod(sale.paymentMethod) ? sale.paymentMethod : "other"),
        receivedAt: null,
        refundOfId: source.row.id,
      });
      if (remaining) remaining = remaining.minus(taken);
    }
    for (let index = 0; index < lines.length; index += 10) {
      await this.post(tx, sale, actorId, {
        kind: "refund",
        lines: lines.slice(index, index + 10),
        reason,
      });
      ({ sale, entries } = await this.reload(tx, saleId));
    }
    return sale;
  }

  /** «Annulla vendita»: every receipt still held goes back, in the same transaction. */
  async refundAll(
    tx: Tx,
    scope: OperationalScope,
    actorId: string,
    saleId: string,
    reason: string,
  ) {
    let sale = await this.accessibleSale(tx, scope, saleId);
    sale = await this.autoReconcile(tx, actorId, sale);
    return this.autoRefund(tx, actorId, saleId, "all", reason);
  }

  /**
   * Payment status and method chosen at the till. The server writes whatever
   * refund or receipt is needed to reach them; nothing is refused.
   */
  async cashierDeclaration(
    tx: Tx,
    scope: OperationalScope,
    actorId: string,
    saleId: string,
    body: Record<string, unknown>,
  ) {
    let sale = await this.accessibleSale(tx, scope, saleId);
    if (["superseded", "cancelled"].includes(sale.orderStatus)) return sale;
    sale = await this.autoReconcile(tx, actorId, sale);
    let { entries } = await this.reload(tx, saleId);
    const total = new D(sale.total);
    let net = netOf(entries);
    if (net.greaterThan(total)) {
      sale = await this.autoRefund(
        tx,
        actorId,
        saleId,
        net.minus(total),
        "Totale del conto ridotto: rimborso automatico della differenza",
      );
      ({ entries } = await this.reload(tx, saleId));
      net = netOf(entries);
    }
    const requested = body["paymentStatus"];
    const method = isMethod(body["paymentMethod"])
      ? body["paymentMethod"]
      : undefined;
    let target = net;
    if (requested === "paid") target = total;
    else if (["unpaid", "refunded", "cancelled"].includes(String(requested)))
      target = new D(0);
    else if (requested === "partial" && body["amountPaid"] !== undefined) {
      const paid = Number(body["amountPaid"]);
      if (Number.isFinite(paid))
        target = D.min(D.max(new D(paid.toFixed(2)), 0), total);
    }
    // A different method: the money held with the old method goes back and
    // is received again with the new one.
    if (method && target.greaterThan(0)) {
      // A historic opening counts with the method declared on the sale.
      const declared = sale.paymentMethod;
      const differs = (row: PaymentEntry) =>
        (row.kind === "opening" ? declared : row.method) !== method;
      const other = refundable(entries).some(
        (row) => row.left.greaterThan(0) && differs(row.row),
      );
      if (other) {
        sale = await this.autoRefund(
          tx,
          actorId,
          saleId,
          "all",
          "Metodo di pagamento cambiato dal conto",
          differs,
        );
        ({ entries } = await this.reload(tx, saleId));
        net = netOf(entries);
      }
    }
    const difference = target.minus(net);
    if (difference.isNegative())
      sale = await this.autoRefund(
        tx,
        actorId,
        saleId,
        difference.abs(),
        target.isZero()
          ? "Pagamento annullato dal conto"
          : "Importo incassato ridotto dal conto",
      );
    else if (difference.greaterThan(0)) {
      const held = [
        ...new Set(
          refundable(entries)
            .filter((row) => row.row.kind === "receipt" && row.left.gt(0))
            .map((row) => row.row.method),
        ),
      ];
      await this.post(tx, sale, actorId, {
        kind: "receive",
        lines: [
          {
            amount: difference.toFixed(2),
            method:
              method ?? (held.length === 1 && isMethod(held[0]) ? held[0] : "cash"),
            receivedAt: null,
            refundOfId: null,
          },
        ],
        reason:
          requested === "paid"
            ? "Incasso integrale dichiarato in cassa"
            : "Incasso registrato dal conto",
      });
    } else if (sale.paymentStatus !== settledStatus(total, entries))
      await tx.sale.update({
        where: { id: saleId },
        data: { paymentStatus: settledStatus(total, entries) },
      });
    return this.accessibleSale(tx, scope, saleId);
  }
}
