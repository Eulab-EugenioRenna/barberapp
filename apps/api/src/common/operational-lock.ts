import type { Prisma } from "@prisma/client";
/** Acquire before row locks in every booking/order/inventory transaction. */
export async function lockOperationalTenant(
  tx: Prisma.TransactionClient,
  tenantId: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId},7))`;
}

export async function setOperationalActor(
  tx: Prisma.TransactionClient,
  actorId: string | null,
  source = "application",
) {
  await tx.$executeRaw`SELECT set_config('alora.actor',${actorId ?? ""},true),set_config('alora.price_source',${source},true)`;
}
