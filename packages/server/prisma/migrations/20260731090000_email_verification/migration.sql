-- Email verification and sign-up abuse controls.
--
-- Both are opt-in (EMAIL_VERIFICATION_REQUIRED, SIGNUP_POW_DIFFICULTY): a
-- self-hosted instance behind a VPN has no bot problem and no reason to be made
-- to solve one. The schema is added unconditionally so that turning the flag on
-- later is a restart, not a migration.

-- Existing accounts are treated as verified. Enabling the flag on a running
-- instance must not lock out the team that is already using it.
ALTER TABLE "user" ADD COLUMN "email_verified_at" TIMESTAMPTZ(3);
UPDATE "user" SET "email_verified_at" = "created_at";

-- Single-use verification tokens. Only the SHA-256 is stored: a database leak
-- must not hand over the ability to verify someone else's address.
CREATE TABLE "email_verification" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    -- The address the token was issued for. Kept so that a token stops working
    -- once the account's address changes.
    "email" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

    CONSTRAINT "email_verification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_verification_token_hash_key" ON "email_verification"("token_hash");
CREATE INDEX "email_verification_user_id_idx" ON "email_verification"("user_id");
-- Drives the reaper, which deletes spent and expired rows.
CREATE INDEX "email_verification_expires_at_idx" ON "email_verification"("expires_at");

ALTER TABLE "email_verification"
    ADD CONSTRAINT "email_verification_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sign-up attempts, aggregated per source. Rate limiting lives in memory and is
-- therefore per-instance and lost on restart; this table is what makes a
-- velocity rule hold across instances and across a deploy — which is exactly the
-- window a bot flood exploits.
--
-- The key is a coarse network prefix (IPv4 /24, IPv6 /48), not an address: a
-- residential proxy pool rotates addresses freely but far less often changes
-- the network it rents them from.
CREATE TABLE "signup_attempt" (
    "id" BIGSERIAL NOT NULL,
    "network" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    -- Whether an account was actually created, so a flood of rejected attempts
    -- is distinguishable from real growth when reading the table.
    "accepted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "signup_attempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "signup_attempt_network_created_at_idx"
    ON "signup_attempt"("network", "created_at" DESC);
CREATE INDEX "signup_attempt_created_at_idx" ON "signup_attempt"("created_at");
