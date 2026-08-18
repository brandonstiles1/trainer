"use server";

import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { plans, workouts, workoutSets, exercisePreferences } from "@/lib/db/schema";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Actual } from "@/lib/adapt";
import { inferExerciseMeta } from "@/lib/engine/infer-meta";
import type { StoredPrescribed } from "@/lib/workouts/stored-set";
import { setsToCarryWeight } from "@/lib/workouts/carry-weight";
import {
  orderedExerciseNames,
  prescribeWorkoutSetRows,
  type PlanStructure,
} from "@/lib/workouts/log-book";
import { findPlanDay } from "@/lib/workouts/find-plan-day";

const weekdayForToday = (): string => {
  const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return names[new Date().getDay()];
};

async function requireUser(): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");
  return user.id;
}

/** Confirms the workout belongs to the caller, and returns it. */
async function ownedWorkout(workoutId: string, userId: string) {
  const [workout] = await db
    .select()
    .from(workouts)
    .where(and(eq(workouts.id, workoutId), eq(workouts.userId, userId)))
    .limit(1);
  if (!workout) throw new Error("workout not found");
  return workout;
}

async function activePlanFor(userId: string) {
  const [activePlan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.userId, userId), eq(plans.isActive, true)))
    .limit(1);
  if (!activePlan) throw new Error("no active plan");
  return activePlan;
}

export async function startWorkout(): Promise<
  | { workoutId: string }
  | { restDay: true; category: string | null }
> {
  const userId = await requireUser();

  after(async () => {
    const { maybeRunWeeklyReview } = await import("@/lib/actions/weekly-review");
    await maybeRunWeeklyReview(userId).catch(() => {});
  });

  // Resume an in_progress workout if one exists
  const [inProgress] = await db
    .select()
    .from(workouts)
    .where(and(eq(workouts.userId, userId), eq(workouts.status, "in_progress")))
    .limit(1);
  if (inProgress) return { workoutId: inProgress.id };

  const activePlan = await activePlanFor(userId);
  const planDay = findPlanDay(activePlan.structure as PlanStructure, weekdayForToday());
  if (!planDay) return { restDay: true, category: null };

  return createWorkout({
    userId,
    planId: activePlan.id,
    category: planDay.category,
    exercises: orderedExerciseNames(planDay),
  });
}

export async function startImpromptuWorkout(sourceDay: string): Promise<{ workoutId: string }> {
  const userId = await requireUser();

  after(async () => {
    const { maybeRunWeeklyReview } = await import("@/lib/actions/weekly-review");
    await maybeRunWeeklyReview(userId).catch(() => {});
  });

  // Resume an in_progress workout if one exists (one active workout at a time).
  const [inProgress] = await db
    .select()
    .from(workouts)
    .where(and(eq(workouts.userId, userId), eq(workouts.status, "in_progress")))
    .limit(1);
  if (inProgress) return { workoutId: inProgress.id };

  const activePlan = await activePlanFor(userId);
  const planDay = findPlanDay(activePlan.structure as PlanStructure, sourceDay);
  if (!planDay) throw new Error("plan day not found");

  return createWorkout({
    userId,
    planId: activePlan.id,
    category: planDay.category,
    exercises: orderedExerciseNames(planDay),
  });
}

async function createWorkout(params: {
  userId: string;
  planId: string;
  category: string;     // stored as workouts.dayKey
  exercises: string[];  // ordered exercise names
}): Promise<{ workoutId: string }> {
  const prescribed = await prescribeWorkoutSetRows(params.userId, params.exercises);

  const [workoutRow] = await db
    .insert(workouts)
    .values({
      userId: params.userId,
      planId: params.planId,
      dayKey: params.category,
      status: "in_progress",
    } as typeof workouts.$inferInsert)
    .returning({ id: workouts.id });

  const setRows = prescribed.map((r) => ({ workoutId: workoutRow.id, ...r }));
  await db.insert(workoutSets).values(setRows as (typeof workoutSets.$inferInsert)[]);

  return { workoutId: workoutRow.id };
}

// ────────── logging ──────────

export type CommitSetInput = {
  workoutId: string;
  setId: string;
  actual: Actual;
};

/**
 * Log a set. The only thing that moves downstream is the load: later sets of
 * the same exercise follow the weight you actually put on the bar (see
 * `setsToCarryWeight`). Rep targets stand, and what you log here is what next
 * session progresses from.
 */
