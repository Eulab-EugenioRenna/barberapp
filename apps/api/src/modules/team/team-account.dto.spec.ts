import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { TeamController } from "./team.controller";
import { authorizeLocalOperation } from "../../common/local-policy.guard";
const [, Create] = Reflect.getMetadata("design:paramtypes", TeamController.prototype, "createAccount");
const [, , Resume] = Reflect.getMetadata("design:paramtypes", TeamController.prototype, "resumeAccount");
const body = { id: "7b6d2b34-15c5-41a6-9b88-fce6347f105a", email: " NEW@EXAMPLE.TEST ", firstName: " New ", lastName: " Person ", role: "collaborator", permissions: ["appointments.read.own"], roleIds: ["93435f60-9fb8-4e27-ae5d-3139ecb62463"], collaboratorId: "legacy-opaque-id" };
describe("Delegated account input boundary", () => {
  it("normalizes profile fields and permits an absent transient password", async () => {
    const input = plainToInstance(Create, body) as typeof body;
    expect(await validate(input)).toHaveLength(0);
    expect(input.email).toBe("new@example.test");expect(input.firstName).toBe("New");
    expect(await validate(plainToInstance(Resume, {}))).toHaveLength(0);
  });
  it.each([{ role: "owner" }, { role: "platform_admin" }, { roleIds: [] }, { roleIds: [body.roleIds[0], body.roleIds[0]] }, { permissions: ["unknown.function"] }, { initialPassword: null }, { initialPassword: "" }, { firstName: "  " }, { id: "not-uuid" }])("rejects invalid account input %j", async change => {
    expect((await validate(plainToInstance(Create, { ...body, ...change }))).length).toBeGreaterThan(0);
  });
  it("requires team.manage for creation, recovery and the pending list", () => {
    const session = { tenantId: "t", user: { id: "u", tenantId: "t", email: "owner@example.test", firstName: "Owner", lastName: "A", role: "owner", connectFunctions: ["users.manage"] } };
    for (const method of ["pendingAccounts", "createAccount", "resumeAccount"]) expect(() => authorizeLocalOperation(session, "TeamController", method)).toThrow();
  });
});
