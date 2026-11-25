jest.mock("@alora/ui", () => ({ UiSelectComponent: class {} }));
jest.mock("@angular/core", () => ({
  Component: () => (target: unknown) => target,
  Input: () => () => undefined,
  Output: () => () => undefined,
  EventEmitter: class { emit() {} },
}));
import { timeOptions } from "./time-select.component";

describe("timeOptions", () => {
  it("lists the day every five minutes", () => {
    const options = timeOptions("");
    expect(options).toHaveLength(288);
    expect(options[0].value).toBe("00:00");
    expect(options.at(-1)!.value).toBe("23:55");
  });
  it("keeps a saved time outside the grid, in order", () => {
    const options = timeOptions("09:07");
    expect(options).toHaveLength(289);
    const index = options.findIndex((row) => row.value === "09:07");
    expect(options[index - 1].value).toBe("09:05");
    expect(options[index + 1].value).toBe("09:10");
  });
});
