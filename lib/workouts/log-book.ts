import "server-only";

import { db } from "@/lib/db";
import { plans, workouts, workoutSets, liftEstimates, exercisePreferences } from "@/lib/db/schema";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { estimate1RM, weightForReps, roundToStep } from "@/lib/adapt";
import { inferExerciseMeta } from "@/lib/engine/infer-meta";
import type { RepRange } from "@/lib/engine/exercise-meta";
import { groupExerciseSessions, type ExerciseSession, type HistoryRow } from "./exercise-history";
import { prescribeExercise } from "./prescribe-exercise";
import { planTodayDiff } from "./plan-today-diff";
import type { StoredPrescribed } from "./stored-set";

/**
 * Reads and writes that take a `userId` argument, kept out of the `"use server"`
 * action modules on purpose: an exported Server Function is reachable by direct
 * POST, so one taking a user id would let anyone read anyone's log book. Callers
 * here are server components and actions that have already authenticated.
 */

export type PlanStructure = {
  split: string;
  days: Array<{
    day: string;
    category: string;
    exercises: Array<{ name: string; order: number; notes?: string }>;
  }>;
};

/** Sessions kept per exercise: enough for the info panel and the stuck check. */
export const HISTORY_SESSIONS = 3;

export type ExercisePreference = { weightIncrement: number; repRange: RepRange | null };

/** Per-exercise gym preferences: plate step and rep range. */
export async function exercisePreferencesFor(
  userId: string,
  exerciseNames: string[],
): Promise<Record<string, ExercisePreference>> {
  if (exerciseNames.length === 0) return {};
  const rows = await db
    .select()
    .from(exercisePreferences)
    .where(
      and(
        eq(exercisePreferences.userId, userId),
        inArray(exercisePreferences.exerciseName, exerciseNames),
      ),
    );
  return Object.fromEntries(
    rows.map((r) => [
      r.exerciseName,
      {
        weightIncrement: r.weightIncrement,
        repRange: r.repMin != null && r.repMax != null ? { min: r.repMin, max: r.repMax } : null,
      },
    ]),
  );
}

/**
 * The last few finished sessions of each named exercise, newest first. This is
 * the log book — the only input to what today's targets are.
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
    .select({
      workoutId: workoutSets.workoutId,
      exerciseName: workoutSets.exerciseName,
      setNumber: workoutSets.setNumber,
      prescribed: workoutSets.prescribed,
      actual: workoutSets.actual,
      finishedAt: workouts.completedAt,
    })
    .from(workoutSets)
    .innerJoin(workouts, eq(workouts.id, workoutSets.workoutId))
    .where(
      and(
        eq(workouts.userId, userId),
        isNotNull(workouts.completedAt),
        inArray(workoutSets.exerciseName, exerciseNames),
      ),
    )
    .orderBy(desc(workouts.completedAt), asc(workoutSets.setNumber))
    .limit(600);

  const history = rows as unknown as HistoryRow[];
  for (const name of exerciseNames) {
    byExercise[name] = groupExerciseSessions(history, name).slice(0, sessionsPerExercise);
  }
  return byExercise;
}

/**
 * Opening load for an exercise the user has never logged, from whatever they
 * told us at signup. The only place Epley math survives: a one-time conversion
 * of "I can bench 185×5" into a target at the bottom of the rep range.
 */
async function seedWeightsFor(
  userId: string,
  exerciseNames: string[],
  prefs: Record<string, ExercisePreference>,
): Promise<Record<string, number>> {
  if (exerciseNames.length === 0) return {};
  const rows = await db
    .select()
    .from(liftEstimates)
    .where(
      and(eq(liftEstimates.userId, userId), inArray(liftEstimates.exerciseName, exerciseNames)),
    )
    .orderBy(desc(liftEstimates.recordedAt));

  const seeds: Record<string, number> = {};
  for (const row of rows) {
    if (seeds[row.exerciseName] !== undefined) continue;
    const meta = inferExerciseMeta(row.exerciseName);
    const range = prefs[row.exerciseName]?.repRange ?? meta.repRange;
    const step = prefs[row.exerciseName]?.weightIncrement ?? meta.weightIncrement;
    seeds[row.exerciseName] = Math.max(
      0,
      roundToStep(weightForReps(estimate1RM(row.weightLbs, row.reps), range.min), step),
    );
  }
  return seeds;
}

