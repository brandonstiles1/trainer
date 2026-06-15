import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { workouts, workoutSets, profiles, plans } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { Session, type SessionSet } from "./session";
import { Summary } from "@/components/workout/summary";

type PlanStructure = {
  days: Array<{
    day: string;
    category: string;
    exercises: Array<{ name: string; order: number }>;
  }>;
};

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
    .orderBy(asc(workoutSets.setNumber));

  // Sort exercises by their order in the plan day (workoutSets has no exercise-order column).
  const [plan] = await db
    .select({ structure: plans.structure })
    .from(plans)
    .where(eq(plans.id, workout.planId))
    .limit(1);
  const planDay = (plan?.structure as PlanStructure | undefined)?.days.find(
    (d) => d.category === workout.dayKey,
  );
  const exerciseOrder = new Map<string, number>();
  if (planDay) {
    for (const ex of planDay.exercises) {
      exerciseOrder.set(ex.name, ex.order);
    }
  }
  const sortedRows = [...rows].sort((a, b) => {
    const ao = exerciseOrder.get(a.exerciseName) ?? 999;
    const bo = exerciseOrder.get(b.exerciseName) ?? 999;
    if (ao !== bo) return ao - bo;
    return a.setNumber - b.setNumber;
  });

  if (workout.status !== "in_progress") {
    const summary = sortedRows.map((r) => ({
      exerciseName: r.exerciseName,
      setNumber: r.setNumber,
      prescribed: r.prescribed as { reps: number; weight: number },
      actual: r.actual as { reps: number; weight: number; feeling: string } | null,
    }));
    return <Summary sets={summary} />;
  }

  const sets: SessionSet[] = sortedRows.map((r) => {
    const p = r.prescribed as {
      reps: number; weight: number; targetReps?: number; rationale?: string;
    };
    return {
      id: r.id,
      exerciseName: r.exerciseName,
      setNumber: r.setNumber,
      prescribed: { reps: p.reps, weight: p.weight, targetReps: p.targetReps ?? p.reps, rationale: p.rationale },
      completed: r.completedAt !== null,
      actual: r.actual as SessionSet["actual"],
    };
  });

  const [profile] = await db.select({ rest: profiles.restTimerSeconds }).from(profiles).where(eq(profiles.userId, user.id)).limit(1);
  const restSeconds = profile?.rest ?? 75;

  return (
    <Session
      workoutId={id}
      dayName={workout.dayKey}
      initialSets={sets}
      restSeconds={restSeconds}
      startedAtMs={workout.startedAt.getTime()}
    />
  );
}
