CREATE TABLE "weekly_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"headline" text NOT NULL,
	"observations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "weekly_reviews_user_id_created_at_idx" ON "weekly_reviews" ("user_id","created_at" DESC);
