-- Removes what the previous sign-in system left behind. NOT part of the migration
-- history: `prisma migrate deploy` never reads this folder, on purpose. See README.md here.
--
-- Destructive and irreversible: once applied, a password hash, an unspent verification
-- or reset link and an old refresh-token session cannot be recovered.

DROP TABLE "email_verification";
DROP TABLE "password_reset";
DROP TABLE "session_legacy";

ALTER TABLE "user" DROP COLUMN "password_hash";
ALTER TABLE "user" DROP COLUMN "email_verified_at";
