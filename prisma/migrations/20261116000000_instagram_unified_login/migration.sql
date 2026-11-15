-- Unified Login: system-user tokens may not expire, and Meta can revoke them.
ALTER TABLE "instagram_accounts" ALTER COLUMN "token_expires_at" DROP NOT NULL;
ALTER TABLE "instagram_accounts" ADD COLUMN "needs_reconnect" BOOLEAN NOT NULL DEFAULT false;
