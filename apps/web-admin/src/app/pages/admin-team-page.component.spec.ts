import { of, throwError } from "rxjs";
const providers = new Map<unknown, unknown>();
jest.mock("@angular/core", () => ({
  Component: () => (target: unknown) => target,
  Input: () => () => undefined,
  Output: () => () => undefined,
  HostListener: () => () => undefined,
  EventEmitter: class {
    emit = jest.fn();
  },
  inject: (token: unknown) => providers.get(token),
}));
jest.mock("@angular/common", () => ({ CommonModule: {} }));
jest.mock("@angular/forms", () => ({ FormsModule: {} }));
jest.mock("@angular/router", () => ({ RouterLink: class {} }));
jest.mock("@angular/common/http", () => ({ HttpClient: class {} }));
jest.mock("../core/session.store", () => ({ SessionStore: class {} }));
jest.mock("../shared/autofocus-first.directive", () => ({
  AutofocusFirstDirective: class {},
}));
import { HttpClient } from "@angular/common/http";
import { SessionStore } from "../core/session.store";
import { AdminTeamPageComponent } from "./admin-team-page.component";
import type { TeamOverview, TeamUser } from "@eulab/connect/server";
const own = ["appointments.read.own", "appointments.update.own"];
const roles = [
  { id: "custom", name: "Stilista", permissions: own },
  { id: "preset", name: "Collaboratore", permissions: own },
];
const user = {
  subject: "worker",
  localUserId: "local-worker",
  displayName: "Worker",
  roles: [roles[1]],
  accessRevoked: false,
  identityEnabled: true,
  membershipEnabled: true,
} as unknown as TeamUser;
const local = {
  id: "local-worker",
  firstName: "Worker",
  lastName: "A",
  role: "collaborator",
  permissions: own,
  permissionsConfigured: true,
  collaborator: { id: "professional" },
};
let http: { get: jest.Mock; put: jest.Mock; post: jest.Mock };
let page: AdminTeamPageComponent;
beforeEach(() => {
  providers.clear();
  http = {
    get: jest.fn(),
    put: jest.fn(() => of({})),
    post: jest.fn(() => of({})),
  };
  providers.set(HttpClient, http);
  providers.set(SessionStore, {
    can: () => true,
    currentUser: () => ({ id: "owner", role: "owner" }),
  });
  page = new AdminTeamPageComponent();
  page.overview = {
    canManage: true,
    roles,
    users: [user],
    functions: own.map((key) => ({ key, delegable: true })),
    delegation: own.map((key) => ({ key })),
  } as unknown as TeamOverview;
  page.local = {
    users: [local],
    collaborators: [
      {
        id: "professional",
        firstName: "Worker",
        lastName: "A",
        userId: local.id,
      },
    ],
  };
  http.get.mockImplementation((url) =>
    of(
      url.endsWith("/team")
        ? page.overview
        : url.endsWith("/team/local-users")
          ? page.local
          : [],
    ),
  );
});
describe("Unified people and roles", () => {
  it("does not relabel an explicitly created custom role as a preset", () => {
    const person = page.people[0];
    expect(page.label(person)).toBe("Collaboratore");
    page.open(person);
    page.editAccess();
    expect(page.choice).toBe("preset:collaborator");
    page.overview!.users = [
      { ...user, roles: [roles[0]] } as unknown as TeamUser,
    ];
    expect(page.label(page.people[0])).toBe("Stilista");
    expect(page.customRoles.map((role) => role.id)).toEqual(["custom"]);
    page.open(page.people[0]);
    page.editAccess();
    expect(page.choice).toBe("custom");
    expect(http.put).not.toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
  });
  it("requires an explicit choice before replacing a composed role assignment", () => {
    page.overview!.users = [{ ...user, roles } as unknown as TeamUser];
    page.open(page.people[0]);
    page.editAccess();
    expect(page.choice).toBe("");
    expect(page.choiceAvailable(page.choice)).toBe(false);
  });
  it("restricts local access before a role change and stops on a partial failure without retry", async () => {
    page.open(page.people[0]);
    page.editAccess();
    page.choice = "custom";
    http.put
      .mockImplementationOnce(() => of({}))
      .mockImplementationOnce(() => throwError(() => new Error("uncertain")));
    await page.saveAccess();
    expect(http.put).toHaveBeenCalledTimes(2);
    expect(http.put.mock.calls[0]).toEqual([
      "/api/team/local-users/local-worker/policy",
      { role: "collaborator", permissions: [], collaboratorId: "professional" },
    ]);
    expect(http.put.mock.calls[1][0]).toBe("/api/team/users/worker/roles");
    expect(page.feedback).toContain("Modifica da completare");
    expect(page.busy).toBe(false);
  });
});
