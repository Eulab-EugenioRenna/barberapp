-- Separate migration: PostgreSQL must commit the enum value before workflow statements can use it.
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'queued';
