"use server";

import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { plans, goals } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { extractPlan, type Plan } from "@/lib/plan-parser";
import { adjustTodayWorkout } from "@/lib/workouts/log-book";

export type AcceptPlanInput = {
  goalId: string;
  transcript: Array<{ role: "user" | "assistant"; content: string }>;
};

export async function acceptPlan(input: AcceptPlanInput): Promise<{ planId: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");

  // Find the latest assistant message containing a valid plan block.
  let parsed: Plan | null = null;
  for (let i = input.transcript.length - 1; i >= 0; i--) {
    const m = input.transcript[i];
    if (m.role !== "assistant") continue;
    parsed = extractPlan(m.content);
    if (parsed) break;
  }
  if (!parsed) throw new Error("no valid plan block found in transcript");

  // Verify the goal belongs to this user.
  const [goal] = await db.select().from(goals).where(eq(goals.id, input.goalId)).limit(1);
  if (!goal || goal.userId !== user.id) throw new Error("goal not found");

  // Persist the transcript on the goal.
  await db
    .update(goals)
    .set({ chatTranscript: input.transcript })
    .where(eq(goals.id, input.goalId));

  // Deactivate any existing active plan.
  await db
    .update(plans)
    .set({ isActive: false, deactivatedAt: new Date() })
    .where(and(eq(plans.userId, user.id), eq(plans.isActive, true)));

  // Insert the new active plan.
  const [row] = await db
    .insert(plans)
    .values({
      userId: user.id,
      goalId: input.goalId,
      structure: parsed,
      isActive: true,
      activatedAt: new Date(),
    } as typeof plans.$inferInsert)
    .returning({ id: plans.id });

  // Bring today's in-progress workout in line with the new plan, if any.
  await adjustTodayWorkout({
    userId: user.id,
    newPlanId: row.id,
    newStructure: parsed,
  });

  return { planId: row.id };
}
