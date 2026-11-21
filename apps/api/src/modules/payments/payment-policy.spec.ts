import { authorizeLocalOperation } from "../../common/local-policy.guard";
import type { RequestSession } from "../../common/request-session";
function session(
  role: string,
  permissions: string[],
  connectFunctions: string[] = permissions,
): RequestSession {
  return {
    tenantId: "tenant",
    user: {
      id: "actor",
      tenantId: "tenant",
      email: "synthetic@example.invalid",
      firstName: "Synthetic",
      lastName: "Actor",
      role,
      permissions,
      connectFunctions,
      permissionsConfigured: true,
      collaboratorId: "professional",
    },
  };
}
describe("account payment permissions", () => {
  it("separates consulting movements from recording money", () => {
    const reader = session("manager", ["sales.read"]);
    expect(() =>
      authorizeLocalOperation(reader, "PaymentLedgerController", "read"),
    ).not.toThrow();
    expect(() =>
      authorizeLocalOperation(reader, "PaymentLedgerController", "record"),
    ).toThrow();
    expect(() =>
      authorizeLocalOperation(
        session("manager", ["sales.manage"]),
        "PaymentLedgerController",
        "record",
      ),
    ).not.toThrow();
  });
  it("Connect denial still overrides a local sales grant", () => {
    expect(() =>
      authorizeLocalOperation(
        session("manager", ["sales.manage"], []),
        "PaymentLedgerController",
        "record",
      ),
    ).toThrow();
    expect(() =>
      authorizeLocalOperation(
        session("owner", ["sales.manage"], []),
        "PaymentLedgerController",
        "record",
      ),
    ).toThrow();
  });
  it.each(["collaborator", "platform_admin"])(
    "does not expose company payments to %s",
    (role) => {
      for (const operation of ["read", "record"])
        expect(() =>
          authorizeLocalOperation(
            session(role, ["sales.read", "sales.manage"]),
            "PaymentLedgerController",
            operation,
          ),
        ).toThrow();
    },
  );
});
