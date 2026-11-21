import { Prisma } from "@prisma/client";
export interface NotificationReadScope {
  sectorIds: string[];
  fullAccess: boolean;
}
/** All sectors present in an immutable account snapshot must remain authorized. Unknown legacy scope is company-only. */
export function notificationReadScope(
  alias: "h" | "i",
  scope: NotificationReadScope,
): Prisma.Sql {
  if (scope.fullAccess) return Prisma.sql`true`;
  const payload = Prisma.raw(`${alias}."payload"`);
  return Prisma.sql`(${payload} #>> '{appointment,sectorId}' = ANY(${scope.sectorIds}::text[])
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(${payload} #> '{eventData,accountAppointments}')='array'
      THEN ${payload} #> '{eventData,accountAppointments}' ELSE '[]'::jsonb END) line
      WHERE line->>'sectorId' IS NULL OR NOT(line->>'sectorId'=ANY(${scope.sectorIds}::text[]))))`;
}
