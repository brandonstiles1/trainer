import {
  pgTable,
  uuid,
  integer,
  smallint,
  text,
  timestamp,
  boolean,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";

// ────────── enums ──────────

export const photoKind = pgEnum("photo_kind", ["before", "goal", "progress"]);
export const workoutStatus = pgEnum("workout_status", [
  "in_progress",
  "completed",
  "abandoned",
]);
export const liftSource = pgEnum("lift_source", [
  "user",
  "inferred_from_workout",
]);

// ────────── tables ──────────

export const profiles = pgTable("profiles", {
  userId: uuid("user_id").primaryKey(), // FK → auth.users.id (enforced by trigger, not Drizzle)
  heightIn: integer("height_in"),
  weightLbs: integer("weight_lbs"),
  restTimerSeconds: integer("rest_timer_seconds").notNull().default(75),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const goals = pgTable("goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  beforePhotoPath: text("before_photo_path"),
  goalPhotoPath: text("goal_photo_path"),
  goalDescription: text("goal_description"),
  maxDaysPerWeek: smallint("max_days_per_week").notNull(),
  maxMinutesSession: smallint("max_minutes_session").notNull(),
  chatTranscript: jsonb("chat_transcript").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  goalId: uuid("goal_id").notNull(),
  structure: jsonb("structure").notNull(),
  isActive: boolean("is_active").notNull().default(false),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
});

export const liftEstimates = pgTable("lift_estimates", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  exerciseName: text("exercise_name").notNull(),
  weightLbs: integer("weight_lbs").notNull(),
  reps: smallint("reps").notNull(),
  source: liftSource("source").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workouts = pgTable("workouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  planId: uuid("plan_id").notNull(),
  dayKey: text("day_key").notNull(),
  status: workoutStatus("status").notNull().default("in_progress"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const workoutSets = pgTable("workout_sets", {
  id: uuid("id").primaryKey().defaultRandom(),
  workoutId: uuid("workout_id").notNull(),
  exerciseName: text("exercise_name").notNull(),
  setNumber: smallint("set_number").notNull(),
  prescribed: jsonb("prescribed").notNull(),
  actual: jsonb("actual"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const photos = pgTable("photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  kind: photoKind("kind").notNull(),
  storagePath: text("storage_path").notNull(),
  dayNumber: integer("day_number").notNull().default(0),
  takenAt: timestamp("taken_at", { withTimezone: true }).notNull().defaultNow(),
});
