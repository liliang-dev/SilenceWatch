-- Unique visitors of the web application, one row per visitor and day. The
-- visitor is a keyed hash (see AppVisitor in schema.prisma), never an address.
CREATE TABLE "app_visitor" (
    "day" DATE NOT NULL,
    "visitor" TEXT NOT NULL,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_visitor_pkey" PRIMARY KEY ("day", "visitor")
);

CREATE INDEX "app_visitor_first_seen_at_idx" ON "app_visitor"("first_seen_at");
