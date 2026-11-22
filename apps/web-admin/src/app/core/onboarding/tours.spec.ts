import { ALORA_FUNCTIONS, canAccessLocalView, canUseLocalFunction } from "@barber/shared/functions";
import { ADMIN_NAV } from "../admin-navigation";
import type { TourContext } from "./tour.types";
import { ADMIN_TOURS } from "./tours";
import { GENERAL_TOUR } from "./tours/general.tour";

const allFunctions = ALORA_FUNCTIONS.map((item) => item.key);
const ctxFor = (user: any, isMobile = false): TourContext => ({
  user,
  role: user.role,
  firstName: user.firstName ?? "",
  tenant: null,
  can: (key) => canUseLocalFunction(user, key),
  canView: (view) => canAccessLocalView(user, view),
  isMobile,
});
const targetsOf = (ctx: TourContext) =>
  GENERAL_TOUR.steps(ctx)
    .filter((step) => !step.when || step.when(ctx))
    .map((step) => step.target)
    .filter(Boolean);

describe("onboarding tours", () => {
  it("has one tour per menu section plus the general one, with unique ids", () => {
    const ids = ADMIN_TOURS.map((tour) => tour.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of ADMIN_NAV) {
      expect(ADMIN_TOURS.some((tour) => tour.navKey === entry.key)).toBe(true);
    }
  });

  it("walks an owner through every section the menu shows", () => {
    const owner = { role: "owner", firstName: "Anna Maria", connectFunctions: allFunctions, collaboratorId: "c1" };
    const ctx = ctxFor(owner);
    const visible = ADMIN_NAV.filter((entry) => entry.isVisible(owner)).map((entry) => `nav-${entry.key}`);
    expect(targetsOf(ctx)).toEqual(expect.arrayContaining(visible));
    expect(String(GENERAL_TOUR.steps(ctx)[0].title)).toContain("Anna");
  });

  it("never points a collaborator to sections they cannot open", () => {
    const collaborator = { role: "collaborator", collaboratorId: "c1", connectFunctions: ["appointments.read.own"] };
    const targets = targetsOf(ctxFor(collaborator));
    expect(targets).not.toContain("nav-sales");
    expect(targets).not.toContain("nav-settings");
    expect(targets).not.toContain("nav-platform");
  });

  it("on mobile shows the bottom bar and lists the rest under «Altro»", () => {
    const owner = { role: "owner", connectFunctions: allFunctions, collaboratorId: "c1" };
    const targets = targetsOf(ctxFor(owner, true));
    expect(targets).toContain("nav-more");
    expect(targets).not.toContain("nav-settings");
    expect(targets).not.toContain("shell-rail");
  });

  it("offers page tours only to accounts that can open the page", () => {
    const collaborator = ctxFor({ role: "collaborator", collaboratorId: "c1", connectFunctions: ["appointments.read.own"] });
    const platform = ctxFor({ role: "platform_admin" });
    const available = (ctx: TourContext) =>
      ADMIN_TOURS.filter((tour) => tour.navKey && (!tour.when || tour.when(ctx))).map((tour) => tour.navKey);
    expect(available(collaborator)).not.toContain("sales");
    expect(available(collaborator)).not.toContain("platform");
    expect(available(platform)).toContain("platform");
    expect(available(platform)).not.toContain("sales");
  });
});