/**
 * Today's opening targets for each exercise: last session carried forward,
 * nudged up when it was cleared. No estimates, no autoregulation — see
 * `lib/engine/progression`.
 */
export async function prescribeWorkoutSetRows(
  userId: string,
  exerciseNames: string[],
): Promise<
  Array<{ exerciseName: string; setNumber: number; exerciseOrder: number; prescribed: StoredPrescribed }>
> {
  const prefs = await exercisePreferencesFor(userId, exerciseNames);
  const sessions = await recentSessionsFor(userId, exerciseNames);
  const firstTimers = exerciseNames.filter((n) => sessions[n].length === 0);
  const seeds = await seedWeightsFor(userId, firstTimers, prefs);

  return exerciseNames.flatMap((name, order) =>
    prescribeExercise({
      name,
      sessions: sessions[name],
      seedWeight: seeds[name],
      weightIncrement: prefs[name]?.weightIncrement,
      repRange: prefs[name]?.repRange ?? undefined,
    }).map((r) => ({ exerciseName: name, exerciseOrder: order, ...r })),
  );
}

export const orderedExerciseNames = (day: PlanStructure["days"][number]): string[] =>
  day.exercises.slice().sort((a, b) => a.order - b.order).map((e) => e.name);

/** Plan-day exercise order for a workout, used to sort its sets for display. */
export async function planExerciseOrder(planId: string, dayKey: string): Promise<string[]> {
  const [plan] = await db
    .select({ structure: plans.structure })
    .from(plans)
    .where(eq(plans.id, planId))
    .limit(1);
  const day = (plan?.structure as PlanStructure | undefined)?.days.find((d) => d.category === dayKey);
  return day ? orderedExerciseNames(day) : [];
}

const weekdayForToday = (): string => {
  const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return names[new Date().getDay()];
};

/**
 * When a new plan becomes active, adjust today's in-progress workout to match it:
 * exercises already started are left intact; everything not yet started is replaced
 * with the new plan day's exercises. No-op if there's no in-progress workout or the
 * new plan has no entry for today.
 */
export async function adjustTodayWorkout(params: {
  userId: string;
  newPlanId: string;
  newStructure: PlanStructure;
}): Promise<void> {
  const { userId, newPlanId, newStructure } = params;

  const [inProgress] = await db
    .select()
    .from(workouts)
    .where(and(eq(workouts.userId, userId), eq(workouts.status, "in_progress")))
    .limit(1);
  if (!inProgress) return;

  const planDay = newStructure.days.find((d) => d.day === weekdayForToday());
  if (!planDay) return; // new plan makes today a rest day — leave the workout as-is

  const newExercises = orderedExerciseNames(planDay);

  const existingSets = await db
    .select({
      id: workoutSets.id,
      exerciseName: workoutSets.exerciseName,
      completedAt: workoutSets.completedAt,
    })
    .from(workoutSets)
    .where(eq(workoutSets.workoutId, inProgress.id));

  const diff = planTodayDiff({ existingSets, newDayExercises: newExercises });

  const newSetRows =
    diff.exercisesToGenerate.length > 0
      ? (await prescribeWorkoutSetRows(userId, diff.exercisesToGenerate)).map((r) => ({
          workoutId: inProgress.id,
          ...r,
          exerciseOrder: newExercises.indexOf(r.exerciseName),
        }))
      : [];

  await db.transaction(async (tx) => {
    if (diff.setIdsToDelete.length > 0) {
      await tx.delete(workoutSets).where(inArray(workoutSets.id, diff.setIdsToDelete));
    }
    if (newSetRows.length > 0) {
      await tx.insert(workoutSets).values(newSetRows as (typeof workoutSets.$inferInsert)[]);
    }
    await tx
      .update(workouts)
      .set({ planId: newPlanId, dayKey: planDay.category })
      .where(eq(workouts.id, inProgress.id));
  });
}
