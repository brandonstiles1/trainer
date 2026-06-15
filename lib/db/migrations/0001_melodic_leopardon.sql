ALTER TYPE "public"."lift_source" ADD VALUE 'user_pinned';--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "last_weekly_review_at" timestamp with time zone;