export async function commitSet(input: CommitSetInput): Promise<void> {
  const userId = await requireUser();
  await ownedWorkout(input.workoutId, userId);

  const rows = await db
    .select()
    .from(workoutSets)
    .where(eq(workoutSets.workoutId, input.workoutId));
  const target = rows.find((r) => r.id === input.setId);
  if (!target) throw new Error("set not found");

  const carryIds = setsToCarryWeight(
    rows.map((r) => ({
      id: r.id,
      exerciseName: r.exerciseName,
      setNumber: r.setNumber,
      // The set being logged right now counts as resolved either way.
      resolved: r.completedAt !== null || r.id === input.setId,
      targetWeight: (r.prescribed as StoredPrescribed).weight,
    })),
    {
      exerciseName: target.exerciseName,
      setNumber: target.setNumber,
      weight: input.actual.weight,
    },
  );

  await db.transaction(async (tx) => {
    await tx
      .update(workoutSets)
      .set({ actual: input.actual, completedAt: new Date() })
      .where(and(eq(workoutSets.id, input.setId), eq(workoutSets.workoutId, input.workoutId)));

    for (const id of carryIds) {
      const row = rows.find((r) => r.id === id)!;
      const prescribed: StoredPrescribed = {
        ...(row.prescribed as StoredPrescribed),
        weight: input.actual.weight,
      };
      await tx.update(workoutSets).set({ prescribed }).where(eq(workoutSets.id, id));
    }
  });
}

/** Edit an already-logged set. Same write; the log is always the truth. */
export async function editSet(input: CommitSetInput): Promise<void> {
  await commitSet(input);
}

/** Append a set to an exercise, opening at the same target as its last set. */
export async function addSet(input: {
  workoutId: string;
  exerciseName: string;
}): Promise<{ id: string; setNumber: number; prescribed: StoredPrescribed }> {
  const userId = await requireUser();
  await ownedWorkout(input.workoutId, userId);

  const rows = await db
    .select()
    .from(workoutSets)
    .where(
      and(
        eq(workoutSets.workoutId, input.workoutId),
        eq(workoutSets.exerciseName, input.exerciseName),
      ),
    )
    .orderBy(asc(workoutSets.setNumber));
  if (rows.length === 0) throw new Error("exercise not in this workout");

  const last = rows[rows.length - 1];
  const lastPrescribed = last.prescribed as StoredPrescribed;
  const targetReps = lastPrescribed.targetReps ?? lastPrescribed.reps;
  // Only the numbers carry over — the rationale belongs to set 1.
  const prescribed: StoredPrescribed = {
    reps: targetReps,
    weight: lastPrescribed.weight,
    targetReps,
  };
  const setNumber = last.setNumber + 1;

  const [created] = await db
    .insert(workoutSets)
    .values({
      workoutId: input.workoutId,
      exerciseName: input.exerciseName,
      setNumber,
      exerciseOrder: last.exerciseOrder,
      prescribed,
    } as typeof workoutSets.$inferInsert)
    .returning({ id: workoutSets.id });

  return { id: created.id, setNumber, prescribed };
}

/** Drop an unlogged set from an exercise, closing the gap in set numbering. */
export async function removeSet(input: { workoutId: string; setId: string }): Promise<void> {
  const userId = await requireUser();
  await ownedWorkout(input.workoutId, userId);

  const [row] = await db
    .select()
    .from(workoutSets)
    .where(and(eq(workoutSets.id, input.setId), eq(workoutSets.workoutId, input.workoutId)))
    .limit(1);
  if (!row) throw new Error("set not found");
  if (row.completedAt !== null) throw new Error("set is already logged");

  await db.transaction(async (tx) => {
    await tx.delete(workoutSets).where(eq(workoutSets.id, input.setId));
    await tx
      .update(workoutSets)
      .set({ setNumber: sql`${workoutSets.setNumber} - 1` })
      .where(
        and(
          eq(workoutSets.workoutId, input.workoutId),
          eq(workoutSets.exerciseName, row.exerciseName),
          sql`${workoutSets.setNumber} > ${row.setNumber}`,
        ),
      );
  });
}

/** Mark a not-yet-logged set as skipped: resolved (completedAt) with no actual. */
export async function skipSet(input: { workoutId: string; setId: string }): Promise<void> {
  const userId = await requireUser();
  await ownedWorkout(input.workoutId, userId);
  await db
    .update(workoutSets)
    .set({ actual: null, completedAt: new Date() })
    .where(and(eq(workoutSets.id, input.setId), eq(workoutSets.workoutId, input.workoutId)));
}

/** Skip every remaining (unresolved) set of one exercise in a workout. */
export async function skipExercise(input: {
  workoutId: string;
  exerciseName: string;
}): Promise<void> {
  const userId = await requireUser();
  await ownedWorkout(input.workoutId, userId);
  await db
    .update(workoutSets)
    .set({ actual: null, completedAt: new Date() })
    .where(
      and(
        eq(workoutSets.workoutId, input.workoutId),
        eq(workoutSets.exerciseName, input.exerciseName),
        isNull(workoutSets.completedAt),
      ),
    );
}

