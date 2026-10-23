-- Removes what the previous sign-in system left behind. Better Auth has replaced it
-- and nothing reads any of this: the tables hold the old verification and reset
-- links and refresh-token sessions, and the two columns the old password hash and
-- verification time.
--
-- Destructive and irreversible. Take a backup before deploying the release that
-- carries it.

DROP TABLE "email_verification";
DROP TABLE "password_reset";
DROP TABLE "session_legacy";

ALTER TABLE "user" DROP COLUMN "password_hash";
ALTER TABLE "user" DROP COLUMN "email_verified_at";
