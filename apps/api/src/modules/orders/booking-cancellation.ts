import type { Prisma } from "@prisma/client";

export function customerCancellationAllowed(startsAt: Date, now = new Date()) {
  return startsAt.getTime() - now.getTime() >= 24 * 3600000;
}
/** Shared agenda/account mutation. Money, payments, materials and stock are never changed here. */
export async function applyBookingCancellation(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string;
    appointmentIds: string[];
    allStopped: boolean;
    actorId: string | null;
    cancelledByType: "staff" | "customer";
    cancelledById: string | null;
    reason: string;
    policyResult: string;
  },
) {
  for (const id of input.appointmentIds) {
    await tx.appointment.update({
      where: { id },
      data: { status: "cancelled", updatedById: input.actorId },
    });
    await tx.appointmentCancellation.create({
      data: {
        appointmentId: id,
        cancelledByType: input.cancelledByType,
        cancelledById: input.cancelledById,
        reason: input.reason,
        policyResult: input.policyResult,
        refundStatus: "not_requested",
      },
    });
  }
  await tx.sale.update({
    where: { id: input.orderId },
    data: {
      revision: { increment: 1 },
      ...(input.allStopped ? { orderStatus: "cancelled" as const } : {}),
    },
  });
}
