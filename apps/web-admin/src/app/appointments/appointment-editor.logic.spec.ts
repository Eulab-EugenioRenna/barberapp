import {
  BUSY_WARNING,
  DEFAULT_CANCEL_REASON,
  REMOVED_LINE_REASON,
  addMinutes,
  applySequence,
  buildCreate,
  followsPrevious,
  lineChanged,
  missingForSave,
  overlapsBusy,
  planEdit,
  rowInstant,
  splitLocal,
  type EditInput,
  type EditorRow,
} from "./appointment-editor.logic";

const minutes = (id: string) => ({ cut: 30, beard: 20 })[id as "cut" | "beard"];

function held(id: string, serviceId: string, startsAt: string, duration = 30, collaboratorId = "anna"): EditorRow {
  const { date, time } = splitLocal(startsAt);
  return {
    key: id,
    appointmentId: id,
    orderItemId: "item-" + id,
    serviceId,
    collaboratorId,
    date,
    time,
    follow: false,
    status: "confirmed",
    held: {
      serviceId,
      collaboratorId,
      startsAt: new Date(startsAt).toISOString(),
      local: `${date}T${time}`,
      durationMinutes: duration,
    },
  };
}

function edit(overrides: Partial<EditInput>): EditInput {
  return {
    anchorId: "a1",
    rows: [],
    removed: [],
    status: "confirmed",
    statusTouched: false,
    reason: "",
    customerId: "c1",
    originalCustomerId: "c1",
    notes: "",
    originalNotes: "",
    revision: 4,
    ...overrides,
  };
}

