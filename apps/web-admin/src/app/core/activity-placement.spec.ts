import { activityLocationIds, offeredAt, sectorForActivity } from "./activity-placement";

const sectors = [
  { id: "b-centro", locationId: "centro", activityId: "barberia" },
  { id: "e-centro", locationId: "centro", activityId: "estetica" },
  { id: "b-mare", locationId: "mare", activityId: "barberia" },
  { id: "e-mare", locationId: "mare", activityId: "estetica", isActive: false },
];

describe("activity placement", () => {
  it("finds the activity's sector at a location", () => {
    expect(sectorForActivity(sectors, "barberia", "mare")?.id).toBe("b-mare");
    expect(sectorForActivity(sectors, "estetica", "mare")).toBeUndefined();
  });

  it("offers a service only where its activity runs", () => {
    const pulizia = { activityId: "estetica", sectorId: "e-centro" };
    expect(offeredAt(sectors, pulizia, "centro")).toBe(true);
    expect(offeredAt(sectors, pulizia, "mare")).toBe(false);
    expect(offeredAt(sectors, pulizia, "")).toBe(true);
  });

  it("lists the locations of an activity", () => {
    expect(activityLocationIds(sectors, "barberia")).toEqual(["centro", "mare"]);
    expect(activityLocationIds(sectors, "estetica")).toEqual(["centro"]);
  });
});
