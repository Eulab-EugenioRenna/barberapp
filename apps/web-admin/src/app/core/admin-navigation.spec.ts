import { ALORA_FUNCTIONS } from "@barber/shared/functions";
import {
  ADMIN_NAV,
  buildMobileItems,
  buildNavGroups,
  navKeyFromUrl,
} from "./admin-navigation";

const allFunctions = ALORA_FUNCTIONS.map((item) => item.key);
const keysOf = (user: any) =>
  buildNavGroups(user).flatMap((group) => group.items.map((item) => item.key));

describe("admin navigation", () => {
  it("gives every section a unique key, a label and a description", () => {
    const keys = ADMIN_NAV.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of ADMIN_NAV) {
      expect(entry.label.trim()).not.toBe("");
      expect(entry.description.trim()).not.toBe("");
    }
  });

  it("shows a full-access owner every company section, grouped in order", () => {
    const owner = { role: "owner", connectFunctions: allFunctions, collaboratorId: "c1" };
    const groups = buildNavGroups(owner);
    expect(groups.map((group) => group.label)).toEqual([
      "Oggi",
      "Clienti",
      "Catalogo",
      "Organizzazione",
      "Il mio lavoro",
    ]);
    expect(keysOf(owner)).toEqual([
      "dashboard",
      "appointments",
      "sales",
      "customers",
      "whatsapp",
      "services",
      "inventory",
      "locations",
      "collaborators",
      "notifications",
      "settings",
      "my-agenda",
      "account",
    ]);
  });

  it("puts locations and inventory in the menu only with their permission", () => {
    const manager = (permissions: string[]) => ({ role: "manager", permissions });
    expect(keysOf(manager(["inventory.read"]))).toContain("inventory");
    expect(keysOf(manager(["inventory.read"]))).not.toContain("locations");
    expect(keysOf(manager(["locations.read"]))).toContain("locations");
    expect(keysOf(manager(["notifications.read"]))).not.toContain("notifications");
    expect(keysOf(manager(["notifications.manage"]))).toContain("notifications");
  });

  it("limits collaborators to their personal area, as the route guard does", () => {
    const collaborator = {
      role: "collaborator",
      collaboratorId: "c1",
      permissions: ["appointments.read.own"],
      permissionsConfigured: true,
    };
    expect(keysOf(collaborator)).toEqual(["my-agenda", "account"]);
    // The bottom bar must still exist: it is the only way to the menu on mobile.
    expect(buildMobileItems(collaborator).map((item) => item.key)).toEqual([
      "my-agenda",
      "account",
    ]);
  });

  it("shows the platform administrator only the platform", () => {
    expect(keysOf({ role: "platform_admin" })).toEqual(["platform"]);
  });

  it("hides the personal account from technical access", () => {
    const technical = { role: "owner", technicalAccess: true };
    expect(keysOf(technical)).not.toContain("account");
  });

  it("carries badges to both sidebar and bottom bar", () => {
    const owner = { role: "owner", connectFunctions: allFunctions };
    // Accounts to close are counted on the till.
    const sidebar = buildNavGroups(owner, { sales: 3 })
      .flatMap((group) => group.items)
      .find((item) => item.key === "sales");
    const bottom = buildMobileItems(owner, { sales: 3 }).find(
      (item) => item.key === "sales",
    );
    expect(sidebar?.badge).toBe(3);
    expect(bottom?.badge).toBe(3);
    expect(buildMobileItems(owner).map((item) => item.key)).toEqual([
      "dashboard",
      "appointments",
      "sales",
      "customers",
    ]);
  });

  it("resolves the active section from the url", () => {
    expect(navKeyFromUrl("/locations")).toBe("locations");
    expect(navKeyFromUrl("/notifications?section=templates")).toBe("notifications");
    expect(navKeyFromUrl("/team")).toBe("collaborators");
    expect(navKeyFromUrl("/confirmations")).toBe("sales");
    expect(navKeyFromUrl("/my-agenda?collaboratorId=x")).toBe("my-agenda");
    expect(navKeyFromUrl("/login")).toBeNull();
  });

  it("shows the till to whoever can close accounts, even without the sales list", () => {
    const closer = { role: "manager", permissions: ["confirmations.read"] };
    expect(keysOf(closer)).toContain("sales");
    expect(keysOf(closer)).not.toContain("confirmations");
  });
});
