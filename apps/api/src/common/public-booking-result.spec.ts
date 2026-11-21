import { publicBookingResult } from "./public-booking-result";
it("acknowledges the supplied name without exposing a matched CRM record, staff contacts or internal fields", () => {
  const record = {
    id: "booking",
    status: "requested",
    startsAt: new Date("2030-11-11T10:00:00Z"),
    endsAt: new Date("2030-11-11T10:30:00Z"),
    locationId: "location-a",
    sectorId: "sector-a",
    roomId: "room-a",
    collaboratorId: "professional-a",
    customer: {
      id: "crm-id",
      firstName: "Stored private name",
      email: "private@example.invalid",
      notes: "private-note",
      totalSpent: "999.99",
    },
    service: {
      id: "service-a",
      name: "Trattamento",
      durationMinutes: 30,
      internalDescription: "private-description",
    },
    collaborator: {
      id: "professional-a",
      firstName: "Test",
      lastName: "Professional",
      userId: "private-user",
      email: "private@example.invalid",
      phone: "private-phone",
    },
    internalNotes: "private-internal-note",
  };
  const result = publicBookingResult(record, {
    firstName: "Supplied",
    lastName: "Name",
  });
  expect(result.customer).toEqual({ firstName: "Supplied", lastName: "Name" });
  expect(result.roomId).toBe("room-a");
  expect(result.sectorId).toBe("sector-a");
  expect(JSON.stringify(result)).not.toContain("private");
  expect(JSON.stringify(result)).not.toContain("999.99");
  expect("internalNotes" in result).toBe(false);
});
