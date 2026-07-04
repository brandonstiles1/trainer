"use server";

import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { plans, profiles, workouts, workoutSets, liftEstimates, exercisePreferences } from "@/lib/db/schema";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull } from "drizzle-orm";
import { estimate1RM, weightForReps, type Actual } from "@/lib/adapt";
import { feelFromFeeling } from "@/lib/engine/config";
import { inferExerciseMeta } from "@/lib/engine/infer-meta";
import type { SessionSetLog } from "@/lib/engine/next-workout";
import { isEasySession, weeklyHardSets, type LoggedSetForVolume } from "@/lib/engine/volume";
import {
  recomputeWorkoutRows,
  type StoredActual,
  type StoredPrescribed,
  type WorkoutRow,
} from "@/lib/workouts/engine-adapter";
import { prescribeExercise } from "@/lib/workouts/prescribe-exercise";
import { planTodayDiff } from "@/lib/workouts/plan-today-diff";
import { findPlanDay } from "@/lib/workouts/find-plan-day";

type PlanStructure = {
  split: string;
  days: Array<{
    day: string;
    category: string;
    exercises: Array<{ name: string; order: number; notes?: string }>;
  }>;
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const weekdayForToday = (): string => {
  const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return names[new Date().getDay()];
};

export async function startWorkout(): Promise<
  | { workoutId: string }
  | { restDay: true; category: string | null }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");

  after(async () => {
    const { maybeRunWeeklyReview } = await import("@/lib/actions/weekly-review");
    await maybeRunWeeklyReview(user.id).catch(() => {});
  });

  // Resume an in_progress workout if one exists
  const [inProgress] = await db
    .select()
    .from(workouts)
    .where(and(eq(workouts.userId, user.id), eq(workouts.status, "in_progress")))
    .limit(1);
  if (inProgress) return { workoutId: inProgress.id };

  const [activePlan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.userId, user.id), eq(plans.isActive, true)))
    .limit(1);
  if (!activePlan) throw new Error("no active plan");

  const structure = activePlan.structure as PlanStructure;
  const planDay = findPlanDay(structure, weekdayForToday());
  if (!planDay) return { restDay: true, category: null };

  const exerciseNames = planDay.exercises
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((e) => e.name);

  return createWorkout({
    userId: user.id,
    planId: activePlan.id,
    category: planDay.category,
    exercises: exerciseNames,
  });
}

// Prescribes sets deterministically (engine, no LLM) and inserts the workout + rows.
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

export async function startImpromptuWorkout(
  sourceDay: string,
): Promise<{ workoutId: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");

  after(async () => {
    const { maybeRunWeeklyReview } = await import("@/lib/actions/weekly-review");
    await maybeRunWeeklyReview(user.id).catch(() => {});
  });

  // Resume an in_progress workout if one exists (one active workout at a time).
  const [inProgress] = await db
    .select()
    .from(workouts)
    .where(and(eq(workouts.userId, user.id), eq(workouts.status, "in_progress")))
    .limit(1);
  if (inProgress) return { workoutId: inProgress.id };

  const [activePlan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.userId, user.id), eq(plans.isActive, true)))
    .limit(1);
  if (!activePlan) throw new Error("no active plan");

  const structure = activePlan.structure as PlanStructure;
  const planDay = findPlanDay(structure, sourceDay);
  if (!planDay) throw new Error("plan day not found");

  const exerciseNames = planDay.exercises
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((e) => e.name);

  return createWorkout({
    userId: user.id,
    planId: activePlan.id,
    category: planDay.category,
    exercises: exerciseNames,
  });
}

// ────────── engine input loading ──────────

/** Latest lift estimate per exercise (any source) → baseline e1RM. */
async function latestBaselines(
  userId: string,
  exerciseNames: string[],
): Promise<Record<string, number | null>> {
  const baselines: Record<string, number | null> = {};
  for (const name of exerciseNames) baselines[name] = null;
  if (exerciseNames.length === 0) return baselines;

  const rows = await db
    .select()
    .from(liftEstimates)
    .where(and(eq(liftEstimates.userId, userId), inArray(liftEstimates.exerciseName, exerciseNames)))
    .orderBy(desc(liftEstimates.recordedAt));
  for (const row of rows) {
    if (baselines[row.exerciseName] === null) {
      baselines[row.exerciseName] = estimate1RM(row.weightLbs, row.reps);
    }
  }
  return baselines;
}

