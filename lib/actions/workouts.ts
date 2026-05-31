"use server";

import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { plans, workouts, workoutSets } from "@/lib/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { workoutResponseSchema, type WorkoutResponse } from "@/lib/workout-tool";
import { applyBranch, type Actual } from "@/lib/branch";
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

  const setRows = generated.exercises.flatMap((ex) =>
    ex.sets.map((s) => ({
      workoutId: workoutRow.id,
      exerciseName: ex.name,
      setNumber: s.set_number,
      prescribed: { reps: s.prescribed.reps, weight: s.prescribed.weight, branches: s.branches },
    })),
  );
  await db.insert(workoutSets).values(setRows as (typeof workoutSets.$inferInsert)[]);

  return { workoutId: workoutRow.id };
}

export async function startImpromptuWorkout(
  sourceDay: string,
): Promise<{ workoutId: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");

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
  const { liftEstimates, workouts: wt, workoutSets: ws } = await import("@/lib/db/schema");
  const { and, desc, eq, inArray } = await import("drizzle-orm");

  const history = await db
    .select({
      exerciseName: ws.exerciseName,
      prescribed: ws.prescribed,
      actual: ws.actual,
      completedAt: ws.completedAt,
    })
    .from(ws)
    .innerJoin(wt, eq(wt.id, ws.workoutId))
    .where(and(eq(wt.userId, params.userId), inArray(ws.exerciseName, params.exercises)))
    .orderBy(desc(ws.completedAt))
    .limit(40);

  const estimates = await db
    .select()
    .from(liftEstimates)
    .where(and(eq(liftEstimates.userId, params.userId), inArray(liftEstimates.exerciseName, params.exercises)))
    .orderBy(desc(liftEstimates.recordedAt));

  const userContext =
    `Today is ${params.dayKey} day. Exercises in order: ${params.exercises.join(", ")}.\n\n` +
    (estimates.length
      ? `Self-reported maxes:\n${estimates.map((e) => `- ${e.exerciseName}: ${e.weightLbs} lbs x ${e.reps} reps`).join("\n")}\n\n`
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
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");

  // Ownership check + load the set we're committing
  const [row] = await db
    .select({
      setId: workoutSets.id,
      workoutUserId: workouts.userId,
      exerciseName: workoutSets.exerciseName,
      setNumber: workoutSets.setNumber,
      prescribed: workoutSets.prescribed,
    })
    .from(workoutSets)
    .innerJoin(workouts, eq(workouts.id, workoutSets.workoutId))
    .where(and(eq(workoutSets.id, input.setId), eq(workoutSets.workoutId, input.workoutId)))
    .limit(1);
  if (!row || row.workoutUserId !== user.id) throw new Error("set not found");

  // Write actual + completed_at
  await db
    .update(workoutSets)
    .set({ actual: input.actual, completedAt: new Date() })
    .where(eq(workoutSets.id, input.setId));

  // Apply branch logic to the NEXT set for this exercise (if one exists and isn't already completed).
  const nextSets = await db
    .select()
    .from(workoutSets)
    .where(and(eq(workoutSets.workoutId, input.workoutId), eq(workoutSets.exerciseName, row.exerciseName)))
    .orderBy(asc(workoutSets.setNumber));
  const next = nextSets.find((s) => s.setNumber > row.setNumber && s.completedAt === null);
  if (next) {
    const prescribed = row.prescribed as { reps: number; weight: number; branches: Parameters<typeof applyBranch>[1] };
    const adjusted = applyBranch(input.actual, prescribed.branches);
    const nextPrescribed = next.prescribed as { reps: number; weight: number; branches: unknown };
    await db
      .update(workoutSets)
      .set({
        prescribed: {
          reps: adjusted.reps,
          weight: adjusted.weight,
          branches: nextPrescribed.branches,
        },
      })
      .where(eq(workoutSets.id, next.id));
  }
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

  const newSetRows = generated.exercises.flatMap((ex) =>
    ex.sets.map((s) => ({
      workoutId: inProgress.id,
      exerciseName: ex.name,
      setNumber: s.set_number,
      prescribed: { reps: s.prescribed.reps, weight: s.prescribed.weight, branches: s.branches },
    })),
  );

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
