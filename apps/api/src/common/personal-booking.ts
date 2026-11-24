import { ForbiddenException } from "@nestjs/common";
import { canUseLocalFunction, requiresOwnAppointmentScope, type LocalIdentity } from "./function-catalog";

interface LineLike {
  collaboratorId?: string;
  finalPrice?: string;
  priceOverrideReason?: string;
  [key: string]: unknown;
}
interface BookingLike extends LineLike {
  lines?: LineLike[];
  internalNotes?: string;
  status?: string;
}

/**
 * «La mia agenda»: a professional without «Agenda · Prenotare» books only in
 * their own agenda. Returns the request with every line on their profile, or
 * the request unchanged for whoever can book for the whole team. A line
 * addressed to another professional is refused, never silently moved.
 * Price overrides and internal notes stay with the salon's agenda.
 */
export function personalBookingInput<T extends object>(user: LocalIdentity | null | undefined, input: T): T {
  if (!requiresOwnAppointmentScope(user, "appointments.create")) return input;
  const body = input as BookingLike;
  const own = user?.collaboratorId;
  if (!own || !canUseLocalFunction(user, "appointments.update.own"))
    throw new ForbiddenException("Per prenotare serve «La mia agenda · Prenotare e aggiornare» e un profilo professionista");
  const assign = (line: LineLike): LineLike => {
    if (line.collaboratorId && line.collaboratorId !== own)
      throw new ForbiddenException("Puoi prenotare solo nella tua agenda");
    const { finalPrice: _price, priceOverrideReason: _reason, ...rest } = line;
    return { ...rest, collaboratorId: own };
  };
  const { internalNotes: _notes, ...top } = assign(body);
  const result: BookingLike = { ...top };
  if (body.lines) result.lines = body.lines.map(assign);
  if (body.status !== undefined && !["requested", "confirmed"].includes(body.status)) result.status = "confirmed";
  return result as T;
}
