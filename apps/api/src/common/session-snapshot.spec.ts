import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { resolveRequestSession } from "./request-session";
import { resolveConnectPermissions } from "./connect-runtime";
import { connectSnapshot, LocalSnapshot, readLocalSnapshot } from "./session-snapshot";
import { resolveOperationalScope } from "../modules/locations/operational-scope";

jest.mock("./connect-runtime", () => ({
  ...jest.requireActual("./connect-runtime"),
  resolveConnectPermissions: jest.fn(async () => ["sales.read"]),
}));

const token = "c".repeat(43);
const local = (overrides: Partial<LocalSnapshot> = {}): LocalSnapshot => ({
  v: 1,
  user: {
    id: "u1",
    tenantId: "t1",
    email: "owner@example.invalid",
    firstName: "Ada",
    lastName: "Rossi",
    role: "owner",
    permissions: [],
    permissionsConfigured: false,
    isActive: true,
    connectSubject: "subject-1",
    collaboratorId: null,
  },
  tenant: { id: "t1", isActive: true, isSuspended: false },
  ...overrides,
});

/** Counts every database call the request makes. */
function database(stored: Record<string, unknown>) {
  const calls: string[] = [];
  const track =
    (name: string, value: unknown) =>
    jest.fn(async () => {
      calls.push(name);
      return value;
    });
  return {
    calls,
    localSession: {
      findUnique: track("localSession.findUnique", {
        id: "ls1",
        userId: "u1",
        familyId: "f1",
        connectSessionId: "cs1",
        technicalAccessId: null,
        accessExpiresAt: new Date(Date.now() + 60_000),
        snapshotVersion: 3,
        ...stored,
      }),
      updateMany: track("localSession.updateMany", { count: 1 }),
    },
    user: {
      findUnique: track("user.findUnique", {
        id: "u1",
        tenantId: "t1",
        email: "owner@example.invalid",
        firstName: "Ada",
        lastName: "Rossi",
        role: "owner",
        permissions: [],
        permissionsConfigured: false,
        isActive: true,
        connectSubject: "subject-1",
        tenant: { id: "t1", isActive: true, isSuspended: false },
        collaborator: null,
      }),
    },
    sector: {
      findMany: track("sector.findMany", [
        { id: "s1", locationId: "l1" },
        { id: "s2", locationId: "l2" },
      ]),
    },
  };
}

describe("session snapshot", () => {
  beforeEach(() => jest.mocked(resolveConnectPermissions).mockClear());

  it("authorizes a request with one token lookup: no profile query, no Connect call", async () => {
    const db = database({
      localSnapshot: local({ sectors: [{ id: "s1", locationId: "l1" }, { id: "s2", locationId: "l2" }] }),
      connectSnapshot: connectSnapshot(["sales.read", "services.read"]),
    });
    const session = await resolveRequestSession(db as never, `Bearer ${token}`);
    const scope = await resolveOperationalScope(db as never, session, { "x-alora-location": "l2" });
    expect(session.user?.connectFunctions).toEqual(["sales.read", "services.read"]);
    expect(scope.sectorIds).toEqual(["s2"]);
    expect(scope.allowedSectorIds).toEqual(["s1", "s2"]);
    expect(db.calls).toEqual(["localSession.findUnique"]);
    expect(resolveConnectPermissions).not.toHaveBeenCalled();
    expect(JSON.stringify(session)).not.toContain("snapshot");
  });

  it("rebuilds a cleared local snapshot once, guarded by its version", async () => {
    const db = database({ localSnapshot: null, connectSnapshot: connectSnapshot(["sales.read"]) });
    const session = await resolveRequestSession(db as never, `Bearer ${token}`);
    await resolveOperationalScope(db as never, session);
    expect(db.calls).toEqual([
      "localSession.findUnique",
      "user.findUnique",
      "localSession.updateMany",
      "sector.findMany",
      "localSession.updateMany",
    ]);
    const writes = db.localSession.updateMany.mock.calls as unknown as Array<[{ where: object; data: { localSnapshot: LocalSnapshot } }]>;
    expect(writes[0][0].where).toEqual({ id: "ls1", snapshotVersion: 3, revokedAt: null });
    expect(writes[1][0].data.localSnapshot.sectors).toHaveLength(2);
    expect(readLocalSnapshot(writes[1][0].data.localSnapshot)?.user.id).toBe("u1");
  });

  it("still rejects a revoked token before reading anything else", async () => {
    const db = database({ revokedAt: new Date(), localSnapshot: local() });
    await expect(resolveRequestSession(db as never, `Bearer ${token}`)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(db.calls).toEqual(["localSession.findUnique"]);
  });

  it("applies a deactivation or suspension captured in the snapshot", async () => {
    const inactive = database({ localSnapshot: local({ user: { ...local().user, isActive: false } }), connectSnapshot: connectSnapshot([]) });
    await expect(resolveRequestSession(inactive as never, `Bearer ${token}`)).rejects.toBeInstanceOf(UnauthorizedException);
    const suspended = database({ localSnapshot: local({ tenant: { id: "t1", isActive: false, isSuspended: true } }), connectSnapshot: connectSnapshot([]) });
    await expect(resolveRequestSession(suspended as never, `Bearer ${token}`)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("reads Connect once for a session opened before snapshots and keeps the result", async () => {
    const db = database({ localSnapshot: local(), connectSnapshot: null });
    const session = await resolveRequestSession(db as never, `Bearer ${token}`);
    expect(session.user?.connectFunctions).toEqual(["sales.read"]);
    expect(resolveConnectPermissions).toHaveBeenCalledTimes(1);
    expect(db.localSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { connectSnapshot: expect.objectContaining({ functions: ["sales.read"] }) } }),
    );
  });

  it("ignores a malformed snapshot and rebuilds it from the database", async () => {
    const db = database({ localSnapshot: { v: 99, user: { id: "intruder", role: "owner" } }, connectSnapshot: connectSnapshot([]) });
    const session = await resolveRequestSession(db as never, `Bearer ${token}`);
    expect(session.user?.id).toBe("u1");
    expect(db.calls).toContain("user.findUnique");
  });

  it("rejects a header outside the snapshot memberships without querying", async () => {
    const db = database({ localSnapshot: local({ sectors: [{ id: "s1", locationId: "l1" }] }), connectSnapshot: connectSnapshot([]) });
    const session = await resolveRequestSession(db as never, `Bearer ${token}`);
    await expect(resolveOperationalScope(db as never, session, { "x-alora-sector": "other" })).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.calls).toEqual(["localSession.findUnique"]);
  });
});
