import { Prisma } from "@prisma/client";
export const SALE_COMMAND_INCLUDE = {
  items: {
    include: {
      product: true,
      service: true,
      collaborator: true,
      booking: {
        select: {
          id: true,
          status: true,
          startsAt: true,
          endsAt: true,
          collaboratorId: true,
        },
      },
    },
  },
  customer: true,
  collaborator: true,
  appointment: {
    include: { customer: true, service: true, collaborator: true },
  },
} as const;
type SaleDetails = Prisma.SaleGetPayload<{
  include: typeof SALE_COMMAND_INCLUDE;
}>;
const person = (
  row: { id: string; firstName: string; lastName: string } | null,
) =>
  row ? { id: row.id, firstName: row.firstName, lastName: row.lastName } : null;
/** Freeze the command's economic acknowledgement, excluding CRM notes/contacts and purchase costs. */
export function saleCommandResult(sale: SaleDetails): Prisma.InputJsonObject {
  const { items, customer, collaborator, appointment, ...account } = sale;
  const result = {
    ...account,
    customer: person(customer),
    collaborator: person(collaborator),
    appointment: appointment
      ? {
          id: appointment.id,
          customerId: appointment.customerId,
          serviceId: appointment.serviceId,
          collaboratorId: appointment.collaboratorId,
          startsAt: appointment.startsAt,
          endsAt: appointment.endsAt,
          status: appointment.status,
          orderItemId: appointment.orderItemId,
          customer: person(appointment.customer),
          service: {
            id: appointment.service.id,
            name: appointment.service.name,
            durationMinutes: appointment.service.durationMinutes,
          },
          collaborator: person(appointment.collaborator),
        }
      : null,
    items: items.map(({ product, service, collaborator, ...row }) => ({
      ...row,
      product: product
        ? {
            id: product.id,
            name: product.name,
            price: product.price,
            priceMode: product.priceMode,
            vatRate: product.vatRate,
          }
        : null,
      service: service
        ? {
            id: service.id,
            name: service.name,
            durationMinutes: service.durationMinutes,
          }
        : null,
      collaborator: person(collaborator),
    })),
  };
  return JSON.parse(JSON.stringify(result)) as Prisma.InputJsonObject;
}
