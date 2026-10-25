import { ForbiddenException, ConflictException } from "@nestjs/common";
import { validate } from "class-validator";
import { TeamLocalPolicyService } from "./team-local-policy.service";
import { PrismaService } from "../../prisma/prisma.service";
import { TeamService } from "./team.service";
import { TeamController } from "./team.controller";
import { authorizeLocalOperation } from "../../common/local-policy.guard";

describe("Owner professional association", () => {
  const actor = { email: "owner@example.test", firstName: "Owner", lastName: "A", id: "owner-a", tenantId: "tenant-a", role: "owner", connectFunctions: ["team.manage"] };
  const user = { ...actor, connectSubject: "subject-a", connectInstallationId: "installation-a", collaborator: null };
  const target = { localUserId: actor.id, subject: "subject-a", accessRevoked: false, identityEnabled: true, membershipEnabled: true };
  let session: { tenantId: string; user: typeof actor };
  const overview = { canManage: true, installationId: "installation-a", users: [target] };
  const findFirst = jest.fn(), findProfessional = jest.fn(), updateMany = jest.fn(), userUpdate = jest.fn();
  const tx = { $executeRaw: jest.fn(), user: { findFirst, update: userUpdate }, collaborator: { findFirst: findProfessional, updateMany } };
  const transaction = jest.fn(async (operation) => operation(tx));
  const teamOverview = jest.fn();
  const team = { withTeam: jest.fn((_authorization, operation) => operation({ teamOverview }, "token", session)) };
  const service = new TeamLocalPolicyService({ $transaction: transaction } as unknown as PrismaService, team as unknown as TeamService);
  beforeEach(() => {
    jest.clearAllMocks();
    session = { tenantId: actor.tenantId, user: { ...actor } };
    teamOverview.mockResolvedValue(overview);
    findFirst.mockResolvedValue(user);
    findProfessional.mockResolvedValue({ id: "professional-a", userId: null });
    updateMany.mockResolvedValue({ count: 1 });
  });
  it("derives owner and tenant from the session and never writes the account policy", async () => {
    await expect(service.associateSelf("Bearer local", "professional-a")).resolves.toEqual({ id: actor.id, collaborator: { id: "professional-a" } });
    expect(findFirst).toHaveBeenCalledWith({ where: { id: actor.id, tenantId: actor.tenantId, role: "owner" }, include: { collaborator: true } });
    expect(userUpdate).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenLastCalledWith({ where: { id: "professional-a", tenantId: actor.tenantId, isActive: true, OR: [{ userId: null }, { userId: actor.id }] }, data: { userId: actor.id } });
  });
  it("allows an explicit removal without changing roles or permissions", async () => {
    await expect(service.associateSelf(undefined, null)).resolves.toEqual({ id: actor.id, collaborator: null });
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(userUpdate).not.toHaveBeenCalled();
  });
  it("rejects managers and owners without the explicit Connect grant", async () => {
    for (const change of [{ role: "manager" }, { connectFunctions: [] }]) {
      session.user = { ...actor, ...change };
      await expect(service.associateSelf(undefined, "professional-a")).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(transaction).not.toHaveBeenCalled();
  });
  it("requires an active explicit mapping and a manageable installation", async () => {
    for (const change of [{ users: [] }, { canManage: false }, { users: [{ ...target, accessRevoked: true }] }, { users: [{ ...target, membershipEnabled: false }] }, { users: [{ ...target, identityEnabled: false }] }]) {
      teamOverview.mockResolvedValue({ ...overview, ...change });
      await expect(service.associateSelf(undefined, "professional-a")).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(transaction).not.toHaveBeenCalled();
  });
  it("refuses mismatched identities/installations and historical cross-tenant links", async () => {
    for (const change of [{ connectSubject: "other" }, { connectInstallationId: null }, { collaborator: { id: "foreign", tenantId: "other" } }]) {
      findFirst.mockResolvedValue({ ...user, ...change });
      await expect(service.associateSelf(undefined, null)).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(updateMany).not.toHaveBeenCalled();
  });
  it("refuses another account's professional before detaching the old link", async () => {
    findProfessional.mockResolvedValue({ userId: "another-account" });
    await expect(service.associateSelf(undefined, "occupied")).rejects.toBeInstanceOf(ConflictException);
    expect(updateMany).not.toHaveBeenCalled();
  });
  it("guards the final assignment against reassignment or deactivation", async () => {
    updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await expect(service.associateSelf(undefined, "professional-a")).rejects.toBeInstanceOf(ConflictException);
  });
  it("classifies the command under team.manage and requires an explicit nullable ID", async () => {
    const readOnly = { ...session, user: { ...actor, connectFunctions: ["users.manage"] } };
    expect(() => authorizeLocalOperation(readOnly, "TeamController", "associateSelf")).toThrow(ForbiddenException);
    const [Dto] = Reflect.getMetadata("design:paramtypes", TeamController.prototype, "associateSelf").slice(1);
    expect(await validate(Object.assign(new Dto(), { collaboratorId: null }))).toHaveLength(0);
    expect(await validate(Object.assign(new Dto(), { collaboratorId: "legacy-id" }))).toHaveLength(0);
    expect((await validate(new Dto())).length).toBeGreaterThan(0);
  });
});
