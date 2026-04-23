CREATE TYPE "public"."lift_source" AS ENUM('user', 'inferred_from_workout');--> statement-breakpoint
CREATE TYPE "public"."photo_kind" AS ENUM('before', 'goal', 'progress');--> statement-breakpoint
CREATE TYPE "public"."workout_status" AS ENUM('in_progress', 'completed', 'abandoned');--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"before_photo_path" text,
	"goal_photo_path" text,
	"goal_description" text,
	"max_days_per_week" smallint NOT NULL,
	"max_minutes_session" smallint NOT NULL,
	"chat_transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lift_estimates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"exercise_name" text NOT NULL,
	"weight_lbs" integer NOT NULL,
	"reps" smallint NOT NULL,
	"source" "lift_source" NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "photo_kind" NOT NULL,
	"storage_path" text NOT NULL,
	"day_number" integer DEFAULT 0 NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"structure" jsonb NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"activated_at" timestamp with time zone,
	"deactivated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"height_in" integer,
	"weight_lbs" integer,
	"rest_timer_seconds" integer DEFAULT 75 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workout_id" uuid NOT NULL,
	"exercise_name" text NOT NULL,
	"set_number" smallint NOT NULL,
	"prescribed" jsonb NOT NULL,
	"actual" jsonb,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"day_key" text NOT NULL,
	"status" "workout_status" DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
