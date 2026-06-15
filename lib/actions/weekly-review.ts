"use server";

import { db } from "@/lib/db";
import { profiles, workouts, workoutSets, liftEstimates } from "@/lib/db/schema";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { isReviewDue } from "@/lib/workouts/review-due";

/** Runs at most once/week per user. Safe to fire-and-forget; failures don't advance the timestamp. */
export async function maybeRunWeeklyReview(userId: string): Promise<void> {
  const [profile] = await db.select({ last: profiles.lastWeeklyReviewAt })
    .from(profiles).where(eq(profiles.userId, userId)).limit(1);
  const now = new Date();
  if (!isReviewDue(profile?.last ?? null, now)) return;

  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const recent = await db.select().from(workouts)
    .where(and(eq(workouts.userId, userId), eq(workouts.status, "completed"), gte(workouts.startedAt, weekAgo)))
    .orderBy(desc(workouts.startedAt));
  if (recent.length === 0) return; // nothing to review; try again next time

  const { anthropic, model } = await import("@/lib/anthropic");
  const { WEEKLY_REVIEW_SYSTEM } = await import("@/lib/prompts/weekly-review");
  const { submitReviewTool, reviewResponseSchema } = await import("@/lib/review-tool");

  const ids = recent.map((w) => w.id);
  const sets = await db.select().from(workoutSets).where(inArray(workoutSets.workoutId, ids));
  const pins = await db.select().from(liftEstimates)
    .where(and(eq(liftEstimates.userId, userId), eq(liftEstimates.source, "user_pinned")));

  const context =
    `Pinned baselines:\n${pins.map((p) => `- ${p.exerciseName}: ${p.weightLbs}x${p.reps}`).join("\n") || "none"}\n\n` +
    `This week's sets:\n${sets.map((s) => {
      const p = s.prescribed as { reps: number; weight: number };
      const a = s.actual as { reps: number; weight: number; feeling: string } | null;
      return `- ${s.exerciseName}: prescribed ${p.reps}x${p.weight}${a ? `, actual ${a.reps}x${a.weight} (${a.feeling})` : ""}`;
    }).join("\n")}`;

  const res = await anthropic().messages.create({
    model: model(),
    max_tokens: 1024,
    system: [{ type: "text", text: WEEKLY_REVIEW_SYSTEM }],
    tools: [submitReviewTool] as any,
    tool_choice: { type: "tool", name: "submit_review" },
    messages: [{ role: "user", content: context }],
  });

  const toolUse = res.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return;
  const parsed = reviewResponseSchema.safeParse(toolUse.input);
  if (!parsed.success) return;

  if (parsed.data.updates.length) {
    await db.insert(liftEstimates).values(parsed.data.updates.map((u) => ({
      userId, exerciseName: u.exercise_name, weightLbs: Math.round(u.weight_lbs),
      reps: u.reps, source: "inferred_from_workout" as const,
    })));
  }
  await db.update(profiles).set({ lastWeeklyReviewAt: now }).where(eq(profiles.userId, userId));
}