/** Per-exercise plate-increment preferences (user's gym equipment). */
async function exerciseIncrements(
  userId: string,
  exerciseNames: string[],
): Promise<Record<string, number>> {
  if (exerciseNames.length === 0) return {};
  const rows = await db
    .select({
      exerciseName: exercisePreferences.exerciseName,
      weightIncrement: exercisePreferences.weightIncrement,
    })
    .from(exercisePreferences)
    .where(
      and(
        eq(exercisePreferences.userId, userId),
        inArray(exercisePreferences.exerciseName, exerciseNames),
      ),
    );
  return Object.fromEntries(rows.map((r) => [r.exerciseName, r.weightIncrement]));
}

async function bodyweightFor(userId: string): Promise<number | undefined> {
  const [profile] = await db
    .select({ weightLbs: profiles.weightLbs })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  return profile?.weightLbs ?? undefined;
}

async function loadWorkoutRows(workoutId: string): Promise<WorkoutRow[]> {
  const rows = await db
    .select()
    .from(workoutSets)
    .where(eq(workoutSets.workoutId, workoutId))
    .orderBy(asc(workoutSets.setNumber));
  return rows.map((r) => ({
    id: r.id,
    exerciseName: r.exerciseName,
    setNumber: r.setNumber,
    prescribed: r.prescribed as StoredPrescribed,
    actual: r.actual as StoredActual | null,
    resolved: r.completedAt !== null,
  }));
}

async function planExerciseOrder(planId: string, dayKey: string): Promise<string[]> {
  const [plan] = await db
    .select({ structure: plans.structure })
    .from(plans)
    .where(eq(plans.id, planId))
    .limit(1);
  const day = (plan?.structure as PlanStructure | undefined)?.days.find(
    (d) => d.category === dayKey,
  );
  if (!day) return [];
  return day.exercises
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((e) => e.name);
}

/**
 * Load the whole workout, apply an in-memory mutation, re-run the engine, and
 * persist the mutation + every changed prescription in one transaction.
 */
async function recomputeAfter(params: {
  workoutId: string;
  userId: string;
  mutate: (rows: WorkoutRow[]) => void;
  persistMutation: (tx: Tx) => Promise<void>;
}): Promise<void> {
  const [workout] = await db
    .select()
    .from(workouts)
    .where(and(eq(workouts.id, params.workoutId), eq(workouts.userId, params.userId)))
    .limit(1);
  if (!workout) throw new Error("workout not found");

  const rows = await loadWorkoutRows(params.workoutId);
  params.mutate(rows);

  const exerciseNames = [...new Set(rows.map((r) => r.exerciseName))];
  const { changed } = recomputeWorkoutRows({
    rows,
    exerciseOrder: await planExerciseOrder(workout.planId, workout.dayKey),
    baselines: await latestBaselines(params.userId, exerciseNames),
    bodyweightLbs: await bodyweightFor(params.userId),
    increments: await exerciseIncrements(params.userId, exerciseNames),
  });

  await db.transaction(async (tx) => {
    await params.persistMutation(tx);
    for (const c of changed) {
      await tx.update(workoutSets).set({ prescribed: c.prescribed }).where(eq(workoutSets.id, c.id));
    }
  });
}

export type CommitSetInput = {
  workoutId: string;
  setId: string;
  actual: Actual;
};

export async function commitSet(input: CommitSetInput): Promise<void> {
  await writeActualAndRecompute(input.workoutId, input.setId, input.actual);
}

/** Edit a previously-logged set; identical write + full re-flow of the workout. */
export async function editSet(input: CommitSetInput): Promise<void> {
  await writeActualAndRecompute(input.workoutId, input.setId, input.actual);
}

async function writeActualAndRecompute(
  workoutId: string,
  setId: string,
  actual: CommitSetInput["actual"],
): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");

  await recomputeAfter({
    workoutId,
    userId: user.id,
    mutate: (rows) => {
      const target = rows.find((r) => r.id === setId);
      if (!target) throw new Error("set not found");
      target.actual = actual;
      target.resolved = true;
    },
    persistMutation: async (tx) => {
      await tx
        .update(workoutSets)
        .set({ actual, completedAt: new Date() })
        .where(and(eq(workoutSets.id, setId), eq(workoutSets.workoutId, workoutId)));
    },
  });
}

/** Mark a not-yet-logged set as skipped: resolved (completedAt) with no actual. */
export async function skipSet(input: { workoutId: string; setId: string }): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");

  await recomputeAfter({
    workoutId: input.workoutId,
    userId: user.id,
    mutate: (rows) => {
      const target = rows.find((r) => r.id === input.setId);
      if (!target) throw new Error("set not found");
      target.actual = null;
      target.resolved = true;
    },
    persistMutation: async (tx) => {
      await tx
        .update(workoutSets)
        .set({ actual: null, completedAt: new Date() })
        .where(and(eq(workoutSets.id, input.setId), eq(workoutSets.workoutId, input.workoutId)));
    },
  });
}

