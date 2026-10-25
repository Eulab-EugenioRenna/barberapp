import { PrismaClient } from "@prisma/client";
import { connectAccounts } from "./connect-accounts";
describe("SDK domain resource restriction", () => {
  const findUnique = jest.fn();
  const accounts = connectAccounts({ user: { findUnique } } as unknown as PrismaClient, code => { throw new Error(code); });
  const profile = { localUserId: "u1", localTenantId: "t1" };
  beforeEach(() => findUnique.mockResolvedValue({ id: "u1", tenantId: "t1", isActive: true, role: "manager", permissions: ["appointments.read.own", "services.read"], tenant: { isActive: true, isSuspended: false }, collaborator: { id: "p1", tenantId: "t1", isActive: true } }));
  it("limits own-scoped functions even when the operational role is manager", async () => {
    expect(await accounts.restrict(profile, "appointments.read.own", { tenantId: "t1", collaboratorId: "p1" })).toBe(true);
    expect(await accounts.restrict(profile, "appointments.read.own", { tenantId: "t1", collaboratorId: "p2" })).toBe(false);
  });
  it("denies a resource belonging to another tenant", async () => {
    expect(await accounts.restrict(profile, "appointments.read.own", { tenantId: "t2", collaboratorId: "p1" })).toBe(false);
  });
  it("requires an active personal association for own function authorization", async () => {
    const user = await findUnique();findUnique.mockResolvedValue({ ...user, collaborator: null });
    expect(await accounts.restrict(profile, "appointments.read.own", undefined)).toBe(false);
  });
  it("retains ordinary company function checks", async () => {
    expect(await accounts.restrict(profile, "services.read", { tenantId: "t1" })).toBe(true);
    expect(await accounts.restrict(profile, "services.read", { tenantId: "t2" })).toBe(false);
  });
});
