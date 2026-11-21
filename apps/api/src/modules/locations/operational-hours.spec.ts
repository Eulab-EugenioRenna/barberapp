import {
  intersectBusinessHours,
  validateClosures,
  validateHours,
} from "./operational-hours";
describe("Location and sector opening intersection", () => {
  const location = {
    weeklyHours: [
      { weekday: 1, isWorkingDay: true, startTime: "08:00", endTime: "20:00" },
    ],
    closures: [],
  };
  it("inherits configured location hours and intersects explicit sector hours", () => {
    expect(
      intersectBusinessHours("2030-11-11", [
        location,
        { weeklyHours: null, closures: [] },
      ]),
    ).toEqual({ startMinutes: 480, endMinutes: 1200 });
    expect(
      intersectBusinessHours("2030-11-11", [
        location,
        {
          weeklyHours: [
            {
              weekday: 1,
              isWorkingDay: true,
              startTime: "09:30",
              endTime: "18:00",
            },
          ],
          closures: [],
        },
      ]),
    ).toEqual({ startMinutes: 570, endMinutes: 1080 });
  });
  it("blocks location or sector closures, missing days, and empty intersections", () => {
    expect(
      intersectBusinessHours("2030-11-11", [
        { ...location, closures: ["2030-11-11"] },
      ]),
    ).toBeNull();
    expect(
      intersectBusinessHours("2030-11-11", [
        location,
        { weeklyHours: null, closures: ["2030-11-11"] },
      ]),
    ).toBeNull();
    expect(intersectBusinessHours("2030-11-12", [location])).toBeNull();
    expect(
      intersectBusinessHours("2030-11-11", [
        location,
        {
          weeklyHours: [
            {
              weekday: 1,
              isWorkingDay: true,
              startTime: "21:00",
              endTime: "22:00",
            },
          ],
          closures: [],
        },
      ]),
    ).toBeNull();
  });
  it("rejects invalid dates, duplicate weekdays, inverted intervals, and malformed inputs", () => {
    for (const value of [["2030-99-11"], ["2030-02-30"], ["invalid"], null, {}])
      expect(() => validateClosures(value)).toThrow();
    expect(validateClosures(["2030-11-11", "2030-11-11"])).toEqual([
      "2030-11-11",
    ]);
    expect(() =>
      validateHours([
        {
          weekday: 1,
          isWorkingDay: true,
          startTime: "20:00",
          endTime: "08:00",
        },
      ]),
    ).toThrow();
    expect(() =>
      validateHours([
        { weekday: 1, isWorkingDay: false },
        { weekday: 1, isWorkingDay: false },
      ]),
    ).toThrow();
    expect(validateHours(null)).toBeNull();
    expect(validateHours([])).toEqual([]);
  });
});
