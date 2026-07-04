CREATE TABLE "exercise_preferences" (
	"user_id" uuid NOT NULL,
	"exercise_name" text NOT NULL,
	"weight_increment" real NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_preferences_user_id_exercise_name_pk" PRIMARY KEY("user_id","exercise_name")
);
--> statement-breakpoint
ALTER TABLE "workout_sets" ADD COLUMN "exercise_order" smallint DEFAULT 0 NOT NULL;