/** Skip every remaining (unresolved) set of one exercise in a workout. */
export async function skipExercise(input: {
  workoutId: string;
  exerciseName: string;
}): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");

  await recomputeAfter({
    workoutId: input.workoutId,
    userId: user.id,
    mutate: (rows) => {
      for (const r of rows) {
        if (r.exerciseName === input.exerciseName && !r.resolved) {
          r.actual = null;
          r.resolved = true;
        }
      }
    },
    persistMutation: async (tx) => {
      await tx
        .update(workoutSets)
        .set({ actual: null, completedAt: new Date() })
        .where(
          and(
            eq(workoutSets.workoutId, input.workoutId),
            eq(workoutSets.exerciseName, input.exerciseName),
            isNull(workoutSets.completedAt),
          ),
        );
    },
  });
}

/** Wipe all logged/skipped sets and restart the clock; prescriptions stay in place. */
export async function restartWorkout(workoutId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");

  const [workout] = await db
    .select({ userId: workouts.userId, status: workouts.status })
    .from(workouts)
    .where(eq(workouts.id, workoutId))
    .limit(1);
  if (!workout || workout.userId !== user.id) throw new Error("workout not found");
  if (workout.status !== "in_progress") throw new Error("workout is not in progress");

  await db.transaction(async (tx) => {
    await tx
      .update(workoutSets)
      .set({ actual: null, completedAt: null })
      .where(eq(workoutSets.workoutId, workoutId));
    await tx
      .update(workouts)
      .set({ startedAt: new Date() })
      .where(eq(workouts.id, workoutId));
  });
}

export async function completeWorkout(workoutId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");

  const [updated] = await db
    .update(workouts)
    .set({ status: "completed", completedAt: new Date() })
    .where(and(eq(workouts.id, workoutId), eq(workouts.userId, user.id)))
    .returning({ planId: workouts.planId, dayKey: workouts.dayKey });
  if (!updated) return;

  // Persist each exercise's final e1RM as the new baseline (stored as a 1RM
  // estimate so estimate1RM(weight, 1) reads it back exactly).
  const rows = await loadWorkoutRows(workoutId);
  const exerciseNames = [...new Set(rows.map((r) => r.exerciseName))];
  const { states } = recomputeWorkoutRows({
    rows,
    exerciseOrder: await planExerciseOrder(updated.planId, updated.dayKey),
    baselines: await latestBaselines(user.id, exerciseNames),
    bodyweightLbs: await bodyweightFor(user.id),
    increments: await exerciseIncrements(user.id, exerciseNames),
  });

  const inserts = states
    .filter(
      (s) =>
        s.persistE1rm != null &&
        rows.some((r) => r.exerciseName === s.name && r.actual !== null),
    )
    .map((s) => ({
      userId: user.id,
      exerciseName: s.name,
      weightLbs: Math.round(weightForReps(s.persistE1rm as number, 1)),
      reps: 1,
      source: "inferred_from_workout" as const,
    }));
  if (inserts.length > 0) {
    await db.insert(liftEstimates).values(inserts);
  }
}

/**
 * Save the user's plate-increment preference for one exercise, then re-flow the
 * current workout's remaining prescriptions onto the new step.
 */
export async function setExerciseIncrement(input: {
  workoutId: string;
  exerciseName: string;
  increment: number;
}): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");
  if (![2.5, 5, 10].includes(input.increment)) throw new Error("unsupported increment");

  await db
    .insert(exercisePreferences)
    .values({
      userId: user.id,
      exerciseName: input.exerciseName,
      weightIncrement: input.increment,
    })
    .onConflictDoUpdate({
      target: [exercisePreferences.userId, exercisePreferences.exerciseName],
      set: { weightIncrement: input.increment, updatedAt: new Date() },
    });

  // The preference is already saved; the reflow just rewrites prescriptions.
  await recomputeAfter({
    workoutId: input.workoutId,
    userId: user.id,
    mutate: () => {},
    persistMutation: async () => {},
  });
}

/**
 * Replace an exercise's remaining sets with a similar exercise, prescribed
 * from the new exercise's own baseline (calibration ramp if it has none).
 * Logged sets of the outgoing exercise stay in the workout's history.
 */
export async function swapExercise(input: {
  workoutId: string;
  fromExercise: string;
  toExercise: string;
}): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");

  const [workout] = await db
    .select({ userId: workouts.userId, status: workouts.status })
    .from(workouts)
    .where(eq(workouts.id, input.workoutId))
    .limit(1);
  if (!workout || workout.userId !== user.id) throw new Error("workout not found");
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
  if (fromRows.length === 0 || unresolvedIds.length === 0)
    throw new Error("nothing left to swap");

  const prescribed = await prescribeWorkoutSetRows(user.id, [input.toExercise]);
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

