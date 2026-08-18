ALTER TABLE "exercise_preferences" ADD COLUMN "rep_min" smallint;--> statement-breakpoint
ALTER TABLE "exercise_preferences" ADD COLUMN "rep_max" smallint;--> statement-breakpoint
-- "What did I do last time?" is now the hot path: every workout creation and
-- every info-panel open looks up one exercise's finished sets, newest first.
CREATE INDEX IF NOT EXISTS "workout_sets_exercise_name_idx" ON "workout_sets" ("exercise_name");
