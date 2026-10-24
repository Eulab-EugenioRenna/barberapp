-- Preserve historical rows; provider tokens for new sessions live only in the official SDK store.
ALTER TABLE "ConnectSession" ADD COLUMN "sdkSessionCipher" TEXT;
