-- Subscriptions, for the hosted service.
--
-- Additive and inert: a self-hosted instance never writes to either table, and
-- `user.plan` stays what it was. Nothing here is a price or a payment detail;
-- Stripe holds those, and these rows only remember which Stripe customer an
-- account is and what its subscription last said.

CREATE TABLE "subscription" (
    "user_id" UUID NOT NULL,
    "stripe_customer_id" TEXT NOT NULL,
    "stripe_subscription_id" TEXT,
    "plan" TEXT,
    "status" TEXT NOT NULL DEFAULT 'none',
    "current_period_end" TIMESTAMPTZ(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "last_event_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("user_id")
);

CREATE UNIQUE INDEX "subscription_stripe_customer_id_key" ON "subscription"("stripe_customer_id");
CREATE UNIQUE INDEX "subscription_stripe_subscription_id_key" ON "subscription"("stripe_subscription_id");

-- The subscription goes with the account.
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Stripe delivers at least once; the id of an event already handled is what
-- makes its repeat harmless.
CREATE TABLE "stripe_event" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

    CONSTRAINT "stripe_event_pkey" PRIMARY KEY ("id")
);
