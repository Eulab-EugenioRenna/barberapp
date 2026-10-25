import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { connectApplication } from "../../common/connect-application";
import { resolveRequestSession, RequestSession } from "../../common/request-session";
import { openConnect } from "../../common/connect-runtime";
import { authorizeLocalOperation } from "../../common/local-policy.guard";
import { TeamService } from "./team.service";
jest.mock("../../common/connect-application", () => ({ connectApplication: jest.fn() }));
jest.mock("../../common/connect-runtime", () => ({ openConnect: jest.fn() }));
jest.mock("../../common/request-session", () => ({
  ...jest.requireActual("../../common/request-session"), resolveRequestSession: jest.fn(),
}));

describe("Delegated team adapter", () => {
  const findFirst = jest.fn(), teamOverview = jest.fn(), setTeamUserRoles = jest.fn();
  const service = new TeamService({ connectSession: { findFirst } } as unknown as PrismaService);
  const session: RequestSession = { tenantId: "company-a", connectSessionId: "linked-a", user: {
    id: "owner-a", tenantId: "company-a", email: "owner@example.test", firstName: "Owner", lastName: "A", role: "owner", permissions: [], connectFunctions: ["users.manage", "team.manage"],
  } };
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(resolveRequestSession).mockResolvedValue(session);
    findFirst.mockResolvedValue({ sdkSessionCipher: "encrypted" });
    jest.mocked(openConnect).mockReturnValue("server-session-handle");
    jest.mocked(connectApplication).mockResolvedValue({
      services: jest.fn(async (_handle: string, operation: (client: unknown, token: string) => Promise<unknown>) => operation({ teamOverview, setTeamUserRoles }, "provider-token")),
    } as unknown as Awaited<ReturnType<typeof connectApplication>>);
  });
  it("derives the SDK session from the authenticated local account, never a requested tenant", async () => {
    teamOverview.mockResolvedValue({ users: [], canManage: false });
    await expect(service.overview("Bearer local-token")).resolves.toEqual({ users: [], canManage: false });
    expect(findFirst).toHaveBeenCalledWith({ where: { id: "linked-a", userId: "owner-a", revokedAt: null, expiresAt: { gt: expect.any(Date) } }, select: { sdkSessionCipher: true } });
    expect(teamOverview).toHaveBeenCalledWith("provider-token");
  });
  it("rejects a missing or other-user session before contacting Connect", async () => {
    findFirst.mockResolvedValue(null);
    await expect(service.overview("Bearer local-token")).rejects.toBeInstanceOf(UnauthorizedException);
    expect(connectApplication).not.toHaveBeenCalled();
  });
  it("delegates assignments once and retains provider-side privilege checks", async () => {
    setTeamUserRoles.mockRejectedValue(new Error('Connect 403: {"sensitive":"must not escape"}'));
    await expect(service.assignRoles("Bearer local-token", "target-subject", ["role-id"])).rejects.toThrow("Operazione fuori dalla delega Connect o dalla licenza");
    expect(setTeamUserRoles).toHaveBeenCalledTimes(1);
    expect(setTeamUserRoles).toHaveBeenCalledWith("provider-token", "target-subject", ["role-id"]);
  });
  it("keeps operation failures outside the SDK session callback and preserves local HTTP errors", async () => {
    let callbackRejected = false;
    const services = jest.fn(async (_handle: string, operation: (client: unknown, token: string) => Promise<unknown>) => {
      try { return await operation({}, "provider-token"); }
      catch (error) { callbackRejected = true; throw error; }
    });
    jest.mocked(connectApplication).mockResolvedValue({ services } as unknown as Awaited<ReturnType<typeof connectApplication>>);
    await expect(service.withTeam("Bearer local-token", async () => { throw new ForbiddenException("Local policy denied"); })).rejects.toThrow("Local policy denied");
    expect(callbackRejected).toBe(false);
    expect(services).toHaveBeenCalledTimes(1);
  });
  it("requires an explicit Connect grant for the new write capability, even for owners", () => {
    const readOnly = { ...session, user: { ...session.user!, connectFunctions: ["users.manage"] } };
    expect(() => authorizeLocalOperation(readOnly, "TeamController", "overview")).not.toThrow();
    for (const operation of ["createRole", "updateRole", "removeRole", "assignRoles", "revoke", "restore"])
      expect(() => authorizeLocalOperation(readOnly, "TeamController", operation)).toThrow(ForbiddenException);
    expect(() => authorizeLocalOperation(session, "TeamController", "createRole")).not.toThrow();
  });
  it("requires both local permission and the Connect grant for delegated managers", () => {
    const manager = { ...session, user: { ...session.user!, role: "manager", permissions: ["users.manage"] } };
    expect(() => authorizeLocalOperation(manager, "TeamController", "createRole")).toThrow(ForbiddenException);
    expect(() => authorizeLocalOperation({ ...manager, user: { ...manager.user, permissions: ["team.manage"] } }, "TeamController", "createRole")).not.toThrow();
  });
});
