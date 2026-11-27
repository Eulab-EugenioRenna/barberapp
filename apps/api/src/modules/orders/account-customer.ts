import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { stopAutomationRuns } from "../notifications/appointment-automation-state";

/**
 * Corregge il cliente sbagliato di un conto: conto e tutte le sue prenotazioni
 * cambiano insieme, importi e incassi restano. Un promemoria WhatsApp in attesa
 * per il cliente precedente viene annullato (era indirizzato alla persona sbagliata).
 * Il chiamante tiene il lock operativo, registra eventi e operazione.
 */
export async function changeAccountCustomer(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; saleId: string; customerId: string },
): Promise<{ previousCustomerId: string | null }> {
  const { tenantId, saleId, customerId } = input;
  if (!customerId) throw new BadRequestException("Scegli il cliente giusto");
  const sale = await tx.sale.findFirst({
    where: { id: saleId, tenantId },
    select: { id: true, customerId: true, orderStatus: true },
  });
  if (!sale) throw new NotFoundException("Vendita non trovata");
  if (sale.orderStatus === "cancelled")
    throw new ConflictException("Il conto annullato conserva il suo cliente");
  if (sale.customerId === customerId)
    throw new BadRequestException("Il conto è già di questo cliente");
  const customer = await tx.customer.findFirst({
    where: { id: customerId, tenantId, isActive: true },
    select: { id: true },
  });
  if (!customer) throw new BadRequestException("Cliente non valido");
  const waiting = await tx.appointmentAutomationRun.findMany({
    where: { tenantId, orderId: saleId, status: "waiting" },
    select: { id: true },
  });
  await stopAutomationRuns(
    tx,
    tenantId,
    waiting.map((run) => run.id),
    "cancelled",
    "Cliente del conto corretto",
  );
  await tx.appointment.updateMany({
    where: { tenantId, orderItem: { saleId } },
    data: { customerId },
  });
  await tx.sale.update({
    where: { id: saleId, tenantId },
    data: { customerId, revision: { increment: 1 } },
  });
  return { previousCustomerId: sale.customerId };
}
