import "server-only";

import { db } from "@/lib/db";
import {
  plans,
  goals,
  profiles,
  workouts,
  workoutSets,
  liftEstimates,
  exercisePreferences,
} from "@/lib/db/schema";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { estimate1RM, weightForReps, roundToStep } from "@/lib/adapt";
import { DEFAULT_PROGRAM } from "@/lib/program/default-program";
import {
  isRotationProgram,
  nextRotationDay,
  normalizeProgram,
  type ProgramDay,
  type ProgramStructure,
} from "@/lib/program/structure";
import { parseSettings, type ProgressionSettings } from "@/lib/program/settings";
import { groupExerciseSessions, type ExerciseSession, type HistoryRow } from "./exercise-history";
import { prescribe, setRowsFor, type Prescription, type SlotSpec } from "./prescribe";

/**
 * Reads and writes that take a `userId` argument, kept out of the `"use server"`
 * action modules on purpose: an exported Server Function is reachable by direct
 * POST, so one taking a user id would let anyone read anyone's log book. Callers
 * here are server components and actions that have already authenticated.
 */

/** Sessions kept per exercise: enough to see a 3-session miss streak through a few incomplete ones. */
export const HISTORY_SESSIONS = 8;

// ────────── program ──────────

export type ActiveProgram = {
  planId: string;
  program: ProgramStructure;
  /** The stored plan predates the A/B/C/D rotation (a weekday plan from the old chat flow). */
  legacy: boolean;
};

/**
 * The user's routine. A brand-new account gets the default A/B/C/D program on
 * first visit — there's no onboarding to sit through.
 */
export async function activeProgramFor(userId: string): Promise<ActiveProgram> {
  const [active] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.userId, userId), eq(plans.isActive, true)))
    .limit(1);
  if (active) {
    return {
      planId: active.id,
      program: normalizeProgram(active.structure),
      legacy: !isRotationProgram(active.structure),
    };
  }
  const planId = await installProgram(userId, DEFAULT_PROGRAM);
  return { planId, program: DEFAULT_PROGRAM, legacy: false };
}

/**
 * Make `program` the active plan. The previous plan is deactivated, not
 * deleted — past workouts keep pointing at it.
 */
export async function installProgram(userId: string, program: ProgramStructure): Promise<string> {
  return db.transaction(async (tx) => {
    let [goal] = await tx
      .select({ id: goals.id })
      .from(goals)
      .where(eq(goals.userId, userId))
      .orderBy(desc(goals.createdAt))
      .limit(1);
    if (!goal) {
      [goal] = await tx
        .insert(goals)
        .values({
          userId,
          goalDescription: "Lean, muscular, proportioned: wide shoulders, thick traps, upper chest, wide back.",
          maxDaysPerWeek: 4,
          maxMinutesSession: 40,
        })
        .returning({ id: goals.id });
    }
    await tx
      .update(plans)
      .set({ isActive: false, deactivatedAt: new Date() })
      .where(and(eq(plans.userId, userId), eq(plans.isActive, true)));
    const [row] = await tx
      .insert(plans)
      .values({ userId, goalId: goal.id, structure: program, isActive: true, activatedAt: new Date() })
      .returning({ id: plans.id });
    return row.id;
  });
}

/** Category of the last finished rotation workout; extras and abandoned ones don't count. */
export async function lastRotationCategory(userId: string): Promise<string | null> {
  const [last] = await db
    .select({ dayKey: workouts.dayKey })
    .from(workouts)
    .where(
      and(eq(workouts.userId, userId), eq(workouts.status, "completed"), eq(workouts.isExtra, false)),
    )
    .orderBy(desc(workouts.completedAt))
    .limit(1);
  return last?.dayKey ?? null;
}

export async function nextDayFor(userId: string, program: ProgramStructure): Promise<ProgramDay | null> {
  return nextRotationDay(program, await lastRotationCategory(userId));
}

// ────────── settings & preferences ──────────

export async function settingsFor(userId: string): Promise<ProgressionSettings> {
  const [row] = await db
    .select({ progression: profiles.progression })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  return parseSettings(row?.progression);
}

/** Per-exercise load-step overrides, where the user has set one. */
export async function incrementOverridesFor(
  userId: string,
  exerciseNames: string[],
): Promise<Record<string, number>> {
  if (exerciseNames.length === 0) return {};
  const rows = await db
    .select({ name: exercisePreferences.exerciseName, inc: exercisePreferences.weightIncrement })
    .from(exercisePreferences)
    .where(
      and(
        eq(exercisePreferences.userId, userId),
        inArray(exercisePreferences.exerciseName, exerciseNames),
      ),
    );
  return Object.fromEntries(rows.filter((r) => r.inc != null && r.inc > 0).map((r) => [r.name, r.inc!]));
}

