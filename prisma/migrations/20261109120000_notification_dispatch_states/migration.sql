-- Add values separately before the migration that uses the extended state model.
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'dispatching';
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'uncertain';
