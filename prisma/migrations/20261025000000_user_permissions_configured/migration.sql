-- Additive: old applications ignore this flag; existing identities retain their policy.
ALTER TABLE "User" ADD COLUMN "permissionsConfigured" BOOLEAN NOT NULL DEFAULT false;