// ────────── history ──────────

const historyColumns = {
  workoutId: workoutSets.workoutId,
  exerciseName: workoutSets.exerciseName,
  setNumber: workoutSets.setNumber,
  prescribed: workoutSets.prescribed,
  actual: workoutSets.actual,
  finishedAt: workouts.completedAt,
};

/**
 * Finished sessions of each named exercise, newest first, across every kind of
 * workout — rotation, repeated or custom. Only workouts that were actually
 * finished count; abandoned ones are ignored.
 */
export async function recentSessionsFor(
  userId: string,
  exerciseNames: string[],
  sessionsPerExercise = HISTORY_SESSIONS,
): Promise<Record<string, ExerciseSession[]>> {
  const byExercise: Record<string, ExerciseSession[]> = {};
  for (const name of exerciseNames) byExercise[name] = [];
  if (exerciseNames.length === 0) return byExercise;

  const rows = await db
    .select(historyColumns)
    .from(workoutSets)
    .innerJoin(workouts, eq(workouts.id, workoutSets.workoutId))
    .where(
      and(
        eq(workouts.userId, userId),
        eq(workouts.status, "completed"),
        inArray(workoutSets.exerciseName, exerciseNames),
      ),
    )
    .orderBy(desc(workouts.completedAt), asc(workoutSets.setNumber))
    .limit(exerciseNames.length * sessionsPerExercise * 8);

  const history = rows as unknown as HistoryRow[];
  for (const name of exerciseNames) {
    byExercise[name] = groupExerciseSessions(history, name).slice(0, sessionsPerExercise);
  }
  return byExercise;
}

/** Every finished set the user has ever logged, for the Progress screen. */
export async function allHistoryRows(userId: string): Promise<HistoryRow[]> {
  const rows = await db
    .select(historyColumns)
    .from(workoutSets)
    .innerJoin(workouts, eq(workouts.id, workoutSets.workoutId))
    .where(and(eq(workouts.userId, userId), eq(workouts.status, "completed")))
    .orderBy(desc(workouts.completedAt), asc(workoutSets.setNumber));
  return rows as unknown as HistoryRow[];
}

/**
 * Opening load for an exercise the user has never logged, from whatever they
 * told us at signup. The only place Epley math survives.
 */
async function seedWeightsFor(userId: string, specs: SlotSpec[]): Promise<Record<string, number>> {
  if (specs.length === 0) return {};
  const rows = await db
    .select()
    .from(liftEstimates)
    .where(
      and(
        eq(liftEstimates.userId, userId),
        inArray(
          liftEstimates.exerciseName,
          specs.map((s) => s.name),
        ),
      ),
    )
    .orderBy(desc(liftEstimates.recordedAt));

  const seeds: Record<string, number> = {};
  for (const row of rows) {
    if (seeds[row.exerciseName] !== undefined) continue;
    const spec = specs.find((s) => s.name === row.exerciseName)!;
    seeds[row.exerciseName] = Math.max(
      0,
      roundToStep(weightForReps(estimate1RM(row.weightLbs, row.reps), spec.repMin), 5),
    );
  }
  return seeds;
}

// ────────── prescriptions ──────────

/** Recommendations for a list of exercise slots, in order. */
export async function prescribeSlots(userId: string, specs: SlotSpec[]): Promise<Prescription[]> {
  const names = [...new Set(specs.map((s) => s.name))];
  const [settings, overrides, sessions] = await Promise.all([
    settingsFor(userId),
    incrementOverridesFor(userId, names),
    recentSessionsFor(userId, names),
  ]);
  const seeds = await seedWeightsFor(
    userId,
    specs.filter((s) => sessions[s.name].length === 0),
  );
  const now = new Date();
  return specs.map((spec) =>
    prescribe({
      spec,
      sessions: sessions[spec.name],
      settings,
      incrementOverride: overrides[spec.name],
      seedWeight: seeds[spec.name],
      now,
    }),
  );
}

/** The `workout_sets` rows for a new workout over `specs`. */
export async function prescribeWorkoutSetRows(userId: string, specs: SlotSpec[]) {
  const prescriptions = await prescribeSlots(userId, specs);
  return prescriptions.flatMap((p, order) => setRowsFor(p, order));
}

/** Every exercise name the user has logged at least one set of. */
export async function loggedExerciseNames(userId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ name: workoutSets.exerciseName })
    .from(workoutSets)
    .innerJoin(workouts, eq(workouts.id, workoutSets.workoutId))
    .where(eq(workouts.userId, userId));
  return rows.map((r) => r.name).sort();
}
