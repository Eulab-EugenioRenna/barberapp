import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

const entities: Record<string, string> = {
  collaborators: "Collaborator",
  customers: "Customer",
  products: "Product",
  services: "Service",
  serviceProducts: "ServiceProduct",
  appointments: "Appointment",
  cancellations: "AppointmentCancellation",
  sales: "Sale",
  saleItems: "SaleItem",
};
const referenceModels: Record<string, string> = {
  userId: "User",
  customerId: "Customer",
  productId: "Product",
  serviceId: "Service",
  collaboratorId: "Collaborator",
  roomId: "Room",
  appointmentId: "Appointment",
  saleId: "Sale",
};
const tenantWhere = (model: string, tenantId: string) =>
  model === "SaleItem"
    ? { sale: { tenantId } }
    : model === "ServiceProduct"
      ? { service: { tenantId }, product: { tenantId } }
      : model === "AppointmentCancellation"
        ? { appointment: { tenantId } }
        : { tenantId };

// Before any destructive write: reject foreign IDs, foreign references and nested ORM writes.
export async function validateTenantImport(
  tx: Prisma.TransactionClient,
  tenantId: string,
  snapshot: Record<string, any>,
  replace: boolean,
): Promise<void> {
  const incoming = new Map<string, Set<string>>();
  for (const [key, model] of Object.entries(entities)) {
    if (snapshot[key] !== undefined && !Array.isArray(snapshot[key]))
      throw new BadRequestException("Import non valido");
    const ids = new Set<string>();
    for (const row of snapshot[key] ?? []) {
      if (
        !row ||
        typeof row !== "object" ||
        typeof row.id !== "string" ||
        ids.has(row.id)
      )
        throw new BadRequestException("ID import non valido o duplicato");
      ids.add(row.id);
      const fields = Prisma.dmmf.datamodel.models.find(
        (entry) => entry.name === model,
      )!.fields;
      for (const field of Object.keys(row)) {
        if (model === "Service" && field === "collaboratorIds") continue;
        const definition = fields.find((entry) => entry.name === field);
        if (!definition || definition.kind === "object")
          throw new BadRequestException(
            "Relazioni annidate non ammesse nell’import",
          );
      }
      const delegate = (tx as any)[model[0].toLowerCase() + model.slice(1)];
      if (
        await delegate.count({
          where: { id: row.id, NOT: tenantWhere(model, tenantId) },
        })
      )
        throw new BadRequestException("ID appartenente a un’altra attività");
    }
    incoming.set(model, ids);
  }
  for (const [key] of Object.entries(entities)) {
    for (const row of snapshot[key] ?? []) {
      for (const [field, model] of Object.entries(referenceModels)) {
        const id = row[field];
        if (id === undefined || id === null) continue;
        if (typeof id !== "string")
          throw new BadRequestException("Riferimento import non valido");
        if (incoming.get(model)?.has(id)) continue;
        // Replace removes operational rows, but keeps local identities.
        if (replace && model !== "User")
          throw new BadRequestException("Riferimento mancante nell’import");
        const delegate = (tx as any)[model[0].toLowerCase() + model.slice(1)];
        if (
          !(await delegate.count({
            where: { id, ...tenantWhere(model, tenantId) },
          }))
        )
          throw new BadRequestException(
            "Riferimento appartenente a un’altra attività o mancante",
          );
      }
    }
  }
}