export async function abandonWorkout(workoutId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");

  await db
    .update(workouts)
    .set({ status: "abandoned", completedAt: new Date() })
    .where(and(eq(workouts.id, workoutId), eq(workouts.userId, user.id)));
}

// ────────── deterministic prescription (creation time) ──────────

/**
 * Prescribe every exercise's sets for a new workout from stored baselines and
 * history — the LLM plays no part in these numbers.
 */
async function prescribeWorkoutSetRows(
  userId: string,
  exerciseNames: string[],
): Promise<
  Array<{ exerciseName: string; setNumber: number; exerciseOrder: number; prescribed: StoredPrescribed }>
> {
  const baselines = await latestBaselines(userId, exerciseNames);
  const bodyweightLbs = await bodyweightFor(userId);
  const increments = await exerciseIncrements(userId, exerciseNames);

  // Rolling 7-day hard-set volume per muscle group, from logged sets.
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const recentSets = await db
    .select({
      exerciseName: workoutSets.exerciseName,
      actual: workoutSets.actual,
      completedAt: workoutSets.completedAt,
    })
    .from(workoutSets)
    .innerJoin(workouts, eq(workouts.id, workoutSets.workoutId))
    .where(and(eq(workouts.userId, userId), gte(workoutSets.completedAt, weekAgo)));
  const volumeSets: LoggedSetForVolume[] = recentSets
    .filter((r) => r.actual !== null && r.completedAt !== null)
    .map((r) => ({
      muscleGroups: inferExerciseMeta(r.exerciseName).muscleGroups,
      feel: feelFromFeeling((r.actual as StoredActual).feeling),
      completedAt: r.completedAt as Date,
    }));
  const hardSetsByGroup = weeklyHardSets(volumeSets, new Date());

  // Past sessions for these exercises (finished workouts only), newest first.
  const history = exerciseNames.length
    ? await db
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
        .limit(300)
    : [];

  const estimateHistory = exerciseNames.length
    ? await db
        .select()
        .from(liftEstimates)
        .where(
          and(
            eq(liftEstimates.userId, userId),
            eq(liftEstimates.source, "inferred_from_workout"),
            inArray(liftEstimates.exerciseName, exerciseNames),
          ),
        )
        .orderBy(asc(liftEstimates.recordedAt))
    : [];

  const out: Array<{
    exerciseName: string;
    setNumber: number;
    exerciseOrder: number;
    prescribed: StoredPrescribed;
  }> = [];
  for (const name of exerciseNames) {
    // Group this exercise's history rows into sessions (workouts), newest first.
    const sessions: Array<{ sets: SessionSetLog[]; wasDeload: boolean }> = [];
    const seen = new Map<string, number>();
    for (const row of history) {
      if (row.exerciseName !== name) continue;
      let idx = seen.get(row.workoutId);
      if (idx === undefined) {
        idx = sessions.length;
        seen.set(row.workoutId, idx);
        sessions.push({ sets: [], wasDeload: false });
      }
      const prescribed = row.prescribed as StoredPrescribed;
      if (prescribed.deload) sessions[idx].wasDeload = true;
      const actual = row.actual as StoredActual | null;
      if (actual) {
        sessions[idx].sets.push({
          prescribedReps: prescribed.targetReps ?? prescribed.reps,
          weight: actual.weight,
          reps: actual.reps,
          feel: feelFromFeeling(actual.feeling),
        });
      }
    }

    let consecutiveEasySessions = 0;
    for (const s of sessions) {
      if (s.sets.length > 0 && isEasySession({ sets: s.sets })) consecutiveEasySessions++;
      else break;
    }

    const meta = inferExerciseMeta(name);
    const weeklyHardSetsForGroup = Math.max(
      0,
      ...meta.muscleGroups.map((g) => hardSetsByGroup.get(g) ?? 0),
    );

    const rows = prescribeExercise({
      name,
      baselineE1rm: baselines[name],
      lastSession: sessions[0] ?? null,
      e1rmHistory: estimateHistory
        .filter((e) => e.exerciseName === name)
        .slice(-6)
        .map((e) => estimate1RM(e.weightLbs, e.reps)),
      weeklyHardSetsForGroup,
      consecutiveEasySessions,
      bodyweightLbs,
      weightIncrement: increments[name],
    });
    out.push(
      ...rows.map((r) => ({ exerciseName: name, exerciseOrder: exerciseNames.indexOf(name), ...r })),
    );
  }
  return out;
}

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

  const today = weekdayForToday();
  const planDay = newStructure.days.find((d) => d.day === today);
  if (!planDay) return; // new plan makes today a rest day — leave the workout as-is

  const newExercises = planDay.exercises
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((e) => e.name);

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
