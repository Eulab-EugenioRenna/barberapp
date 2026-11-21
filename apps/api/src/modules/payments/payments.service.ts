import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
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
import { paymentBalance } from "./payment-balance";
import type { PaymentCommandDto } from "./payment-command.dto";

type Tx = Prisma.TransactionClient;
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
    const reason = body.reason?.trim() || null;
    if (
      (reason && (reason.length < 3 || reason.length > 500)) ||
      (body.kind !== "receive" && !reason)
    )
      throw new BadRequestException("Indica la motivazione dell'operazione");
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
    const sale = await this.accessibleSale(tx, scope, saleId);
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
    const current = await tx.paymentEntry.findMany({
      where: { saleId, tenantId: scope.tenantId },
    });
    if (command.kind === "reconcile") {
      if (sale.paymentBasis !== "legacy_unknown" || current.length)
        throw new ConflictException("Saldo iniziale già riconciliato");
    } else if (sale.paymentBasis !== "ledger") {
      throw new ConflictException(
        "Riconcilia prima l'importo storico effettivamente incassato",
      );
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
    const operationId = randomUUID();
    const entries = command.entries.map((row) => ({
      id: randomUUID(),
      tenantId: scope.tenantId,
      saleId,
      operationId,
      kind:
        command.kind === "reconcile"
          ? "opening"
          : command.kind === "receive"
            ? "receipt"
            : "refund",
      amount: row.amount,
      method: row.method,
      refundOfId: row.refundOfId,
      receivedAt:
        command.kind === "reconcile"
          ? null
          : row.receivedAt
            ? new Date(row.receivedAt)
            : now,
    }));
    let summary: ReturnType<typeof paymentBalance>;
    try {
      summary = paymentBalance(sale.total, "ledger", [...current, ...entries]);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "Incassi non coerenti",
      );
    }
    const result = {
      operationId,
      saleId,
      revision: sale.revision + 1,
      summary,
      entries: entries.map((row) => ({
        ...row,
        receivedAt: row.receivedAt?.toISOString() ?? null,
      })),
    };
    await tx.paymentOperation.create({
      data: {
        id: operationId,
        tenantId: scope.tenantId,
        saleId,
        actorUserId: actorId,
        idempotencyKey: body.idempotencyKey,
        fingerprint,
        kind: command.kind,
        expectedRevision: sale.revision,
        reason: command.reason,
        result,
      },
    });
    await tx.paymentEntry.createMany({ data: entries });
    const methods = [
      ...new Set(
        [...current, ...entries]
          .filter((row) => row.kind === "receipt")
          .map((row) => row.method),
      ),
    ];
    await tx.sale.update({
      where: { id: saleId, tenantId: scope.tenantId },
      data: {
        paymentBasis: "ledger",
        revision: { increment: 1 },
        paymentStatus: summary.status as
          | "paid"
          | "unpaid"
          | "partial"
          | "refunded",
        paymentMethod: methods.length > 1 ? "mixed" : (methods[0] ?? null),
      },
    });
    // Surface deferred PostgreSQL checks before Prisma commits the transaction.
    await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
    return result;
  }

  /** Legacy cashier adapter: only a concrete full receipt with a known method creates money. */
  async cashierDeclaration(
    tx: Tx,
    scope: OperationalScope,
    actorId: string,
    saleId: string,
    body: Record<string, unknown>,
  ) {
    const sale = await this.accessibleSale(tx, scope, saleId);
    const requested = body["paymentStatus"];
    if (sale.paymentBasis === "legacy_unknown") {
      if (
        (requested !== undefined && requested !== sale.paymentStatus) ||
        (body["paymentMethod"] !== undefined &&
          body["paymentMethod"] !== sale.paymentMethod)
      )
        throw new ConflictException(
          "Riconcilia gli incassi storici prima di modificarli",
        );
      return sale;
    }
    const entries = await tx.paymentEntry.findMany({
      where: { saleId, tenantId: scope.tenantId },
    });
    const balance = paymentBalance(sale.total, "ledger", entries);
    if (requested === undefined) return sale;
    if (requested === "paid" && balance.remaining !== "0.00") {
      const method = body["paymentMethod"];
      if (
        typeof method !== "string" ||
        !["cash", "card", "bank", "other"].includes(method)
      )
        throw new BadRequestException(
          "Indica il metodo effettivo oppure registra gli importi misti dal conto",
        );
      await this.recordInTransaction(tx, scope, actorId, saleId, {
        kind: "receive",
        idempotencyKey: `cashier:${saleId}:${sale.revision}`,
        revision: sale.revision,
        entries: [
          {
            amount: balance.remaining!,
            method: method as "cash" | "card" | "bank" | "other",
          },
        ],
        reason: "Incasso integrale dichiarato in cassa",
      });
      return this.accessibleSale(tx, scope, saleId);
    }
    if (
      requested !== balance.status &&
      !(requested === "paid" && balance.remaining === "0.00")
    )
      throw new ConflictException(
        "Registra gli importi di acconto o rimborso dal conto",
      );
    if (
      body["paymentMethod"] !== undefined &&
      entries.some((row) => row.kind === "receipt") &&
      body["paymentMethod"] !== sale.paymentMethod
    )
      throw new ConflictException(
        "Il metodo deriva dagli incassi già registrati",
      );
    return sale;
  }
}
