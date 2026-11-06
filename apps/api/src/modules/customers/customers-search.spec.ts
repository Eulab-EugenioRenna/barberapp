import { CustomersController } from "./customers.controller";

jest.mock("../../common/request-session", () => ({
  resolveRequestSession: jest.fn().mockResolvedValue({ tenantId: "tenant-1" }),
  requireTenantId: jest.fn().mockReturnValue("tenant-1"),
}));

describe("customer lookup", () => {
  const request = { headers: { authorization: "Bearer token" } };
  const prisma = {
    customer: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  };
  const controller = new CustomersController(
    prisma as never,
    { getOrSet: (_key: string, _ttl: number, fetch: () => unknown) => fetch() } as never,
    {} as never,
    { ensureDailyAlignmentQueued: jest.fn() } as never,
  );

  it.each<[string, string[]]>([
    ["  Mario   Rossi  ", ["Mario", "Rossi"]],
    ["Rossi Mario", ["Rossi", "Mario"]],
    ["Maria De Luca", ["Maria", "De", "Luca"]],
    ["mario@example.test", ["mario@example.test"]],
    ["3331234567", ["3331234567"]],
  ])("searches every part of %s across customer fields", async (search, terms) => {
    await controller.findAll(request, { search, pageSize: "5" });

    expect(prisma.customer.findMany).toHaveBeenLastCalledWith({
      where: {
        tenantId: "tenant-1",
        AND: terms.map((term) => ({
          OR: ["firstName", "lastName", "email", "phone"].map((field) => ({
            [field]: { contains: term, mode: "insensitive" },
          })),
        })),
      },
      orderBy: { createdAt: "desc" },
      skip: 0,
      take: 5,
    });
  });

  it("keeps the unfiltered list paginated", async () => {
    await controller.findAll(request, { search: "  ", page: "2", pageSize: "50" });

    expect(prisma.customer.findMany).toHaveBeenLastCalledWith({
      where: { tenantId: "tenant-1" },
      orderBy: { createdAt: "desc" },
      skip: 50,
      take: 50,
    });
  });

  it("loads all names for the tenant's filter without pagination or contact details", async () => {
    await controller.options(request);

    expect(prisma.customer.findMany).toHaveBeenLastCalledWith({
      where: { tenantId: "tenant-1" },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { id: "asc" }],
    });
  });
});
