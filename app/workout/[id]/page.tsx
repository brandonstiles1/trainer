import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { workouts, workoutSets } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { metaFor } from "@/lib/program/structure";
import { incrementFor, restFor } from "@/lib/program/settings";
import { personalRecord } from "@/lib/workouts/exercise-history";
import type { StoredActual, StoredPrescribed } from "@/lib/workouts/stored-set";
import type { SlotSpec } from "@/lib/workouts/prescribe";
import {
  activeProgramFor,
  incrementOverridesFor,
  prescribeSlots,
  recentSessionsFor,
  settingsFor,
} from "@/lib/workouts/log-book";
import { Session, type ExerciseInfo, type SessionSet } from "./session";
import { Summary, type SummaryExercise } from "@/components/workout/summary";

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
    .orderBy(asc(workoutSets.exerciseOrder), asc(workoutSets.setNumber));

  const { program } = await activeProgramFor(user.id);
  const day = program.days.find((d) => d.category === workout.dayKey);
  const title =
    workout.dayKey === "custom"
      ? "Extra · Custom session"
      : `${workout.isExtra ? "Extra · " : ""}${day ? `${day.day} · ${day.title}` : workout.dayKey.replace(/_/g, " ")}`;

  const exerciseNames = [...new Set(rows.map((r) => r.exerciseName))];
  const routineEntry = (name: string) => program.days.flatMap((d) => d.exercises).find((e) => e.name === name);

  /** The slot an exercise was prescribed as, read back off its rows. */
  const specOf = (name: string): SlotSpec => {
    const mine = rows.filter((r) => r.exerciseName === name);
    const p = mine[0].prescribed as StoredPrescribed;
    const entry = routineEntry(name);
    const meta = metaFor(entry ?? { name });
    return {
      ...entry,
      name,
      sets: p.slotSets ?? mine.length,
      repMin: p.repMin ?? entry?.repMin ?? meta.repRange.min,
      repMax: p.repMax ?? entry?.repMax ?? meta.repRange.max,
      equipment: p.equipment ?? entry?.equipment,
    };
  };

  if (workout.status !== "in_progress") {
    // What each exercise is set up for next time, now that this session is in the log.
    const next = await prescribeSlots(user.id, exerciseNames.map(specOf));
    const summary: SummaryExercise[] = exerciseNames.map((name, i) => {
      const mine = rows.filter((r) => r.exerciseName === name);
      return {
        name,
        equipment: next[i].meta.type,
        sets: mine.map((r) => r.actual as StoredActual | null),
        next: {
          action: next[i].recommendation.action,
          weight: next[i].recommendation.weight,
          reason: next[i].recommendation.reason,
        },
      };
    });
    return <Summary title={title} status={workout.status} exercises={summary} />;
  }

  const sets: SessionSet[] = rows.map((r) => {
    const p = r.prescribed as StoredPrescribed;
    return {
      id: r.id,
      exerciseName: r.exerciseName,
      setNumber: r.setNumber,
      targetWeight: p.weight,
      targetReps: p.targetReps ?? p.reps,
      completed: r.completedAt !== null,
      actual: r.actual ? { reps: (r.actual as StoredActual).reps, weight: (r.actual as StoredActual).weight } : null,
    };
  });

  const [history, overrides, settings] = await Promise.all([
    recentSessionsFor(user.id, exerciseNames),
    incrementOverridesFor(user.id, exerciseNames),
    settingsFor(user.id),
  ]);

  const info: Record<string, ExerciseInfo> = Object.fromEntries(
    exerciseNames.map((name) => {
      const spec = specOf(name);
      const meta = metaFor(spec);
      const first = rows.find((r) => r.exerciseName === name)!.prescribed as StoredPrescribed;
      const sessions = history[name] ?? [];
      return [
        name,
        {
          sets: spec.sets,
          repMin: spec.repMin,
          repMax: spec.repMax,
          notes: spec.notes,
          equipment: meta.type,
          restSeconds: first.restSeconds ?? restFor(meta, settings),
          action: first.action ?? null,
          rationale: first.rationale ?? null,
          sessions: sessions.slice(0, 5).map((s) => ({
            finishedAt: s.finishedAt.toISOString(),
            complete: s.complete,
            sets: s.allSets,
          })),
          personalRecord: personalRecord(sessions),
          incrementOverride: overrides[name] ?? null,
          defaultIncrement: incrementFor(meta, settings),
          successSessions: settings.successSessions,
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
      title={title}
      initialSets={sets}
      restTimer={settings.restTimer}
      startedAtMs={workout.startedAt.getTime()}
      exerciseInfo={info}
    />
  );
}
