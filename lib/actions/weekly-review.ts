"use server";

import { db } from "@/lib/db";
import { profiles, workouts, workoutSets, weeklyReviews } from "@/lib/db/schema";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { isReviewDue } from "@/lib/workouts/review-due";
import { formatReviewContext, type ReviewSetRow } from "@/lib/workouts/review-context";

/**
 * Writes the coach's note on the past week. Commentary only — the numbers come
 * from the log book (`lib/engine/progression`) and nothing here touches them.
 *
 * Runs at most once/week per user. Safe to fire-and-forget; failures don't
 * advance the timestamp.
 */
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

  const context = formatReviewContext({
    workouts: recent.map((w) => ({ id: w.id, dayKey: w.dayKey, startedAt: w.startedAt })),
    sets: sets as unknown as ReviewSetRow[],
  });

  const res = await anthropic().messages.create({
    model: model(),
    max_tokens: 1024,
    system: [{ type: "text", text: WEEKLY_REVIEW_SYSTEM }],
    tools: [submitReviewTool] as never,
    tool_choice: { type: "tool", name: "submit_review" },
    messages: [{ role: "user", content: context }],
  });

  const toolUse = res.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return;
  const parsed = reviewResponseSchema.safeParse(toolUse.input);
  if (!parsed.success) return;

  await db.insert(weeklyReviews).values({
    userId,
    headline: parsed.data.headline,
    observations: parsed.data.observations.map((o) => ({
      exerciseName: o.exercise_name,
      note: o.note,
    })),
    periodStart: weekAgo,
  });
  await db.update(profiles).set({ lastWeeklyReviewAt: now }).where(eq(profiles.userId, userId));
}
