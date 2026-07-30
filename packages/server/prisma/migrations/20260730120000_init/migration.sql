-- SilenceWatch initial schema.
--
-- The tail of this file (see "hand-written objects") contains DDL that Prisma
-- cannot express and that the product depends on for correctness and speed:
--   * the partial index driving the detection loop,
--   * a unique partial index guaranteeing at most one open incident per check,
--   * schedule coherence CHECK constraints,
--   * a NOTIFY trigger used to invalidate the ingestion metadata cache.
-- Keep them when editing this migration.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "check_state" AS ENUM ('NEW', 'UP', 'LATE', 'DOWN', 'PAUSED');

-- CreateEnum
CREATE TYPE "schedule_type" AS ENUM ('interval', 'cron');

-- CreateEnum
CREATE TYPE "ping_kind" AS ENUM ('start', 'success', 'fail');

-- CreateEnum
CREATE TYPE "check_source" AS ENUM ('manual', 'api', 'auto');

-- CreateEnum
CREATE TYPE "channel_type" AS ENUM ('email', 'webhook', 'slack', 'teams', 'discord');

-- CreateEnum
CREATE TYPE "project_role" AS ENUM ('owner', 'admin', 'member');

-- CreateEnum
CREATE TYPE "delivery_status" AS ENUM ('pending', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "alert_kind" AS ENUM ('down', 'up');

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMPTZ(3),
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ping_retention_days" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_member" (
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "project_role" NOT NULL DEFAULT 'member',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_member_pkey" PRIMARY KEY ("project_id","user_id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "user_agent" TEXT,
    "ip" TEXT,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_key" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "lookup_id" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "last_used_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_key_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "check" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "key" TEXT,
    "ping_key" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schedule_type" "schedule_type" NOT NULL,
    "period_seconds" INTEGER,
    "cron_expression" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "grace_seconds" INTEGER NOT NULL,
    "state" "check_state" NOT NULL DEFAULT 'NEW',
    "last_ping_at" TIMESTAMPTZ(3),
    "last_started_at" TIMESTAMPTZ(3),
    "last_duration_ms" INTEGER,
    "next_due_at" TIMESTAMPTZ(3),
    "source" "check_source" NOT NULL DEFAULT 'manual',
    "environment" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT,
    "orphaned_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "check_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ping" (
    "id" BIGSERIAL NOT NULL,
    "check_id" UUID NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" "ping_kind" NOT NULL,
    "exit_code" INTEGER,
    "duration_ms" INTEGER,
    "body" TEXT,
    "source_ip" INET,
    "user_agent" TEXT,

    CONSTRAINT "ping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "check_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),
    "notifications_sent" INTEGER NOT NULL DEFAULT 0,
    "cause" TEXT NOT NULL DEFAULT 'missed',

    CONSTRAINT "incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_channel" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "type" "channel_type" NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_delivery" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "incident_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "kind" "alert_kind" NOT NULL,
    "status" "delivery_status" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "project_slug_key" ON "project"("slug");

-- CreateIndex
CREATE INDEX "project_member_user_id_idx" ON "project_member"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_hash_key" ON "session"("token_hash");

-- CreateIndex
CREATE INDEX "session_user_id_idx" ON "session"("user_id");

-- CreateIndex
CREATE INDEX "session_expires_at_idx" ON "session"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "api_key_lookup_id_key" ON "api_key"("lookup_id");

-- CreateIndex
CREATE INDEX "api_key_project_id_idx" ON "api_key"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "check_ping_key_key" ON "check"("ping_key");

-- CreateIndex
CREATE INDEX "check_project_id_state_idx" ON "check"("project_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "check_project_id_slug_key" ON "check"("project_id", "slug");

-- CreateIndex
CREATE INDEX "check_project_id_key_idx" ON "check"("project_id", "key");

-- CreateIndex
CREATE INDEX "ping_check_id_received_at_idx" ON "ping"("check_id", "received_at" DESC);

-- CreateIndex
CREATE INDEX "ping_received_at_idx" ON "ping"("received_at");

-- CreateIndex
CREATE INDEX "incident_check_id_started_at_idx" ON "incident"("check_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "notification_channel_project_id_idx" ON "notification_channel"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_delivery_incident_id_channel_id_kind_key" ON "notification_delivery"("incident_id", "channel_id", "kind");

-- AddForeignKey
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check" ADD CONSTRAINT "check_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ping" ADD CONSTRAINT "ping_check_id_fkey" FOREIGN KEY ("check_id") REFERENCES "check"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident" ADD CONSTRAINT "incident_check_id_fkey" FOREIGN KEY ("check_id") REFERENCES "check"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_channel" ADD CONSTRAINT "notification_channel_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "notification_channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===========================================================================
-- Hand-written objects (no Prisma equivalent)
-- ===========================================================================

-- Client-declared identity: a check is identified by its stable key *within an
-- environment*. Two deployments of the same application (production and staging)
-- declare the same job keys and must own two distinct checks, otherwise a staging
-- restart would rewrite production's schedule and its alerts.
-- COALESCE is what makes this work for checks with no environment: PostgreSQL
-- treats NULLs as distinct, which would silently allow duplicates.
CREATE UNIQUE INDEX "check_identity_uniq"
    ON "check" ("project_id", "key", (COALESCE("environment", '')))
    WHERE "key" IS NOT NULL;

-- The index that makes detection O(late checks) instead of O(all checks).
-- The predicate mirrors detection.service.ts exactly; changing one without the
-- other silently reintroduces a full table scan every 10 seconds.
CREATE INDEX "check_due_idx"
    ON "check" ("next_due_at")
    WHERE "state" IN ('NEW', 'UP', 'LATE');

-- Reconciliation of checks that went DOWN (missed deadline or explicit /fail)
-- but have no open incident yet.
CREATE INDEX "check_down_idx"
    ON "check" ("id")
    WHERE "state" = 'DOWN';

-- At most one open incident per check, enforced by the database rather than by
-- application logic: two racing server instances cannot double-open.
CREATE UNIQUE INDEX "incident_open_per_check_uniq"
    ON "incident" ("check_id")
    WHERE "resolved_at" IS NULL;

-- Outbound alert queue: workers claim rows with FOR UPDATE SKIP LOCKED.
CREATE INDEX "notification_delivery_pending_idx"
    ON "notification_delivery" ("next_attempt_at")
    WHERE "status" = 'pending';

-- A schedule is either an interval or a cron expression — never both, never
-- neither. Enforced in the database so a bad API path cannot create a check
-- whose next_due_at is impossible to compute.
ALTER TABLE "check" ADD CONSTRAINT "check_schedule_coherent" CHECK (
    ("schedule_type" = 'interval' AND "period_seconds" IS NOT NULL AND "cron_expression" IS NULL)
 OR ("schedule_type" = 'cron' AND "cron_expression" IS NOT NULL AND "period_seconds" IS NULL)
);

ALTER TABLE "check" ADD CONSTRAINT "check_period_range" CHECK (
    "period_seconds" IS NULL OR ("period_seconds" >= 30 AND "period_seconds" <= 31536000)
);

ALTER TABLE "check" ADD CONSTRAINT "check_grace_range" CHECK (
    "grace_seconds" >= 0 AND "grace_seconds" <= 604800
);

ALTER TABLE "check" ADD CONSTRAINT "check_duration_positive" CHECK (
    "last_duration_ms" IS NULL OR "last_duration_ms" >= 0
);

-- Defence in depth: ingestion truncates ping bodies, this makes an oversized
-- body impossible even if that code is bypassed.
ALTER TABLE "ping" ADD CONSTRAINT "ping_body_bounded" CHECK (
    "body" IS NULL OR char_length("body") <= 10000
);

ALTER TABLE "incident" ADD CONSTRAINT "incident_cause_known" CHECK (
    "cause" IN ('missed', 'reported')
);

ALTER TABLE "incident" ADD CONSTRAINT "incident_resolution_after_start" CHECK (
    "resolved_at" IS NULL OR "resolved_at" >= "started_at"
);

-- Ingestion caches (ping_key -> schedule) in memory. This trigger tells every
-- instance to drop its entry when the schedule changes or the check disappears.
-- `UPDATE OF` fires only when those columns appear in the SET list, so the
-- ingestion UPDATE (which touches state/last_ping_at/next_due_at) never does.
CREATE FUNCTION "silencewatch_notify_check_changed"() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_notify(
        'silencewatch_check_changed',
        COALESCE(NEW."ping_key", OLD."ping_key")::text
    );
    RETURN NULL;
END;
$$;

CREATE TRIGGER "check_schedule_changed"
    AFTER UPDATE OF "schedule_type", "period_seconds", "cron_expression", "timezone", "grace_seconds"
    ON "check"
    FOR EACH ROW EXECUTE FUNCTION "silencewatch_notify_check_changed"();

CREATE TRIGGER "check_removed"
    AFTER DELETE ON "check"
    FOR EACH ROW EXECUTE FUNCTION "silencewatch_notify_check_changed"();
