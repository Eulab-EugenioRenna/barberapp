import { BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
export async function assertTenantReferences(
  prisma: PrismaService,
  tenantId: string,
  refs: {
    customerId?: string | null;
    collaboratorId?: string | null;
    roomId?: string | null;
    serviceId?: string | null;
    productId?: string | null;
  },
): Promise<void> {
  const checks = [
    refs.customerId
      ? prisma.customer.count({ where: { id: refs.customerId, tenantId } })
      : 1,
    refs.collaboratorId
      ? prisma.collaborator.count({
          where: { id: refs.collaboratorId, tenantId },
        })
      : 1,
    refs.roomId
      ? prisma.room.count({ where: { id: refs.roomId, tenantId } })
      : 1,
    refs.serviceId !== undefined
      ? prisma.service.count({ where: { id: refs.serviceId ?? "", tenantId } })
      : 1,
    refs.productId !== undefined
      ? prisma.product.count({ where: { id: refs.productId ?? "", tenantId } })
      : 1,
  ];
  if ((await Promise.all(checks)).some((count) => count !== 1))
    throw new BadRequestException(
      "Riferimento non disponibile per questa attività",
    );
}
