import { ForbiddenException } from "@nestjs/common";
import { personalBookingInput } from "./personal-booking";
import { authorizeLocalOperation } from "./local-policy.guard";
import type { RequestSession } from "./request-session";

const collaborator = { role: "collaborator", permissions: [], collaboratorId: "me" };
const session = (user: Record<string, unknown>) =>
  ({ tenantId: "t1", user: { id: "u1", tenantId: "t1", ...user } }) as unknown as RequestSession;

describe("personalBookingInput («La mia agenda»)", () => {
  it("books a professional in their own agenda when no professional is given", () => {
    const result = personalBookingInput(collaborator, {
      collaboratorId: undefined as string | undefined,
      idempotencyKey: "key-12345678",
      lines: [{ serviceId: "s1" }],
      startsAt: "2026-12-01T09:00:00.000Z",
    });
    expect(result.collaboratorId).toBe("me");
    expect(result.lines).toEqual([{ serviceId: "s1", collaboratorId: "me" }]);
  });

  it("accepts the professional's own id", () => {
    const result = personalBookingInput(collaborator, { lines: [{ serviceId: "s1", collaboratorId: "me" }] });
    expect(result.lines?.[0].collaboratorId).toBe("me");
  });

  it("refuses to book another professional, in the request or in a line", () => {
    expect(() => personalBookingInput(collaborator, { collaboratorId: "other", serviceId: "s1" })).toThrow(ForbiddenException);
    expect(() =>
      personalBookingInput(collaborator, { lines: [{ serviceId: "s1", collaboratorId: "me" }, { serviceId: "s2", collaboratorId: "other" }] }),
    ).toThrow("Puoi prenotare solo nella tua agenda");
  });

  it("drops price overrides and internal notes and keeps only booking statuses", () => {
    const result = personalBookingInput(collaborator, {
      finalPrice: "1.00",
      priceOverrideReason: "x",
      internalNotes: "nota",
      status: "checked_in",
      lines: [{ serviceId: "s1", finalPrice: "1.00", priceOverrideReason: "x" }],
    });
    expect(result).not.toHaveProperty("finalPrice");
    expect(result).not.toHaveProperty("internalNotes");
    expect(result.lines?.[0]).toEqual({ serviceId: "s1", collaboratorId: "me" });
    expect(result.status).toBe("confirmed");
  });

  it("needs a professional profile and the personal permission", () => {
    expect(() => personalBookingInput({ ...collaborator, collaboratorId: null }, { serviceId: "s1" })).toThrow(ForbiddenException);
    expect(() =>
      personalBookingInput({ ...collaborator, permissionsConfigured: true, permissions: ["appointments.read.own"] }, { serviceId: "s1" }),
    ).toThrow(ForbiddenException);
  });

  it("leaves the request unchanged for whoever books for the whole team", () => {
    const body = { collaboratorId: "other", finalPrice: "10.00", lines: [{ serviceId: "s1", collaboratorId: "other" }] };
    expect(personalBookingInput({ role: "owner", collaboratorId: "me" }, body)).toBe(body);
  });
});

describe("personal booking operations", () => {
  it("let a professional reach booking, slots, agenda context and the customer list", () => {
    for (const [controller, operation] of [
      ["AppointmentsController", "create"],
      ["AppointmentsController", "previewAvailability"],
      ["AppointmentsController", "context"],
      ["CustomersController", "options"],
    ])
      expect(() => authorizeLocalOperation(session(collaborator), controller, operation)).not.toThrow();
  });

  it("keep the customer records and the team agenda closed to a professional", () => {
    expect(() => authorizeLocalOperation(session(collaborator), "CustomersController", "findAll")).toThrow(ForbiddenException);
    expect(() => authorizeLocalOperation(session(collaborator), "AppointmentsController", "update")).toThrow(ForbiddenException);
  });

  it("stay closed when the owner removed the personal permission", () => {
    const restricted = { ...collaborator, permissionsConfigured: true, permissions: ["appointments.read.own"] };
    expect(() => authorizeLocalOperation(session(restricted), "AppointmentsController", "create")).toThrow(ForbiddenException);
  });
});
