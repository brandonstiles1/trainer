import { feelFromFeeling, FEEL_LABEL } from "@/lib/engine/feel";
import type { StoredActual, StoredPrescribed } from "./stored-set";

export type ReviewSetRow = {
  workoutId: string;
  exerciseName: string;
  setNumber: number;
  prescribed: StoredPrescribed;
  actual: StoredActual | null;
};

export type ReviewWorkout = { id: string; dayKey: string; startedAt: Date };

/**
 * The week, written out for the coach: one block per session, each set as
 * target vs. what was logged. Deliberately plain — the model is reading a log
 * book, not being handed conclusions to rubber-stamp.
 */
export function formatReviewContext(input: {
  workouts: ReviewWorkout[];
  sets: ReviewSetRow[];
}): string {
  const byWorkout = new Map<string, ReviewSetRow[]>();
  for (const set of input.sets) {
    if (!byWorkout.has(set.workoutId)) byWorkout.set(set.workoutId, []);
    byWorkout.get(set.workoutId)!.push(set);
  }

  const sessions = [...input.workouts]
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
    .map((workout) => {
      const rows = (byWorkout.get(workout.id) ?? [])
        .slice()
        .sort((a, b) => a.exerciseName.localeCompare(b.exerciseName) || a.setNumber - b.setNumber);

      const byExercise = new Map<string, string[]>();
      for (const row of rows) {
        const target = row.prescribed.targetReps ?? row.prescribed.reps;
        const line = row.actual
          ? `${row.actual.reps}×${row.actual.weight} (target ${target}×${row.prescribed.weight}, felt ${
              FEEL_LABEL[feelFromFeeling(row.actual.feeling)]
            })`
          : `skipped (target ${target}×${row.prescribed.weight})`;
        if (!byExercise.has(row.exerciseName)) byExercise.set(row.exerciseName, []);
        byExercise.get(row.exerciseName)!.push(line);
      }

      const body =
        byExercise.size === 0
          ? "  (no sets logged)"
          : [...byExercise]
              .map(([name, lines]) => `  ${name}: ${lines.join("; ")}`)
              .join("\n");
      return `${workout.startedAt.toISOString().slice(0, 10)} — ${workout.dayKey}\n${body}`;
    });

  return sessions.length === 0 ? "No sessions this week." : sessions.join("\n\n");
}
