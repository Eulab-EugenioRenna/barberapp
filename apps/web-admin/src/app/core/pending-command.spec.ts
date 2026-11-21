import {
  beginPendingCommand,
  clearPendingCommand,
  readPendingCommand,
} from "@barber/shared/utils";
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
describe("pending creation recovery", () => {
  it("freezes the attempted payload before form edits and retains its operational context", () => {
    const saved = storage(),
      body = { customerName: "Input name", lines: [{ serviceId: "one" }] };
    const original = beginPendingCommand(saved, "actor:tenant:booking", body, {
      "X-Alora-Location": "site",
      "X-Alora-Sector": "",
    });
    body.lines[0].serviceId = "changed";
    expect(readPendingCommand(saved, "actor:tenant:booking")).toEqual({
      kind: "pending",
      command: original,
    });
    expect(original.body["lines"]).toEqual([{ serviceId: "one" }]);
  });
  it("does not create a new key while an earlier outcome is pending", () => {
    const saved = storage(),
      original = beginPendingCommand(saved, "form", { total: "10" });
    expect(() => beginPendingCommand(saved, "form", { total: "20" })).toThrow();
    clearPendingCommand(saved, "form", "another-key");
    expect(readPendingCommand(saved, "form")).toEqual({
      kind: "pending",
      command: original,
    });
    clearPendingCommand(saved, "form", original.body.idempotencyKey);
    expect(readPendingCommand(saved, "form")).toEqual({ kind: "empty" });
  });
  it("keeps namespaces isolated and refuses corrupt state or credential headers", () => {
    const saved = storage();
    beginPendingCommand(saved, "tenant-a:actor-a", {});
    expect(readPendingCommand(saved, "tenant-b:actor-a").kind).toBe("empty");
    saved.setItem("broken", "not json");
    expect(readPendingCommand(saved, "broken").kind).toBe("unreadable");
    expect(() => beginPendingCommand(saved, "broken", {})).toThrow();
    expect(() =>
      beginPendingCommand(
        saved,
        "credentials",
        {},
        { Authorization: "secret" },
      ),
    ).toThrow();
  });
});
