import {
  COLLABORATOR_FUNCTIONS,
  ROLE_OPTIONS,
  changeRoleOption,
  roleScope,
  sameFunctions,
} from "./team-role-options";

describe("People role presets", () => {
  it("keeps the collaborator preset personal and excludes company and financial grants", () => {
    expect(COLLABORATOR_FUNCTIONS).toEqual([
      "appointments.read.own",
      "appointments.update.own",
    ]);
    expect(roleScope(COLLABORATOR_FUNCTIONS)).toBe("collaborator");
    expect(roleScope(["appointments.read.own", "sales.read"])).toBe("manager");
  });
  it("requires personal activities for economic values and removes values when those activities are removed", () => {
    const personal = ROLE_OPTIONS.find((o) => o.id === "personal")!;
    const values = ROLE_OPTIONS.find((o) => o.id === "personal-values")!;
    const selected = changeRoleOption([], values, true);
    expect(selected).toEqual(
      expect.arrayContaining([
        ...COLLABORATOR_FUNCTIONS,
        "dashboard.personal.values.read",
      ]),
    );
    expect(changeRoleOption(selected, personal, false)).toEqual([]);
  });
  it("keeps recovery coupled to explicit access administration", () => {
    const recovery = ROLE_OPTIONS.find((o) => o.id === "recovery")!;
    const team = ROLE_OPTIONS.find((o) => o.id === "team")!;
    const keys = changeRoleOption([], recovery, true);
    expect(keys).toEqual(
      expect.arrayContaining([
        "users.manage",
        "team.manage",
        "team.password.reset",
      ]),
    );
    expect(changeRoleOption(keys, team, false)).not.toContain(
      "team.password.reset",
    );
  });
  it("preserves unrelated and partial historical grants when changing a capability group", () => {
    const cash = ROLE_OPTIONS.find((o) => o.id === "cash")!;
    const before = ["services.read", "appointments.read.own"];
    expect(
      changeRoleOption(changeRoleOption(before, cash, true), cash, false),
    ).toEqual(before);
    expect(before).toEqual(["services.read", "appointments.read.own"]);
    expect(sameFunctions(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameFunctions(["a"], ["a", "b"])).toBe(false);
  });
});
