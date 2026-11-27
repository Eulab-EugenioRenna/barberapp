/**
 * Opt-in check against a real local database (never production):
 *   ALORA_DB_VERIFY_URL=postgresql://… npx jest booking-mutation.db
 * Everything runs inside one transaction that is always rolled back; each service
 * call gets a savepoint and the constraint timing a fresh transaction would have.
 * The pending agenda migration is applied inside the same transaction.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { BookingMutationService } from "./booking-mutation.service";
import { OrderCommandService } from "./order-command.service";
import { BookingResourcesService } from "./booking-resources.service";
import { OperationalOrderService } from "./operational-order.service";
import { CollaboratorScheduleService } from "../availability/collaborator-schedule.service";

const url = process.env["ALORA_DB_VERIFY_URL"];
const suite = url ? describe : describe.skip;
class Rollback extends Error {}

suite("agenda corrections on a real database (rolled back)", () => {
  jest.setTimeout(120000);
  it("corrects status, reactivates, moves paid accounts, changes customer and links legacy rows", async () => {
    const prisma = new PrismaClient({ datasources: { db: { url } } });
    const log: string[] = [];
    try {
      await prisma
        .$transaction(
          async (outer) => {
            const migration = readFileSync(
              join(
                __dirname,
                "../../../../../prisma/migrations/20261127110000_agenda_free_corrections/migration.sql",
              ),
              "utf8",
            )
              .replace(/^BEGIN;/m, "")
              .replace(/^COMMIT;/m, "");
            // One statement per call: each function body ends with `END $$;`.
            for (const part of migration.split(/END \$\$;/).slice(0, -1))
              await outer.$executeRawUnsafe(part + "END $$;");
            const timing = await outer.$queryRaw<
              Array<{ name: string; deferred: boolean }>
            >`SELECT DISTINCT tgname AS name, tginitdeferred AS deferred FROM pg_trigger WHERE tgdeferrable`;
            const quote = (rows: typeof timing) =>
              rows.map((row) => `"${row.name}"`).join(",");
            let n = 0;
            const fresh = async () => {
              const later = timing.filter((row) => row.deferred);
              const now = timing.filter((row) => !row.deferred);
              if (later.length)
                await outer.$executeRawUnsafe(
                  `SET CONSTRAINTS ${quote(later)} DEFERRED`,
                );
              if (now.length)
                await outer.$executeRawUnsafe(
                  `SET CONSTRAINTS ${quote(now)} IMMEDIATE`,
                );
            };
            const client = new Proxy(outer, {
              get(target, prop) {
                if (prop === "$transaction")
                  return async (fn: (tx: typeof outer) => Promise<unknown>) => {
                    const name = `verify_${++n}`;
                    await fresh();
                    await outer.$executeRawUnsafe(`SAVEPOINT ${name}`);
                    try {
                      const result = await fn(outer);
                      await outer.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
                      return result;
                    } catch (error) {
                      await outer.$executeRawUnsafe(
                        `ROLLBACK TO SAVEPOINT ${name}`,
                      );
                      throw error;
                    }
                  };
                return Reflect.get(target, prop);
              },
            });
            const service = new BookingMutationService(
              client as never,
              new OrderCommandService(),
              new BookingResourcesService(
                new CollaboratorScheduleService(client as never),
              ),
              new OperationalOrderService(client as never),
            );
            const tenant = await outer.tenant.findFirstOrThrow({
              orderBy: { appointments: { _count: "desc" } },
              select: { id: true },
            });
            const user = await outer.user.findFirstOrThrow({
              where: { tenantId: tenant.id },
              select: { id: true },
            });
            const [locations, sectors] = await Promise.all([
              outer.location.findMany({
                where: { tenantId: tenant.id },
                select: { id: true },
              }),
              outer.sector.findMany({
                where: { tenantId: tenant.id },
                select: { id: true },
              }),
            ]);
            const context = {
              tenantId: tenant.id,
              actorId: user.id,
              source: "internal" as const,
              scope: {
                tenantId: tenant.id,
                locationIds: locations.map((row) => row.id),
                sectorIds: sectors.map((row) => row.id),
                allowedSectorIds: sectors.map((row) => row.id),
                cacheKey: "verify",
              },
            };
            const booking = (id: string) =>
              outer.appointment.findUniqueOrThrow({
                where: { id },
                include: {
                  orderItem: { include: { sale: true } },
                  cancellations: true,
                },
              });
            const single = await outer.appointment.findFirstOrThrow({
              where: {
                tenantId: tenant.id,
                status: "confirmed",
                collaboratorId: { not: null },
                orderItem: { sale: { orderStatus: "open" } },
              },
              orderBy: { startsAt: "asc" },
            });
            const A = single.id;
            // 1. confirmed → completed → confirmed: a plain correction with history.
            await service.reviseLine(context, A, { status: "completed" as never });
            await service.reviseLine(context, A, { status: "confirmed" as never });
            expect((await booking(A)).status).toBe("confirmed");
            const history = await outer.auditLog.count({
              where: { entityId: A, action: "appointment.status_changed" },
            });
            expect(history).toBe(2);
            log.push("completed↔confirmed ok, history rows: " + history);
            // 2. Cancel from the form together with a note, no reason, no revision.
            await service.reviseLine(context, A, {
              status: "cancelled" as never,
              internalNotes: "Ha chiamato per disdire",
            });
            let row = await booking(A);
            expect(row.status).toBe("cancelled");
            expect(row.internalNotes).toBe("Ha chiamato per disdire");
            expect(row.cancellations.at(-1)?.reason).toBe("Annullato dall'agenda");
            log.push("cancel+note ok, account " + row.orderItem?.sale.orderStatus);
            // 3. Reactivation, also of a fully cancelled account.
            await service.reviseLine(context, A, { status: "confirmed" as never });
            row = await booking(A);
            expect(row.status).toBe("confirmed");
            expect(row.orderItem?.sale.orderStatus).not.toBe("cancelled");
            expect(row.cancellations.length).toBeGreaterThan(0);
            log.push("reactivation ok, account " + row.orderItem?.sale.orderStatus);
            // 4. no_show → cancelled → no_show on the same booking.
            await service.reviseLine(context, A, { status: "no_show" as never });
            await service.cancel(context, A, {}, "line");
            await service.reviseLine(context, A, { status: "no_show" as never });
            expect((await booking(A)).status).toBe("no_show");
            await service.reviseLine(context, A, { status: "confirmed" as never });
            log.push("no_show/cancelled corrections ok");
            // 5. Double booking stays impossible: reactivation onto a taken slot.
            const other = await outer.appointment.findFirst({
              where: {
                tenantId: tenant.id,
                id: { not: A },
                status: { notIn: ["cancelled", "no_show"] },
                sectorId: single.sectorId,
              },
            });
            if (other) {
              await service.reviseLine(context, A, { status: "cancelled" as never });
              await service.reviseLine(context, other.id, {
                startsAt: single.startsAt.toISOString(),
                collaboratorId: single.collaboratorId!,
              });
              await expect(
                service.reviseLine(context, A, { status: "confirmed" as never }),
              ).rejects.toThrow(/Conflitto appuntamento/);
              // A busy professional chosen by hand: plain message from the planner.
              await service.reviseLine(context, A, {
                status: "confirmed" as never,
                startsAt: new Date(
                  single.startsAt.getTime() + 7 * 86400000,
                ).toISOString(),
              });
              await expect(
                service.reviseLine(context, A, {
                  startsAt: single.startsAt.toISOString(),
                  collaboratorId: single.collaboratorId!,
                }),
              ).rejects.toMatchObject({
                response: {
                  message: "Il professionista ha già un appuntamento in quell'orario",
                },
              });
              log.push("double booking refused (trigger and planner)");
            }
            // 6. Move a booking of a paid/closed account with a stale revision.
            const paid = await outer.appointment.findFirst({
              where: {
                tenantId: tenant.id,
                orderItem: { sale: { orderStatus: "confirmed" } },
              },
              include: { orderItem: true },
            });
            if (paid) {
              const free = new Date(paid.startsAt.getTime() + 3 * 86400000 + 17 * 60000);
              await service.reviseLine(context, paid.id, {
                startsAt: free.toISOString(),
                revision: 0,
              });
              expect((await booking(paid.id)).startsAt.toISOString()).toBe(
                free.toISOString(),
              );
              await expect(
                service.reviseLine(context, paid.id, {
                  finalPrice: Number(paid.orderItem!.lineTotal.plus(1)),
                  revision: 0,
                }),
              ).rejects.toThrow();
              log.push("paid account moved at a free time; price change still guarded");
            }
            // 7. Customer change from the booking: whole account follows.
            const otherCustomer = await outer.customer.findFirst({
              where: { tenantId: tenant.id, isActive: true, id: { not: single.customerId } },
            });
            if (otherCustomer) {
              await service.reviseLine(context, A, { customerId: otherCustomer.id });
              row = await booking(A);
              expect(row.customerId).toBe(otherCustomer.id);
              expect(row.orderItem?.sale.customerId).toBe(otherCustomer.id);
              log.push("customer changed on account and bookings");
            }
            // 8. Legacy booking without account row: linked on the fly.
            const legacyId = "00000000-0000-4000-8000-00000000a1a1";
            await outer.$executeRaw`INSERT INTO "Appointment" (id,"tenantId","customerId","serviceId","collaboratorId","startsAt","endsAt",status,source,"estimatedPrice","updatedAt","orderIssue")
              SELECT ${legacyId},"tenantId","customerId","serviceId",NULL,"startsAt"+interval '40 days',"endsAt"+interval '40 days','confirmed',source,25,now(),'ambiguous-or-missing-service-line' FROM "Appointment" WHERE id=${A}`;
            await fresh();
            await service.reviseLine(context, legacyId, { internalNotes: "storico" });
            row = await booking(legacyId);
            expect(row.orderItemId).toBeTruthy();
            expect(row.orderIssue).toBeNull();
            expect(row.orderItem?.sale.total.toFixed(2)).toBe("25.00");
            log.push("legacy booking linked to a new open account");
            throw new Rollback();
          },
          { timeout: 110000, maxWait: 10000 },
        )
        .catch((error) => {
          if (!(error instanceof Rollback)) throw error;
        });
    } finally {
      await prisma.$disconnect();
      console.log(log.join("\n"));
    }
    expect(Prisma).toBeDefined();
  });
});
