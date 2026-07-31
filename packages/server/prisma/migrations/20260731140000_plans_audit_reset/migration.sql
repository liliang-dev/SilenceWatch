-- Plans and quotas, an audit trail, and password recovery.
--
-- The schema is unconditional; the behaviour is not. A self-hosted instance
-- leaves QUOTAS_ENABLED off and `plan` stays null, which means unlimited — the
-- promise that self-hosting is never the crippled version has to hold at the
-- level of the data model, not just the pricing page.

-- Which plan an account is on. Null means unlimited, which is what every
-- existing row and every self-hosted install gets. Deliberately TEXT rather than
-- an enum: plan names are commercial, they change, and a migration per pricing
-- experiment would be absurd. The limits behind the name live in configuration
-- so that no price and no billing rule enters this repository.
ALTER TABLE "user" ADD COLUMN "plan" TEXT;

-- Why a check is paused. A person pausing a check and a quota pausing it are
-- different events: only the second may be undone automatically when the
-- account moves back under its limit, and confusing the two would silently
-- resume monitoring somebody deliberately switched off.
ALTER TABLE "check" ADD COLUMN "paused_reason" TEXT;

-- Ping-key rotation needs somewhere to say when it last happened, so the UI can
-- tell an operator whether the URL in their crontab is still the current one.
ALTER TABLE "check" ADD COLUMN "ping_key_rotated_at" TIMESTAMPTZ(3);

-- Password reset tokens. A separate table from email_verification on purpose:
-- one namespace per purpose means a verification token can never be spent as a
-- reset token, which is the kind of confusion that turns two safe features into
-- one account takeover.
CREATE TABLE "password_reset" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "requested_ip" TEXT,

    CONSTRAINT "password_reset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "password_reset_token_hash_key" ON "password_reset"("token_hash");
CREATE INDEX "password_reset_user_id_idx" ON "password_reset"("user_id");
CREATE INDEX "password_reset_expires_at_idx" ON "password_reset"("expires_at");

ALTER TABLE "password_reset"
    ADD CONSTRAINT "password_reset_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Security-relevant events. Append-only by convention: nothing in the
-- application updates or deletes a row except the retention purge.
--
-- Actor and project are nullable and NOT foreign keys on delete-cascade by
-- accident: the whole point of an audit trail is that it outlives the thing it
-- describes. Deleting a user must not delete the record that they revoked a key
-- last Tuesday.
CREATE TABLE "audit_event" (
    "id" BIGSERIAL NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "action" TEXT NOT NULL,
    -- Who did it. The email is denormalised so the trail still reads correctly
    -- after the account is gone.
    "actor_user_id" UUID,
    "actor_email" TEXT,
    "actor_api_key_id" UUID,
    -- What it was done to.
    "project_id" UUID,
    "target_type" TEXT,
    "target_id" TEXT,
    "target_label" TEXT,
    -- Where from.
    "ip" TEXT,
    "user_agent" TEXT,
    -- Anything else worth keeping, never secrets.
    "detail" JSONB,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_event_project_id_occurred_at_idx"
    ON "audit_event"("project_id", "occurred_at" DESC);
CREATE INDEX "audit_event_actor_user_id_occurred_at_idx"
    ON "audit_event"("actor_user_id", "occurred_at" DESC);
CREATE INDEX "audit_event_occurred_at_idx" ON "audit_event"("occurred_at");
