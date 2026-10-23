-- Lets the operator disable an account (`silencewatch disable`). Additive: null for
-- every account that exists, which is "not disabled".
ALTER TABLE "user" ADD COLUMN "disabled_at" TIMESTAMPTZ(3);
