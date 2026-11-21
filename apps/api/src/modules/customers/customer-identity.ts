import { BadRequestException } from "@nestjs/common";
import type { Customer, Prisma } from "@prisma/client";
import type { CustomerIdentityInput } from "./customers.types";
/** CRM identity only. This module never reads or modifies User/Connect identities. */
export async function resolveCustomerIdentity(
  client: Pick<Prisma.TransactionClient, "customer">,
  input: CustomerIdentityInput,
  enrich = true,
): Promise<Customer> {
  const normalized = {
    firstName: input.firstName.trim().toLowerCase(),
    lastName: input.lastName.trim().toLowerCase(),
    email: input.email?.trim().toLowerCase() || null,
    phone: input.phone?.replace(/\s+/g, "") || null,
  };
  if (
    !normalized.firstName ||
    !normalized.lastName ||
    normalized.firstName.length > 120 ||
    normalized.lastName.length > 120 ||
    (normalized.email?.length || 0) > 320 ||
    (normalized.phone?.length || 0) > 50
  )
    throw new BadRequestException("Dati cliente non validi");
  const candidates = await client.customer.findMany({
    where: {
      tenantId: input.tenantId,
      isActive: true,
      firstName: { equals: normalized.firstName, mode: "insensitive" },
      lastName: { equals: normalized.lastName, mode: "insensitive" },
    },
    orderBy: { createdAt: "asc" },
  });
  const matched = candidates.find((candidate) => {
    const email = candidate.email?.trim().toLowerCase() || null,
      phone = candidate.phone?.replace(/\s+/g, "") || null;
    if (normalized.email && email && normalized.email !== email) return false;
    if (normalized.phone && phone && normalized.phone !== phone) return false;
    if (!normalized.email && !normalized.phone) return !email && !phone;
    return !!(
      (normalized.email && email === normalized.email) ||
      (normalized.phone && phone === normalized.phone)
    );
  });
  if (matched)
    return enrich
      ? client.customer.update({
          where: { id: matched.id },
          data: {
            email: matched.email || normalized.email || undefined,
            phone: matched.phone || normalized.phone || undefined,
          },
        })
      : matched;
  return client.customer.create({
    data: {
      tenantId: input.tenantId,
      firstName: normalized.firstName,
      lastName: normalized.lastName,
      email: normalized.email || undefined,
      phone: normalized.phone || undefined,
      privacyConsent: true,
    },
  });
}
