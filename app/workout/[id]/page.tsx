import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { workouts, workoutSets, profiles } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { inferExerciseMeta } from "@/lib/engine/infer-meta";
import {
  exercisePreferencesFor,
  planExerciseOrder,
  recentSessionsFor,
} from "@/lib/workouts/log-book";
import { personalRecord } from "@/lib/workouts/exercise-history";
import { Session, type ExerciseInfo, type SessionSet } from "./session";
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
    .orderBy(asc(workoutSets.setNumber));

  // exercise_order wins (it survives mid-workout swaps); rows predating the
  // column are all 0 and fall through to plan-day order.
  const planOrder = new Map(
    (await planExerciseOrder(workout.planId, workout.dayKey)).map((name, i) => [name, i]),
  );
  const sortedRows = [...rows].sort((a, b) => {
    if (a.exerciseOrder !== b.exerciseOrder) return a.exerciseOrder - b.exerciseOrder;
    const ao = planOrder.get(a.exerciseName) ?? 999;
    const bo = planOrder.get(b.exerciseName) ?? 999;
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
    const p = r.prescribed as SessionSet["prescribed"];
    return {
      id: r.id,
      exerciseName: r.exerciseName,
      setNumber: r.setNumber,
      prescribed: { ...p, targetReps: p.targetReps ?? p.reps },
      completed: r.completedAt !== null,
      actual: r.actual as SessionSet["actual"],
    };
  });

  const [profile] = await db
    .select({ rest: profiles.restTimerSeconds })
    .from(profiles)
    .where(eq(profiles.userId, user.id))
    .limit(1);

  // The log book behind the info icon: recent sessions, PR, and the settings
  // that decide when this exercise earns a bump. Loaded here so tapping the
  // icon mid-workout is instant.
  const exerciseNames = [...new Set(sets.map((s) => s.exerciseName))];
  const [history, prefs] = await Promise.all([
    recentSessionsFor(user.id, exerciseNames),
    exercisePreferencesFor(user.id, exerciseNames),
  ]);
  const info: Record<string, ExerciseInfo> = Object.fromEntries(
    exerciseNames.map((name) => {
      const meta = inferExerciseMeta(name);
      const sessions = history[name] ?? [];
      return [
        name,
        {
          sessions: sessions.map((s) => ({
            finishedAt: s.finishedAt ? s.finishedAt.toISOString() : null,
            sets: s.sets,
          })),
          personalRecord: personalRecord(sessions),
          weightIncrement: prefs[name]?.weightIncrement ?? meta.weightIncrement,
          repRange: prefs[name]?.repRange ?? meta.repRange,
        } satisfies ExerciseInfo,
      ];
    }),
  );

  return (
    <Session
      // Restart resets startedAt and a swap changes the exercise list — remount
      // on either so client state rebuilds from fresh props.
      key={`${workout.startedAt.getTime()}:${exerciseNames.join("|")}`}
      workoutId={id}
      dayName={workout.dayKey}
      initialSets={sets}
      restSeconds={profile?.rest ?? 75}
      startedAtMs={workout.startedAt.getTime()}
      exerciseInfo={info}
    />
  );
}
