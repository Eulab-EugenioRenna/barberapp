/** Anonymous acknowledgement: never serialize the matched CRM record or staff contact data. */
export function publicBookingResult(
  appointment: {
    id: string;
    status: string;
    startsAt: Date;
    endsAt: Date;
    locationId: string;
    sectorId: string;
    roomId: string | null;
    collaboratorId: string | null;
    service: { id: string; name: string; durationMinutes: number };
    collaborator: { id: string; firstName: string; lastName: string } | null;
  },
  enteredName: { firstName: string; lastName: string },
) {
  return {
    id: appointment.id,
    status: appointment.status,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    locationId: appointment.locationId,
    sectorId: appointment.sectorId,
    roomId: appointment.roomId,
    collaboratorId: appointment.collaboratorId,
    customer: {
      firstName: enteredName.firstName,
      lastName: enteredName.lastName,
    },
    service: {
      id: appointment.service.id,
      name: appointment.service.name,
      durationMinutes: appointment.service.durationMinutes,
    },
    collaborator: appointment.collaborator
      ? {
          id: appointment.collaborator.id,
          firstName: appointment.collaborator.firstName,
          lastName: appointment.collaborator.lastName,
        }
      : null,
  };
}
