import { authorizeLocalOperation } from "./local-policy.guard";
import { RequestSession } from "./request-session";
function session(role: string, permissions: string[] = []): RequestSession {
  return {
    tenantId: "t1",
    user: {
      id: "u1",
      tenantId: "t1",
      email: "u@test.it",
      firstName: "U",
      lastName: "S",
      role,
      permissions,
      collaboratorId: "c1",
    },
  };
}
describe("transitional local authorization", () => {
  it.each([
    "DashboardController",
    "SalesController",
    "CustomersController",
    "UsersController",
    "TenantController",
    "NotificationsController",
  ])("denies collaborator access to %s", (controller) => {
    expect(() =>
      authorizeLocalOperation(
        session("collaborator", ["dashboard.revenue.read"]),
        controller,
        "findAll",
      ),
    ).toThrow();
  });
  it("permits only own operational agenda for collaborators", () => {
    expect(() =>
      authorizeLocalOperation(
        session("collaborator"),
        "AppointmentsController",
        "findAll",
      ),
    ).not.toThrow();
    expect(() =>
      authorizeLocalOperation(
        session("collaborator"),
        "AppointmentsController",
        "update",
      ),
    ).toThrow();
  });
  it.each(["manager", "reception"])(
    "requires explicit permissions for %s",
    (role) => {
      expect(() =>
        authorizeLocalOperation(session(role), "SalesController", "create"),
      ).toThrow();
      expect(() =>
        authorizeLocalOperation(
          session(role, ["sales.manage"]),
          "SalesController",
          "create",
        ),
      ).not.toThrow();
      expect(() =>
        authorizeLocalOperation(
          session(role, ["sales.manage"]),
          "PlatformAdminController",
          "tenants",
        ),
      ).toThrow();
    },
  );
  it("requires full client access for customer filter names", () => {
    for (const role of ["manager", "reception", "collaborator"]) {
      expect(() => authorizeLocalOperation(session(role, ["appointments.read.all"]), "CustomersController", "options")).toThrow();
    }
    expect(() => authorizeLocalOperation(session("manager", ["clients.read.full"]), "CustomersController", "options")).not.toThrow();
    expect(() => authorizeLocalOperation(session("platform_admin"), "CustomersController", "options")).toThrow();
  });
  it("keeps platform administration separate", () => {
    expect(() =>
      authorizeLocalOperation(
        session("platform_admin"),
        "ServicesController",
        "update",
      ),
    ).toThrow();
  });
});
