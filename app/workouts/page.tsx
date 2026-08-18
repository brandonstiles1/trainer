import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { workouts, workoutSets, weeklyReviews } from "@/lib/db/schema";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { summarizeWorkout } from "@/lib/workouts/summarize-workout";
import type { WeeklyReviewNote } from "@/components/workout/weekly-review-card";
import { WorkoutsList } from "./list";

export default async function WorkoutsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const sessions = await db.select().from(workouts)
    .where(and(eq(workouts.userId, user.id), ne(workouts.status, "in_progress")))
    .orderBy(desc(workouts.startedAt)).limit(50);

  const ids = sessions.map((s) => s.id);
  const sets = ids.length
    ? await db.select().from(workoutSets).where(inArray(workoutSets.workoutId, ids))
    : [];

  const items = sessions.map((s) => {
    const rows = sets.filter((r) => r.workoutId === s.id).map((r) => ({
      exerciseName: r.exerciseName, setNumber: r.setNumber,
      actual: r.actual as { reps: number; weight: number; feeling: string } | null,
    }));
    return {
      id: s.id, dayKey: s.dayKey, status: s.status,
      startedAt: s.startedAt.toISOString(), setCount: rows.filter((r) => r.actual !== null).length,
      ...summarizeWorkout(rows),
    };
  });

  const [latestReview] = await db
    .select()
    .from(weeklyReviews)
    .where(eq(weeklyReviews.userId, user.id))
    .orderBy(desc(weeklyReviews.createdAt))
    .limit(1);

  const review: WeeklyReviewNote | null = latestReview
    ? {
        headline: latestReview.headline,
        observations: latestReview.observations as WeeklyReviewNote["observations"],
        createdAt: latestReview.createdAt.toISOString(),
      }
    : null;

  return <WorkoutsList items={items} review={review} />;
}
