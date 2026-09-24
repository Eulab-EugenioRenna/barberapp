import { parseAppointmentOrderSseFrame } from "../../../web-admin/src/app/core/sse.utils";

describe("parseAppointmentOrderSseFrame", () => {
  it("reads the appointments snapshot from a Nest SSE frame", () => {
    const frame = [
      "event: appointment.awaiting_order",
      'data: {"appointments":[{"id":"appointment-1"}]}',
    ].join("\n");

    expect(parseAppointmentOrderSseFrame(frame)).toEqual([
      { id: "appointment-1" },
    ]);
  });

  it("ignores malformed and heartbeat frames", () => {
    expect(parseAppointmentOrderSseFrame("event: heartbeat")).toBeNull();
    expect(parseAppointmentOrderSseFrame("data: not-json")).toBeNull();
  });
});
