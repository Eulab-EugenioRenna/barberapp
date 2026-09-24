import {
  focusFirstAvailableControl,
  restoreFocus,
} from "../../../web-admin/src/app/shared/autofocus-first";

describe("focusFirstAvailableControl", () => {
  it("focuses the first available form control without scrolling", () => {
    const focus = jest.fn();
    const querySelector = jest.fn().mockReturnValue({ focus });

    expect(
      focusFirstAvailableControl({ querySelector } as unknown as HTMLElement),
    ).toBe(true);
    expect(querySelector).toHaveBeenCalledWith(
      expect.stringContaining("input:not([disabled])"),
    );
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("does nothing when the modal has no available form control", () => {
    const querySelector = jest.fn().mockReturnValue(null);

    expect(
      focusFirstAvailableControl({ querySelector } as unknown as HTMLElement),
    ).toBe(false);
  });

  it("restores focus only when the opening control is still connected", () => {
    const focus = jest.fn();

    expect(
      restoreFocus({ isConnected: true, focus } as unknown as HTMLElement),
    ).toBe(true);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(
      restoreFocus({ isConnected: false, focus } as unknown as HTMLElement),
    ).toBe(false);
  });
});
