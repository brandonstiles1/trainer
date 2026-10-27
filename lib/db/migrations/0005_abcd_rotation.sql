-- A/B/C/D rotation + double progression. Additive only: no existing rows or
-- columns are dropped, so every logged set and preference survives.

-- Extra sessions feed exercise history but don't advance the rotation.
ALTER TABLE "workouts" ADD COLUMN IF NOT EXISTS "is_extra" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- Increments, thresholds and rest timer live in one jsonb blob.
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "progression" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint

-- A per-exercise step is now an optional override of the equipment default.
ALTER TABLE "exercise_preferences" ALTER COLUMN "weight_increment" DROP NOT NULL;--> statement-breakpoint

-- Before enforcing one live workout per user, close out any stragglers: keep
-- the newest in-progress workout, mark older ones abandoned (their sets stay).
UPDATE "workouts" w SET "status" = 'abandoned', "completed_at" = COALESCE(w."completed_at", now())
WHERE w."status" = 'in_progress'
  AND EXISTS (
    SELECT 1 FROM "workouts" newer
    WHERE newer."user_id" = w."user_id"
      AND newer."status" = 'in_progress'
      AND (newer."started_at", newer."id") > (w."started_at", w."id")
  );--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workouts_one_in_progress_idx" ON "workouts" ("user_id") WHERE "status" = 'in_progress';--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "body_weights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"weight_lbs" real NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "body_weights_user_id_recorded_at_idx" ON "body_weights" ("user_id","recorded_at");
