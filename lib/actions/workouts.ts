"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { workouts, workoutSets, exercisePreferences } from "@/lib/db/schema";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { StoredActual, StoredPrescribed } from "@/lib/workouts/stored-set";
import { setsToCarryWeight } from "@/lib/workouts/carry-weight";
import { adHocSpec, type SlotSpec } from "@/lib/workouts/prescribe";
import { activeProgramFor, nextDayFor, prescribeWorkoutSetRows } from "@/lib/workouts/log-book";

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

async function inProgressFor(userId: string) {
  const [row] = await db
    .select({ id: workouts.id })
    .from(workouts)
    .where(and(eq(workouts.userId, userId), eq(workouts.status, "in_progress")))
    .limit(1);
  return row ?? null;
}

// ────────── starting ──────────

export type StartRequest =
  /** The queued rotation workout, or a specific slot (that then becomes the queue position). */
  | { kind: "rotation"; day?: string }
  /** Repeat any slot as an extra session — the rotation doesn't move. */
  | { kind: "repeat"; day: string }
  /** Hand-picked exercises as an extra session. */
  | { kind: "custom"; exercises: string[] };

/**
 * Start a workout, or return the one already running. Only one can be in
 * progress at a time — enforced by a unique index, so a double tap that races
 * past the check still lands on a single workout.
 */
export async function startWorkout(req: StartRequest): Promise<{ workoutId: string }> {
  const userId = await requireUser();
  const existing = await inProgressFor(userId);
  if (existing) return { workoutId: existing.id };

  const { planId, program } = await activeProgramFor(userId);

  let dayKey: string;
  let isExtra: boolean;
  let specs: SlotSpec[];
  if (req.kind === "custom") {
    const names = [...new Set(req.exercises.filter((n) => /^[a-z0-9_]+$/.test(n)))];
    if (names.length === 0) throw new Error("pick at least one exercise");
    // An exercise that's in the routine keeps its routine sets and range.
    const known = new Map(program.days.flatMap((d) => d.exercises).map((e) => [e.name, e]));
    specs = names.map((n) => known.get(n) ?? adHocSpec(n));
    dayKey = "custom";
    isExtra = true;
  } else {
    const day =
      req.day !== undefined
        ? program.days.find((d) => d.day === req.day)
        : await nextDayFor(userId, program);
    if (!day) throw new Error("workout not found in your routine");
    specs = day.exercises;
    dayKey = day.category;
    isExtra = req.kind === "repeat";
  }

  const rows = await prescribeWorkoutSetRows(userId, specs);

  try {
    const workoutId = await db.transaction(async (tx) => {
      const [w] = await tx
        .insert(workouts)
        .values({ userId, planId, dayKey, isExtra, status: "in_progress" })
        .returning({ id: workouts.id });
      if (rows.length > 0) {
        await tx.insert(workoutSets).values(rows.map((r) => ({ workoutId: w.id, ...r })));
      }
      return w.id;
    });
    return { workoutId };
  } catch (err) {
    // Lost a race with another tap: the other workout is the one to open.
    const winner = await inProgressFor(userId);
    if (winner) return { workoutId: winner.id };
    throw err;
  }
}

// ────────── logging ──────────

export type CommitSetInput = {
  workoutId: string;
  setId: string;
  actual: StoredActual;
};

function cleanActual(actual: StoredActual): StoredActual {
  const reps = Math.round(Number(actual.reps));
  const weight = Number(actual.weight);
  if (!Number.isFinite(reps) || reps < 0 || reps > 100) throw new Error("invalid reps");
  if (!Number.isFinite(weight) || Math.abs(weight) > 2000) throw new Error("invalid weight");
  return { reps, weight: Math.round(weight * 100) / 100 };
}

/**
 * Log (or re-log) a set; saved the moment it's tapped. Later unlogged sets of
 * the same exercise follow the weight actually used. Writing the same set
 * twice just overwrites it with the same numbers — safe to retry.
 */
export async function commitSet(input: CommitSetInput): Promise<void> {
  const userId = await requireUser();
  const workout = await ownedWorkout(input.workoutId, userId);
  if (workout.status !== "in_progress") throw new Error("workout is already finished");
  const actual = cleanActual(input.actual);

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
      resolved: r.completedAt !== null || r.id === input.setId,
      targetWeight: (r.prescribed as StoredPrescribed).weight,
    })),
    { exerciseName: target.exerciseName, setNumber: target.setNumber, weight: actual.weight },
  );

  await db.transaction(async (tx) => {
    await tx
      .update(workoutSets)
      .set({ actual, completedAt: target.completedAt ?? new Date() })
      .where(and(eq(workoutSets.id, input.setId), eq(workoutSets.workoutId, input.workoutId)));

    for (const id of carryIds) {
      const row = rows.find((r) => r.id === id)!;
      const prescribed: StoredPrescribed = {
        ...(row.prescribed as StoredPrescribed),
        weight: actual.weight,
      };
      await tx.update(workoutSets).set({ prescribed }).where(eq(workoutSets.id, id));
    }
  });
}