describe("appointment editor logic", () => {
  it("adds minutes in local time, across midnight too", () => {
    expect(addMinutes("2026-11-27", "09:30", 30)).toEqual({ date: "2026-11-27", time: "10:00" });
    expect(addMinutes("2026-11-27", "23:50", 20)).toEqual({ date: "2026-11-28", time: "00:10" });
  });

  it("keeps the stored instant of an untouched row", () => {
    const row = held("a1", "cut", "2026-11-27T09:00:00.000Z");
    expect(rowInstant(row)).toBe("2026-11-27T09:00:00.000Z");
    expect(rowInstant({ ...row, time: "11:15" })).toBe(new Date(2026, 10, 27, 11, 15).toISOString());
    expect(rowInstant({ ...row, time: "9" })).toBeNull();
  });

  it("moves following services with the first, never the free ones", () => {
    const first: EditorRow = { key: "1", serviceId: "cut", collaboratorId: "", date: "2026-11-27", time: "10:00", follow: false, status: "" };
    const second: EditorRow = { ...first, key: "2", serviceId: "beard", follow: true, time: "" };
    const third: EditorRow = { ...first, key: "3", serviceId: "cut", follow: false, time: "15:00" };
    const rows = applySequence([first, second, third], minutes);
    expect(rows.map((row) => row.time)).toEqual(["10:00", "10:30", "15:00"]);
    const moved = applySequence([{ ...first, time: "11:00" }, second, third], minutes);
    expect(moved.map((row) => row.time)).toEqual(["11:00", "11:30", "15:00"]);
  });

  it("uses the held duration for an unchanged service", () => {
    const first = held("a1", "cut", "2026-11-27T09:00:00.000Z", 45);
    const second = { ...held("a2", "beard", "2026-11-27T09:45:00.000Z", 20), follow: true };
    const shifted = applySequence([{ ...first, time: addMinutes(first.date, first.time, 15).time }, second], minutes);
    expect(shifted[1].time).toBe(addMinutes(first.date, first.time, 60).time);
  });

  it("recognises rows already in sequence", () => {
    expect(followsPrevious({ startsAt: "2026-11-27T09:00:00Z", endsAt: "2026-11-27T09:30:00Z" }, { startsAt: "2026-11-27T09:30:00.000Z", endsAt: "x" })).toBe(true);
    expect(followsPrevious(undefined, { startsAt: "2026-11-27T09:30:00Z", endsAt: "x" })).toBe(false);
  });

  it("warns about a busy professional, not about cancelled bookings or itself", () => {
    const row = held("a1", "cut", "2026-11-27T09:00:00.000Z");
    const busy = [
      { id: "x", collaboratorId: "anna", startsAt: "2026-11-27T09:15:00.000Z", endsAt: "2026-11-27T09:45:00.000Z" },
    ];
    expect(overlapsBusy(row, 30, busy)).toBe(true);
    expect(overlapsBusy(row, 30, [{ ...busy[0], status: "cancelled" }])).toBe(false);
    expect(overlapsBusy(row, 30, [{ ...busy[0], id: "a1" }])).toBe(false);
    expect(overlapsBusy({ ...row, collaboratorId: "" }, 30, busy)).toBe(false);
    expect(BUSY_WARNING).toBe("Il professionista ha già un appuntamento in quell'orario");
  });

  it("sends nothing when nothing changed", () => {
    const row = held("a1", "cut", "2026-11-27T09:00:00.000Z");
    expect(lineChanged(row)).toBe(false);
    expect(planEdit(edit({ rows: [row] }))).toEqual([]);
  });

  it("saves one service with one PATCH: time, status, customer and notes together", () => {
    const row = { ...held("a1", "cut", "2026-11-27T09:00:00.000Z"), time: "11:00" };
    const ops = planEdit(
      edit({ rows: [row], status: "completed", statusTouched: true, customerId: "c2", notes: "Sfumatura" }),
    );
    expect(ops).toEqual([
      {
        kind: "patch",
        appointmentId: "a1",
        body: {
          serviceId: "cut",
          startsAt: new Date(2026, 10, 27, 11, 0).toISOString(),
          collaboratorId: "anna",
          status: "completed",
          customerId: "c2",
          customerNotes: "Sfumatura",
        },
      },
    ]);
  });

  it("cancels with the typed reason or the default one, and reactivates freely", () => {
    const row = held("a1", "cut", "2026-11-27T09:00:00.000Z");
    expect(planEdit(edit({ rows: [row], status: "cancelled", statusTouched: true }))[0].body).toEqual({
      status: "cancelled",
      reason: DEFAULT_CANCEL_REASON,
    });
    expect(
      planEdit(edit({ rows: [row], status: "cancelled", statusTouched: true, reason: "Malato" }))[0].body,
    ).toEqual({ status: "cancelled", reason: "Malato" });
    const cancelled = { ...row, status: "cancelled" };
    expect(planEdit(edit({ rows: [cancelled], status: "confirmed", statusTouched: true }))[0].body).toEqual({
      status: "confirmed",
    });
  });

  it("revises the whole booking when a service is added", () => {
    const row = held("a1", "cut", "2026-11-27T09:00:00.000Z");
    const added: EditorRow = { key: "n", serviceId: "beard", collaboratorId: "", date: row.date, time: "09:30", follow: true, status: "" };
    const ops = planEdit(edit({ rows: [row, added], notes: "x" }));
    expect(ops[0]).toEqual({
      kind: "revise",
      appointmentId: "a1",
      body: {
        revision: 4,
        lines: [
          { appointmentId: "a1", orderItemId: "item-a1", serviceId: "cut", startsAt: row.held!.startsAt, collaboratorId: "anna" },
          { serviceId: "beard", startsAt: new Date(2026, 10, 27, 9, 30).toISOString() },
        ],
      },
    });
    expect(ops[1]).toEqual({ kind: "patch", appointmentId: "a1", body: { customerNotes: "x" } });
  });

  it("moves two services together in one revision, so they never clash in between", () => {
    const first = { ...held("a1", "cut", "2026-11-27T09:00:00.000Z"), time: "09:30" };
    const second = { ...held("a2", "beard", "2026-11-27T09:30:00.000Z", 20), time: "10:00" };
    const ops = planEdit(edit({ rows: [first, second] }));
    expect(ops.map((op) => op.kind)).toEqual(["revise"]);
  });

  it("takes a removed service out by cancelling only that one", () => {
    const first = held("a1", "cut", "2026-11-27T09:00:00.000Z");
    const second = held("a2", "beard", "2026-11-27T09:30:00.000Z", 20);
    expect(planEdit(edit({ rows: [first], removed: [second] }))).toEqual([
      { kind: "patch", appointmentId: "a2", body: { status: "cancelled", reason: REMOVED_LINE_REASON } },
    ]);
  });

  it("puts the notes on the opened appointment", () => {
    const first = held("a1", "cut", "2026-11-27T09:00:00.000Z");
    const second = held("a2", "beard", "2026-11-27T09:30:00.000Z", 20);
    expect(planEdit(edit({ anchorId: "a2", rows: [first, second], notes: "n" }))).toEqual([
      { kind: "patch", appointmentId: "a2", body: { customerNotes: "n" } },
    ]);
  });

  it("creates every service with its own time", () => {
    const rows: EditorRow[] = [
      { key: "1", serviceId: "cut", collaboratorId: "anna", date: "2026-11-27", time: "10:00", follow: false, status: "" },
      { key: "2", serviceId: "beard", collaboratorId: "", date: "2026-11-27", time: "10:30", follow: true, status: "" },
    ];
    const payload = buildCreate({ customerId: "c1", rows, status: "confirmed", notes: "", locationId: "l1", whatsAppConsent: true });
    expect(payload).toEqual({
      customerId: "c1",
      appointmentWhatsAppConsent: true,
      status: "confirmed",
      customerNotes: "",
      locationId: "l1",
      startsAt: new Date(2026, 10, 27, 10, 0).toISOString(),
      lines: [
        { serviceId: "cut", startsAt: new Date(2026, 10, 27, 10, 0).toISOString(), collaboratorId: "anna" },
        { serviceId: "beard", startsAt: new Date(2026, 10, 27, 10, 30).toISOString() },
      ],
    });
  });

  it("says in words what is missing", () => {
    const row: EditorRow = { key: "1", serviceId: "cut", collaboratorId: "", date: "2026-11-27", time: "", follow: false, status: "" };
    expect(missingForSave({ customerId: "", rows: [row] })).toBe("Scegli il cliente");
    expect(missingForSave({ customerId: "c", rows: [] })).toBe("Tocca almeno un servizio");
    expect(missingForSave({ customerId: "c", rows: [row] })).toBe("Scegli o scrivi l'ora");
    expect(missingForSave({ customerId: "c", rows: [{ ...row, time: "10:00" }] })).toBe("");
  });
});
