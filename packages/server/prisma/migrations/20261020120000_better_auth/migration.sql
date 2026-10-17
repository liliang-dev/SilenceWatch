-- Sign-in moves to Better Auth. This migration only adds and renames: nothing that
-- held an account is dropped here. What the old system left behind (password
-- hashes, verification and reset tokens, the old sessions) stays in place, unused,
-- until prisma/pending/20261020120000_drop_legacy_auth is applied on purpose.

-- The old sessions were refresh tokens, a different thing under the same name. They
-- are kept under a new name, constraints and indexes included, so the new table can
-- take "session".
ALTER TABLE "session" RENAME TO "session_legacy";
ALTER TABLE "session_legacy" RENAME CONSTRAINT "session_pkey" TO "session_legacy_pkey";
ALTER TABLE "session_legacy" RENAME CONSTRAINT "session_user_id_fkey" TO "session_legacy_user_id_fkey";
ALTER INDEX "session_token_hash_key" RENAME TO "session_legacy_token_hash_key";
ALTER INDEX "session_user_id_idx" RENAME TO "session_legacy_user_id_idx";
ALTER INDEX "session_expires_at_idx" RENAME TO "session_legacy_expires_at_idx";

-- Better Auth never writes a password hash onto the user, and these two columns
-- were the old ways of saying "can sign in" and "address proven".
ALTER TABLE "user" ALTER COLUMN "password_hash" DROP NOT NULL;
ALTER TABLE "user" ADD COLUMN "email_verified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "user" ADD COLUMN "image" TEXT;
-- An address the old system had proven is one Better Auth may treat as proven.
UPDATE "user" SET "email_verified" = true WHERE "email_verified_at" IS NOT NULL;

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMPTZ(3),
    "refresh_token_expires_at" TIMESTAMPTZ(3),
    "scope" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passkey" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT,
    "public_key" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "credential_id" TEXT NOT NULL,
    "counter" INTEGER NOT NULL,
    "device_type" TEXT NOT NULL,
    "backed_up" BOOLEAN NOT NULL,
    "transports" TEXT,
    "aaguid" TEXT,
    "created_at" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "passkey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_code" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_code_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");
CREATE INDEX "session_user_id_idx" ON "session"("user_id");
CREATE INDEX "session_expires_at_idx" ON "session"("expires_at");
CREATE UNIQUE INDEX "account_provider_id_account_id_key" ON "account"("provider_id", "account_id");
CREATE INDEX "account_user_id_idx" ON "account"("user_id");
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");
CREATE INDEX "verification_expires_at_idx" ON "verification"("expires_at");
CREATE UNIQUE INDEX "passkey_credential_id_key" ON "passkey"("credential_id");
CREATE INDEX "passkey_user_id_idx" ON "passkey"("user_id");
CREATE UNIQUE INDEX "recovery_code_code_hash_key" ON "recovery_code"("code_hash");
CREATE INDEX "recovery_code_user_id_idx" ON "recovery_code"("user_id");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recovery_code" ADD CONSTRAINT "recovery_code_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
