import { slotOptions } from "./slot-options";

describe("slotOptions", () => {
  it("keeps plain options when every slot is inside opening hours", () => {
    expect(
      slotOptions([{ startsAt: "a", label: "09:00" }]),
    ).toEqual([{ value: "a", label: "09:00" }]);
  });
  it("lists slots outside hours after the others, under their own heading", () => {
    const options = slotOptions([
      { startsAt: "early", label: "07:00", outsideHours: true },
      { startsAt: "open", label: "09:00" },
      { startsAt: "late", label: "20:00", outsideHours: true },
    ]);
    expect(options.map((row) => row.value)).toEqual(["open", "early", "late"]);
    expect(options[0].group).toBe("In orario");
    expect(options[2].group).toBe("Fuori orario · non prenotabile online");
  });
});
