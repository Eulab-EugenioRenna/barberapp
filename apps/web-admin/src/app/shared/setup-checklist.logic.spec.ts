import { visibleSetup, type SetupStatus } from "./setup-checklist.logic";

const step = (key: any, done: boolean, optional = false) => ({ key, done, optional, blockedBy: null, detail: null });
const status = (steps: any[]): SetupStatus => ({ steps, completed: steps.filter((s) => s.done).length, total: steps.length });
const all = () => true;

describe("setup checklist", () => {
  it("disappears once the essential steps are done, even with optional ones left", () => {
    const s = status([step("location", true), step("services", true), step("team", true), step("whatsapp", false, true)]);
    expect(visibleSetup(s, all)).toBeNull();
  });

  it("shows what is left while an essential step is missing", () => {
    const s = status([step("location", true), step("services", false), step("whatsapp", false, true)]);
    expect(visibleSetup(s, all)).toEqual(expect.objectContaining({ completed: 1, total: 3 }));
  });

  it("never offers steps of pages the account cannot open", () => {
    const s = status([step("location", false), step("services", false), step("online", false, true)]);
    const result = visibleSetup(s, (view) => view !== "locations" && view !== "settings");
    expect(result?.steps.map((x) => x.key)).toEqual(["services"]);
    expect(result?.total).toBe(1);
  });

  it("shows nothing without steps", () => {
    expect(visibleSetup(null, all)).toBeNull();
    expect(visibleSetup(status([step("location", false)]), () => false)).toBeNull();
  });
});