/** Un-log a set (tapped ✓ by mistake). */
export async function uncommitSet(input: { workoutId: string; setId: string }): Promise<void> {
  const userId = await requireUser();
  const workout = await ownedWorkout(input.workoutId, userId);
  if (workout.status !== "in_progress") throw new Error("workout is already finished");
  await db
    .update(workoutSets)
    .set({ actual: null, completedAt: null })
    .where(and(eq(workoutSets.id, input.setId), eq(workoutSets.workoutId, input.workoutId)));
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
  // Numbers and slot info carry over; the recommendation note belongs to set 1.
  const prescribed: StoredPrescribed = { ...lastPrescribed };
  delete prescribed.action;
  delete prescribed.rationale;
  const setNumber = last.setNumber + 1;

  const [created] = await db
    .insert(workoutSets)
    .values({
      workoutId: input.workoutId,
      exerciseName: input.exerciseName,
      setNumber,
      exerciseOrder: last.exerciseOrder,
      prescribed,
    })
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

/** Skip every remaining (unlogged) set of one exercise. The exercise won't count toward progression this time. */
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

/** Wipe all logged sets and restart the clock; targets stay in place. */
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
 * Close the workout out. Only an in-progress workout can be finished, so a
 * second tap (or a stale tab) can't move `completedAt` and reshuffle history.
 * Unlogged sets are marked skipped; any exercise with a skipped prescribed set
 * simply won't count toward progression.
 */
export async function completeWorkout(workoutId: string): Promise<void> {
  const userId = await requireUser();
  await db.transaction(async (tx) => {
    const [done] = await tx
      .update(workouts)
      .set({ status: "completed", completedAt: new Date() })
      .where(
        and(eq(workouts.id, workoutId), eq(workouts.userId, userId), eq(workouts.status, "in_progress")),
      )
      .returning({ id: workouts.id });
    if (!done) return;
    await tx
      .update(workoutSets)
      .set({ completedAt: new Date() })
      .where(and(eq(workoutSets.workoutId, workoutId), isNull(workoutSets.completedAt)));
  });
  revalidatePath("/today");
  revalidatePath("/progress");
}

/** Quit without saving progress: the workout is kept as abandoned and never counts. */
export async function abandonWorkout(workoutId: string): Promise<void> {
  const userId = await requireUser();
  await db
    .update(workouts)
    .set({ status: "abandoned", completedAt: new Date() })
    .where(
      and(eq(workouts.id, workoutId), eq(workouts.userId, userId), eq(workouts.status, "in_progress")),
    );
  revalidatePath("/today");
}

// ────────── per-exercise preferences ──────────

/**
 * Override the load step for one exercise (per dumbbell for dumbbell lifts).
 * Null clears the override back to the equipment default from Settings.
 */
export async function setExerciseIncrement(input: {
  exerciseName: string;
  increment: number | null;
}): Promise<void> {
  const userId = await requireUser();
  const inc = input.increment;
  if (inc !== null && !(inc > 0 && inc <= 50)) throw new Error("unsupported increment");

  await db
    .insert(exercisePreferences)
    .values({ userId, exerciseName: input.exerciseName, weightIncrement: inc })
    .onConflictDoUpdate({
      target: [exercisePreferences.userId, exercisePreferences.exerciseName],
      set: { weightIncrement: inc, updatedAt: new Date() },
    });
}

/**
 * Replace an exercise's remaining sets with another, keeping the slot's set
 * count and rep range and opening from the new exercise's own history. Logged
 * sets of the outgoing exercise stay put.
 */
export async function swapExercise(input: {
  workoutId: string;
  fromExercise: string;
  toExercise: string;
}): Promise<void> {
  const userId = await requireUser();
  const workout = await ownedWorkout(input.workoutId, userId);
  if (workout.status !== "in_progress") throw new Error("workout is not in progress");
  if (!/^[a-z0-9_]+$/.test(input.toExercise)) throw new Error("invalid exercise name");

  const rows = await db.select().from(workoutSets).where(eq(workoutSets.workoutId, input.workoutId));

  if (rows.some((r) => r.exerciseName === input.toExercise))
    throw new Error("exercise already in this workout");
  const fromRows = rows
    .filter((r) => r.exerciseName === input.fromExercise)
    .sort((a, b) => a.setNumber - b.setNumber);
  const unresolvedIds = fromRows.filter((r) => r.completedAt === null).map((r) => r.id);
  if (fromRows.length === 0 || unresolvedIds.length === 0) throw new Error("nothing left to swap");

  const slot = fromRows[0].prescribed as StoredPrescribed;
  const spec = adHocSpec(
    input.toExercise,
    slot.slotSets ?? fromRows.length,
    slot.repMin && slot.repMax ? { min: slot.repMin, max: slot.repMax } : undefined,
  );
  const newRows = (await prescribeWorkoutSetRows(userId, [spec])).map((r) => ({
    ...r,
    workoutId: input.workoutId,
    exerciseOrder: fromRows[0].exerciseOrder, // keep the outgoing exercise's slot
  }));

  await db.transaction(async (tx) => {
    await tx.delete(workoutSets).where(inArray(workoutSets.id, unresolvedIds));
    await tx.insert(workoutSets).values(newRows);
  });
}