/** Wipe all logged/skipped sets and restart the clock; targets stay in place. */
export async function restartWorkout(workoutId: string): Promise<void> {
  const userId = await requireUser();
  const workout = await ownedWorkout(workoutId, userId);
  if (workout.status !== "in_progress") throw new Error("workout is not in progress");

  await db.transaction(async (tx) => {
    await tx
      .update(workoutSets)
      .set({ actual: null, completedAt: null })
      .where(eq(workoutSets.workoutId, workoutId));
    await tx.update(workouts).set({ startedAt: new Date() }).where(eq(workouts.id, workoutId));
  });
}

/**
 * Close the workout out. Nothing is derived and stored on the way out — the
 * logged sets *are* the record, and next session reads them back directly.
 */
export async function completeWorkout(workoutId: string): Promise<void> {
  const userId = await requireUser();
  await db
    .update(workouts)
    .set({ status: "completed", completedAt: new Date() })
    .where(and(eq(workouts.id, workoutId), eq(workouts.userId, userId)));
}

export async function abandonWorkout(workoutId: string): Promise<void> {
  const userId = await requireUser();
  await db
    .update(workouts)
    .set({ status: "abandoned", completedAt: new Date() })
    .where(and(eq(workouts.id, workoutId), eq(workouts.userId, userId)));
}

// ────────── per-exercise preferences ──────────

/**
 * Save the plate step for one exercise. It doesn't touch today's numbers — it's
 * the size of the jump the next weight bump will take.
 */
export async function setExerciseIncrement(input: {
  exerciseName: string;
  increment: number;
}): Promise<void> {
  const userId = await requireUser();
  if (![2.5, 5, 10].includes(input.increment)) throw new Error("unsupported increment");

  await db
    .insert(exercisePreferences)
    .values({
      userId,
      exerciseName: input.exerciseName,
      weightIncrement: input.increment,
    })
    .onConflictDoUpdate({
      target: [exercisePreferences.userId, exercisePreferences.exerciseName],
      set: { weightIncrement: input.increment, updatedAt: new Date() },
    });
}

/**
 * Save the rep range one exercise climbs before earning a weight step. Applies
 * from the next session — today's targets are already on the board.
 */
export async function setExerciseRepRange(input: {
  exerciseName: string;
  min: number;
  max: number;
}): Promise<void> {
  const userId = await requireUser();
  const min = Math.round(input.min);
  const max = Math.round(input.max);
  if (!(min >= 1 && max >= min && max <= 30)) throw new Error("invalid rep range");

  await db
    .insert(exercisePreferences)
    .values({
      userId,
      exerciseName: input.exerciseName,
      weightIncrement: inferExerciseMeta(input.exerciseName).weightIncrement,
      repMin: min,
      repMax: max,
    })
    .onConflictDoUpdate({
      target: [exercisePreferences.userId, exercisePreferences.exerciseName],
      set: { repMin: min, repMax: max, updatedAt: new Date() },
    });
}

/**
 * Replace an exercise's remaining sets with a similar one, opening from that
 * exercise's own log book. Logged sets of the outgoing exercise stay put.
 */
export async function swapExercise(input: {
  workoutId: string;
  fromExercise: string;
  toExercise: string;
}): Promise<void> {
  const userId = await requireUser();
  const workout = await ownedWorkout(input.workoutId, userId);
  if (workout.status !== "in_progress") throw new Error("workout is not in progress");

  const rows = await db
    .select({
      id: workoutSets.id,
      exerciseName: workoutSets.exerciseName,
      exerciseOrder: workoutSets.exerciseOrder,
      completedAt: workoutSets.completedAt,
    })
    .from(workoutSets)
    .where(eq(workoutSets.workoutId, input.workoutId));

  if (rows.some((r) => r.exerciseName === input.toExercise))
    throw new Error("exercise already in this workout");
  const fromRows = rows.filter((r) => r.exerciseName === input.fromExercise);
  const unresolvedIds = fromRows.filter((r) => r.completedAt === null).map((r) => r.id);
  if (fromRows.length === 0 || unresolvedIds.length === 0) throw new Error("nothing left to swap");

  const prescribed = await prescribeWorkoutSetRows(userId, [input.toExercise]);
  const newRows = prescribed.map((r) => ({
    ...r,
    workoutId: input.workoutId,
    exerciseOrder: fromRows[0].exerciseOrder, // keep the outgoing exercise's slot
  }));

  await db.transaction(async (tx) => {
    await tx.delete(workoutSets).where(inArray(workoutSets.id, unresolvedIds));
    await tx.insert(workoutSets).values(newRows as (typeof workoutSets.$inferInsert)[]);
  });
}
