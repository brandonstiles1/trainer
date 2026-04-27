import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { workouts, workoutSets, profiles } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { Session, type SessionSet } from "./session";
import { Summary } from "@/components/workout/summary";

export default async function WorkoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [workout] = await db
    .select()
    .from(workouts)
    .where(and(eq(workouts.id, id), eq(workouts.userId, user.id)))
    .limit(1);
  if (!workout) redirect("/today");

  const rows = await db
    .select()
    .from(workoutSets)
    .where(eq(workoutSets.workoutId, id))
    .orderBy(asc(workoutSets.exerciseName), asc(workoutSets.setNumber));

  if (workout.status !== "in_progress") {
    const summary = rows.map((r) => ({
      exerciseName: r.exerciseName,
      setNumber: r.setNumber,
      prescribed: r.prescribed as { reps: number; weight: number },
      actual: r.actual as { reps: number; weight: number; feeling: string } | null,
    }));
    return <Summary sets={summary} />;
  }

  const sets: SessionSet[] = rows.map((r) => {
    const p = r.prescribed as { reps: number; weight: number };
    return {
      id: r.id,
      exerciseName: r.exerciseName,
      setNumber: r.setNumber,
      prescribed: { reps: p.reps, weight: p.weight },
      completed: r.completedAt !== null,
      actual: r.actual as SessionSet["actual"],
    };
  });

  const [profile] = await db.select({ rest: profiles.restTimerSeconds }).from(profiles).where(eq(profiles.userId, user.id)).limit(1);
  const restSeconds = profile?.rest ?? 75;

  return <Session workoutId={id} initialSets={sets} restSeconds={restSeconds} />;
}
