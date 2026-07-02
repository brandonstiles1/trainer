"use server";

import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { plans, workouts, workoutSets, liftEstimates } from "@/lib/db/schema";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { workoutResponseSchema, type WorkoutResponse } from "@/lib/workout-tool";
import { planTodayDiff } from "@/lib/workouts/plan-today-diff";
import { findPlanDay } from "@/lib/workouts/find-plan-day";
import { recomputeExercise, type StoredSet } from "@/lib/workouts/recompute-exercise";
import { toSetRows } from "@/lib/workouts/to-set-rows";
import type { Actual } from "@/lib/adapt";

type PlanStructure = {
  split: string;
  days: Array<{
    day: string;
    category: string;
    exercises: Array<{ name: string; order: number; notes?: string }>;
  }>;
};

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

// Generates prescribed sets via Claude and inserts the workout + its set rows.
async function createWorkout(params: {
  userId: string;
  planId: string;
  category: string;     // stored as workouts.dayKey
  exercises: string[];  // ordered exercise names
}): Promise<{ workoutId: string }> {
  const generated = await generateWorkout({
    userId: params.userId,
    dayKey: params.category,
    exercises: params.exercises,
  });

  const [workoutRow] = await db
    .insert(workouts)
    .values({
      userId: params.userId,
      planId: params.planId,
      dayKey: params.category,
      status: "in_progress",
    } as typeof workouts.$inferInsert)
    .returning({ id: workouts.id });

  const setRows = toSetRows(workoutRow.id, generated);
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

// Calls Anthropic directly to design prescribed sets for a day's exercises.
export async function generateWorkout(params: {
  userId: string;
  dayKey: string;
  exercises: string[];
}) {
  const { anthropic, model } = await import("@/lib/anthropic");
  const { WORKOUT_DESIGN_SYSTEM } = await import("@/lib/prompts/workout-design");
  const { submitWorkoutTool, workoutResponseSchema } = await import("@/lib/workout-tool");

  const history = await db
    .select({
      exerciseName: workoutSets.exerciseName,
      prescribed: workoutSets.prescribed,
      actual: workoutSets.actual,
      completedAt: workoutSets.completedAt,
    })
    .from(workoutSets)
    .innerJoin(workouts, eq(workouts.id, workoutSets.workoutId))
    .where(and(eq(workouts.userId, params.userId), inArray(workoutSets.exerciseName, params.exercises)))
    .orderBy(desc(workoutSets.completedAt))
    .limit(40);

  const estimates = await db
    .select()
    .from(liftEstimates)
    .where(and(eq(liftEstimates.userId, params.userId), inArray(liftEstimates.exerciseName, params.exercises)))
    .orderBy(desc(liftEstimates.recordedAt));

  const userContext =
    `Today is ${params.dayKey} day. Exercises in order: ${params.exercises.join(", ")}.\n\n` +
    (estimates.length
      ? `Self-reported & pinned maxes:\n${estimates.map((e) => `- ${e.exerciseName}: ${e.weightLbs} lbs x ${e.reps} reps${e.source === "user_pinned" ? " (PINNED — treat as a floor)" : ""}`).join("\n")}\n\n`
      : "No self-reported maxes.\n\n") +
    (history.length
      ? `Recent sets (newest first):\n${history.slice(0, 20).map((h) => {
          const p = h.prescribed as { reps: number; weight: number };
          const a = h.actual as { reps: number; weight: number; feeling: string } | null;
          return `- ${h.exerciseName}: prescribed ${p.reps}x${p.weight}${a ? `, actual ${a.reps}x${a.weight} (${a.feeling})` : ", (skipped)"}`;
        }).join("\n")}`
      : "No prior sessions for these exercises.");

  const res = await anthropic().messages.create({
    model: model(),
    max_tokens: 4096,
    system: [{ type: "text", text: WORKOUT_DESIGN_SYSTEM, cache_control: { type: "ephemeral" } }],
    tools: [submitWorkoutTool] as any,
    tool_choice: { type: "tool", name: "submit_workout" },
    messages: [{ role: "user", content: userContext }],
  });

  const toolUse = res.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") throw new Error("claude: no tool call");
  const parsed = workoutResponseSchema.safeParse(toolUse.input);
  if (!parsed.success) throw new Error(`claude: schema failure: ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}

export type CommitSetInput = {
  workoutId: string;
  setId: string;
  actual: Actual;
};

export async function commitSet(input: CommitSetInput): Promise<void> {
  await writeActualAndRecompute(input.workoutId, input.setId, input.actual);
}

/** Edit a previously-logged set; identical write + full re-flow of the exercise. */
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

  const [row] = await db
    .select({
      workoutUserId: workouts.userId,
      exerciseName: workoutSets.exerciseName,
    })
    .from(workoutSets)
    .innerJoin(workouts, eq(workouts.id, workoutSets.workoutId))
    .where(and(eq(workoutSets.id, setId), eq(workoutSets.workoutId, workoutId)))
    .limit(1);
  if (!row || row.workoutUserId !== user.id) throw new Error("set not found");

  // Pinned baseline floor for this exercise (highest pinned weight), 0 if none.
  const pins = await db
    .select({ weightLbs: liftEstimates.weightLbs })
    .from(liftEstimates)
    .where(
      and(
        eq(liftEstimates.userId, user.id),
        eq(liftEstimates.exerciseName, row.exerciseName),
        eq(liftEstimates.source, "user_pinned"),
      ),
    );
  const floor = pins.reduce((m, p) => Math.max(m, p.weightLbs), 0);

  const ordered = (await db
    .select()
    .from(workoutSets)
    .where(and(eq(workoutSets.workoutId, workoutId), eq(workoutSets.exerciseName, row.exerciseName)))
    .orderBy(asc(workoutSets.setNumber))) as unknown as Array<{
      id: string;
      setNumber: number;
      prescribed: StoredSet["prescribed"];
      actual: StoredSet["actual"];
    }>;

  const withActual = ordered.map((r) =>
    r.id === setId ? { ...r, actual } : r,
  );
  const changed = recomputeExercise(
    withActual.map((r) => ({ id: r.id, setNumber: r.setNumber, prescribed: r.prescribed, actual: r.actual })),
    floor,
  );

  await db.transaction(async (tx) => {
    await tx
      .update(workoutSets)
      .set({ actual, completedAt: new Date() })
      .where(eq(workoutSets.id, setId));
    for (const c of changed) {
      await tx.update(workoutSets).set({ prescribed: c.prescribed }).where(eq(workoutSets.id, c.id));
    }
  });
}

/** Mark a not-yet-logged set as skipped: resolved (completedAt) with no actual. */
export async function skipSet(input: { workoutId: string; setId: string }): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");

  const [row] = await db
    .select({ workoutUserId: workouts.userId })
    .from(workoutSets)
    .innerJoin(workouts, eq(workouts.id, workoutSets.workoutId))
    .where(and(eq(workoutSets.id, input.setId), eq(workoutSets.workoutId, input.workoutId)))
    .limit(1);
  if (!row || row.workoutUserId !== user.id) throw new Error("set not found");

  await db
    .update(workoutSets)
    .set({ actual: null, completedAt: new Date() })
    .where(eq(workoutSets.id, input.setId));
}

/** Skip every remaining (unresolved) set of one exercise in a workout. */
export async function skipExercise(input: {
  workoutId: string;
  exerciseName: string;
}): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");

  const [workout] = await db
    .select({ userId: workouts.userId })
    .from(workouts)
    .where(eq(workouts.id, input.workoutId))
    .limit(1);
  if (!workout || workout.userId !== user.id) throw new Error("workout not found");

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

  await db
    .update(workouts)
    .set({ status: "completed", completedAt: new Date() })
    .where(and(eq(workouts.id, workoutId), eq(workouts.userId, user.id)));
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

  // Generate fresh prescribed sets for not-started exercises (Anthropic call,
  // done BEFORE the destructive DB writes so a failure leaves the workout intact).
  const generated: WorkoutResponse =
    diff.exercisesToGenerate.length > 0
      ? await generateWorkout({
          userId,
          dayKey: planDay.category,
          exercises: diff.exercisesToGenerate,
        })
      : { exercises: [] };

  const newSetRows = toSetRows(inProgress.id, generated);

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
