"use server";

import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { plans, workouts, workoutSets } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { workoutResponseSchema } from "@/lib/workout-tool";

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
  const today = weekdayForToday();
  const planDay = structure.days.find((d) => d.day === today);
  if (!planDay) return { restDay: true, category: null };

  const exerciseNames = planDay.exercises
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((e) => e.name);

  const generated = await generateWorkout({ userId: user.id, dayKey: planDay.category, exercises: exerciseNames });

  // Transaction: insert workout row + all prescribed set rows
  const [workoutRow] = await db
    .insert(workouts)
    .values({
      userId: user.id,
      planId: activePlan.id,
      dayKey: planDay.category,
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

// Local helper — calls Anthropic directly.
async function generateWorkout(params: {
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
