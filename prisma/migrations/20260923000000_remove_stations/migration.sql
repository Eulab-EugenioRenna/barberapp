-- The legacy "station" concept is replaced by collaborators.
DROP TABLE IF EXISTS "SaleItemStation";

ALTER TABLE "Appointment" DROP CONSTRAINT IF EXISTS "Appointment_stationId_fkey";
ALTER TABLE "Appointment" DROP COLUMN IF EXISTS "stationId";

ALTER TABLE "Service" DROP COLUMN IF EXISTS "requiresStation";

DROP TABLE IF EXISTS "Station";