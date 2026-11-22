import { localizeServices } from "./activity-sectors";

const sectors = [
  { id: "barber-centro", locationId: "centro", activityId: "barberia", isActive: true },
  { id: "estetica-centro", locationId: "centro", activityId: "estetica", isActive: true },
  { id: "barber-mare", locationId: "mare", activityId: "barberia", isActive: true },
];

function client() {
  return {
    sector: {
      findFirst: jest.fn(async ({ where }: any) =>
        sectors.find((row) => row.id === where.id) ?? null,
      ),
      findMany: jest.fn(async ({ where }: any) =>
        sectors.filter(
          (row) =>
            row.locationId === where.locationId &&
            where.activityId.in.includes(row.activityId),
        ),
      ),
    },
  } as any;
}

const taglio = {
  id: "s1",
  name: "Taglio",
  activityId: "barberia",
  sectorId: "barber-centro",
  sector: { locationId: "centro" },
};
const pulizia = {
  id: "s2",
  name: "Pulizia viso",
  activityId: "estetica",
  sectorId: "estetica-centro",
  sector: { locationId: "centro" },
};

describe("localizeServices", () => {
  it("uses the activity's sector at the chosen location", async () => {
    const [row] = await localizeServices(client(), "t", [taglio], { locationId: "mare" });
    expect(row.sectorId).toBe("barber-mare");
  });

  it("falls back to the home sector's location", async () => {
    const rows = await localizeServices(client(), "t", [taglio, pulizia]);
    expect(rows.map((row) => row.sectorId)).toEqual(["barber-centro", "estetica-centro"]);
  });

  it("refuses a service whose activity is not run at the location", async () => {
    await expect(
      localizeServices(client(), "t", [pulizia], { locationId: "mare" }),
    ).rejects.toThrow("«Pulizia viso» non è disponibile in questa sede");
  });

  it("rejects a sector of another location", async () => {
    await expect(
      localizeServices(client(), "t", [taglio], { locationId: "centro", sectorId: "barber-mare" }),
    ).rejects.toThrow("non appartiene alla sede");
  });
});
