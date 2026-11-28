import { sectorSettingsFor } from "./locations.controller";

describe("sectorSettingsFor", () => {
  it("adds an existing activity to a location without asking for a name", () => {
    expect(sectorSettingsFor({ activityId: "a1", isPublic: false }, true)).toEqual({ isPublic: false });
  });

  it("still requires a valid name when a new activity is created", () => {
    expect(() => sectorSettingsFor({ name: "" }, false)).toThrow("Inserisci un nome entro 120 caratteri");
    expect(sectorSettingsFor({ name: " Estetica " }, false)).toEqual({});
  });
});
