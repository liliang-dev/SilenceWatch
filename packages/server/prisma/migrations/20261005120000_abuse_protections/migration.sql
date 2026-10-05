-- Protections against abuse of the hosted service. Additive, and inert until the
-- settings that read these columns are turned on.

-- Keyed hash of the network an account was created from, for one-account-per-address.
-- Never the address itself, and null for every account that already exists.
ALTER TABLE "user" ADD COLUMN "signup_network" TEXT;
CREATE INDEX "user_signup_network_idx" ON "user"("signup_network");

-- When a test alert was last sent from a channel: the cooldown between two reads this
-- column and claims it in one statement, so two requests cannot both pass.
ALTER TABLE "notification_channel" ADD COLUMN "last_tested_at" TIMESTAMPTZ(3);

-- Resolved incidents are now purged with the pings, and the purge finds them by when they ended.
CREATE INDEX "incident_resolved_at_idx" ON "incident"("resolved_at");
