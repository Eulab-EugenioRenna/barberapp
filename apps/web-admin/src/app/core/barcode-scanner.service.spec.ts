jest.mock("@angular/core", () => ({
  Injectable: () => (target: unknown) => target,
  inject: jest.fn(),
}));
jest.mock("./session.store", () => ({ SessionStore: class {} }));
import { BarcodeScannerService } from "./barcode-scanner.service";

describe("keyboard wedge scanner", () => {
  let scanner: BarcodeScannerService;
  let now: number;
  let documentTarget: EventTarget;
  let active: any;
  let input: any;
  let received: string[];
  const key = (value: string, gap = 10, extras = {}) => {
    now += gap;
    const event = new Event("keydown", { cancelable: true });
    Object.assign(event, { key: value, ...extras });
    documentTarget.dispatchEvent(event);
    return event;
  };
  const scan = (value: string) => {
    for (const char of value) key(char);
    key("Enter");
  };
  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  beforeEach(() => {
    now = 5000;
    received = [];
    documentTarget = new EventTarget();
    input = Object.assign(new EventTarget(), {
      style: {},
      setAttribute: jest.fn(),
      focus: jest.fn(),
      remove: jest.fn(),
      value: "",
    });
    active = { tagName: "BODY" };
    Object.defineProperty(global, "document", {
      configurable: true,
      value: Object.assign(documentTarget, {
        createElement: () => input,
        body: { appendChild: jest.fn() },
      }),
    });
    Object.defineProperty(documentTarget, "activeElement", {
      get: () => active,
    });
    jest.spyOn(performance, "now").mockImplementation(() => now);
    scanner = new BarcodeScannerService();
    scanner.attach((event) => {
      received.push(event.barcode);
    });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    delete (global as any).document;
  });
  it("keeps the first digit and leading zeroes, commits only on Enter", async () => {
    for (const char of "0012345678905") key(char);
    expect(received).toEqual([]);
    expect(key("Enter").defaultPrevented).toBe(true);
    await settle();
    expect(received).toEqual(["0012345678905"]);
  });
  it("rejects human typing and resets on any long inter-key gap", async () => {
    for (const char of "123456") key(char, 250);
    key("Enter");
    key("A");
    key("B");
    key("C", 250);
    key("Enter");
    await settle();
    expect(received).toEqual([]);
    scan("ABC-123");
    await settle();
    expect(received).toEqual(["ABC-123"]);
  });
  it("does not submit a stale burst on Enter or keyup after a pause", async () => {
    for (const char of "12345") key(char);
    now += 500;
    documentTarget.dispatchEvent(new Event("keyup"));
    key("Enter");
    await settle();
    expect(received).toEqual([]);
  });
  it("discards interrupted scans and ignores modifiers and composition", async () => {
    key("1");
    key("2");
    key("Escape");
    key("3");
    key("Enter");
    key("1", 10, { ctrlKey: true });
    key("Enter");
    key("1", 10, { isComposing: true });
    key("Enter");
    await settle();
    expect(received).toEqual([]);
    key("Shift");
    scan("SKU-42");
    await settle();
    expect(received).toEqual(["SKU-42"]);
  });
  it("never steals focus or intercepts an active text field", async () => {
    expect(input.focus).not.toHaveBeenCalled();
    active = { tagName: "INPUT" };
    scan("12345");
    active = { tagName: "DIV", isContentEditable: true };
    scan("12345");
    await settle();
    expect(received).toEqual([]);
    active = { tagName: "BODY" };
    scan("12345");
    await settle();
    expect(received).toEqual(["12345"]);
  });
  it("serializes asynchronous handlers without losing bursts and survives rejection", async () => {
    let release!: () => void;
    const detach = scanner.attach(async (event) => {
      received.push(`start:${event.barcode}`);
      if (event.barcode === "111")
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      if (event.barcode === "222") throw new Error("lookup failed");
      received.push(`end:${event.barcode}`);
    });
    scan("111");
    scan("222");
    scan("333");
    await settle();
    expect(received).toEqual(["start:111"]);
    release();
    await settle();
    expect(received).toEqual([
      "start:111",
      "end:111",
      "start:222",
      "start:333",
      "end:333",
    ]);
    detach();
  });
  it("routes to the foreground attachment and drops its queued scans on detach", async () => {
    const foreground = jest.fn();
    const detach = scanner.attach(foreground);
    scan("111");
    await settle();
    expect(foreground).toHaveBeenCalledTimes(1);
    expect(received).toEqual([]);
    detach();
    scan("222");
    await settle();
    expect(received).toEqual(["222"]);
  });
});

describe("manual barcode injection", () => {
  it("normalizes spaces and retains leading zeroes and source", async () => {
    const scanner = new BarcodeScannerService();
    // A minimal host verifies the public attachment contract without a browser dependency.
    const host = new EventTarget();
    const input = { style: {}, setAttribute: jest.fn(), remove: jest.fn() };
    Object.defineProperty(global, "document", {
      configurable: true,
      value: Object.assign(host, {
        createElement: () => input,
        body: { appendChild: jest.fn() },
      }),
    });
    try {
      const events: unknown[] = [];
      const detach = scanner.attach((event) => {
        events.push(event);
      });
      scanner.inject(" 00 123  ");
      await Promise.resolve();
      expect(events).toEqual([
        { barcode: "00123", source: "manual", timestamp: expect.any(Number) },
      ]);
      detach();
    } finally {
      delete (global as any).document;
    }
  });
});
