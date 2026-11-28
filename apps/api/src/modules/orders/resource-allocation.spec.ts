import {
  allocateBookingResources,
  ResourceSearchLimitError,
  roomFits,
  type ResourceDemand,
} from "./resource-allocation";
const demand = (
  collaboratorIds: Array<string | null>,
  extra: Partial<ResourceDemand> = {},
): ResourceDemand => ({
  start: 0,
  end: 30,
  collaboratorIds,
  rooms: [{ id: null, capacity: 0 }],
  ...extra,
});
describe("multi-service resource allocation", () => {
  it("finds a complete assignment when picking the first professional would fail", () => {
    const plan = allocateBookingResources(
      [demand(["A", "B"]), demand(["A"])],
      [],
    );
    expect(plan?.map((row) => row.collaboratorId)).toEqual(["B", "A"]);
  });
  it("preserves each fixed requested time and detects conflicts inside the same account", () => {
    const lines = [
      demand(["A"], { start: 10, end: 40 }),
      demand(["A"], { start: 39, end: 60 }),
    ];
    expect(allocateBookingResources(lines, [])).toBeNull();
    lines[1].start = 40;
    expect(
      allocateBookingResources(lines, [])?.map((row) => [row.start, row.end]),
    ).toEqual([
      [10, 40],
      [40, 60],
    ]);
  });
  it("a sequence of one client runs back to back: buffers count only against other bookings", () => {
    // Shave 10:00–10:30 with 10' cleanup after, then cut 10:30–11:00 with 5' before: same person.
    const shave = demand(["A"], { start: 0, end: 40, core: { start: 0, end: 30 } });
    const cut = demand(["A"], { start: 25, end: 60, core: { start: 30, end: 60 } });
    expect(allocateBookingResources([shave, cut], [])?.map((row) => row.collaboratorId)).toEqual(["A", "A"]);
    // Another client's booking inside the cleanup still blocks.
    expect(allocateBookingResources([shave], [{ start: 35, end: 50, collaboratorId: "A", roomId: null }])).toBeNull();
    // Truly overlapping services of the same request still collide.
    const overlap = demand(["A"], { start: 20, end: 50, core: { start: 20, end: 50 } });
    expect(allocateBookingResources([shave, overlap], [])).toBeNull();
    // Same for a one-seat room used by the whole sequence.
    const room = [{ id: "R", capacity: 1 }];
    expect(
      allocateBookingResources(
        [demand([null], { ...shave, collaboratorIds: [null], rooms: room }), demand([null], { ...cut, collaboratorIds: [null], rooms: room })],
        [],
      )?.map((row) => row.roomId),
    ).toEqual(["R", "R"]);
  });
  it("shares professionals across sectors/sites and honors existing buffered intervals", () => {
    expect(
      allocateBookingResources(
        [demand(["A"])],
        [{ start: -10, end: 1, collaboratorId: "A", roomId: null }],
      ),
    ).toBeNull();
    expect(
      allocateBookingResources(
        [demand(["A", "B"])],
        [{ start: -10, end: 1, collaboratorId: "A", roomId: null }],
      )?.[0].collaboratorId,
    ).toBe("B");
  });
  it("counts peak occupancy rather than rejecting two successive bookings in a capacity-two room", () => {
    const existing = [
      { start: 0, end: 15, collaboratorId: null, roomId: "R" },
      { start: 15, end: 30, collaboratorId: null, roomId: "R" },
    ];
    expect(roomFits({ start: 0, end: 30 }, "R", 2, existing)).toBe(true);
    expect(
      allocateBookingResources(
        [demand([null], { rooms: [{ id: "R", capacity: 2 }] })],
        existing,
      )?.[0].roomId,
    ).toBe("R");
    expect(roomFits({ start: 0, end: 30 }, "R", 1, existing)).toBe(false);
  });
  it("coordinates both room capacity and professional choice across all lines", () => {
    const lines = [
      demand(["A", "B"], {
        rooms: [
          { id: "R1", capacity: 1 },
          { id: "R2", capacity: 1 },
        ],
      }),
      demand(["A"], { rooms: [{ id: "R1", capacity: 1 }] }),
    ];
    const plan = allocateBookingResources(lines, []);
    expect(plan?.map((row) => [row.collaboratorId, row.roomId])).toEqual([
      ["B", "R2"],
      ["A", "R1"],
    ]);
    expect(
      allocateBookingResources(
        [
          demand([null], { rooms: [{ id: "R", capacity: 2 }] }),
          demand([null], { rooms: [{ id: "R", capacity: 2 }] }),
          demand([null], { rooms: [{ id: "R", capacity: 2 }] }),
        ],
        [],
      ),
    ).toBeNull();
  });
  it("returns unavailable for empty candidate sets and keeps resource-free work explicit", () => {
    expect(allocateBookingResources([demand([])], [])).toBeNull();
    expect(
      allocateBookingResources([demand([null], { rooms: [] })], []),
    ).toBeNull();
    expect(allocateBookingResources([demand([null])], [])?.[0]).toEqual({
      start: 0,
      end: 30,
      collaboratorId: null,
      roomId: null,
    });
  });
  it("distinguishes an exhausted search budget from a proven lack of resources", () => {
    expect(() =>
      allocateBookingResources([demand(["A"]), demand(["B"])], [], 1),
    ).toThrow(ResourceSearchLimitError);
  });
  it("rejects invalid spans and duplicate/corrupt resource capacities", () => {
    expect(() =>
      allocateBookingResources([demand(["A"], { end: 0 })], []),
    ).toThrow();
    expect(() => allocateBookingResources([demand(["A", "A"])], [])).toThrow();
    expect(() =>
      allocateBookingResources(
        [demand([null], { rooms: [{ id: "R", capacity: 0 }] })],
        [],
      ),
    ).toThrow();
  });
});
