import { feelFromFeeling } from "@/lib/engine/feel";
import type { LoggedSet } from "@/lib/engine/progression";
import type { StoredActual, StoredPrescribed } from "./stored-set";

/** A workout_sets row joined to its workout, as the history queries return it. */
export type HistoryRow = {
  workoutId: string;
  exerciseName: string;
  setNumber: number;
  prescribed: StoredPrescribed;
  actual: StoredActual | null;
  finishedAt: Date | null;
};

/** One past session of a single exercise: what was asked for, what was done. */
export type ExerciseSession = {
  workoutId: string;
  finishedAt: Date | null;
  sets: LoggedSet[];
  /**
   * Sets the exercise was carrying that session, skipped ones included. Set
   * count carries forward on this rather than on `sets.length`, so skipping
   * your last set doesn't quietly shrink the exercise next time.
   */
  plannedSets: number;
};

/**
 * Group one exercise's rows into finished sessions, newest first. Skipped sets
 * (no actual) are dropped — they did no work — and a session that ends up empty
 * is dropped with them, so "last time" always means the last time you lifted.
 */
export function groupExerciseSessions(rows: HistoryRow[], exerciseName: string): ExerciseSession[] {
  type Building = {
    workoutId: string;
    finishedAt: Date | null;
    plannedSets: number;
    sets: Array<LoggedSet & { setNumber: number }>;
  };
  const byWorkout = new Map<string, Building>();

  for (const row of rows) {
    if (row.exerciseName !== exerciseName) continue;
    let session = byWorkout.get(row.workoutId);
    if (!session) {
      session = { workoutId: row.workoutId, finishedAt: row.finishedAt, plannedSets: 0, sets: [] };
      byWorkout.set(row.workoutId, session);
    }
    session.plannedSets++;
    if (!row.actual) continue;
    session.sets.push({
      setNumber: row.setNumber,
      targetReps: row.prescribed.targetReps ?? row.prescribed.reps,
      weight: row.actual.weight,
      reps: row.actual.reps,
      feel: feelFromFeeling(row.actual.feeling),
    });
  }

  return [...byWorkout.values()]
    .filter((s) => s.sets.length > 0)
    .sort((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0))
    .map((s) => ({
      workoutId: s.workoutId,
      finishedAt: s.finishedAt,
      plannedSets: s.plannedSets,
      // Set order is load-bearing: targets carry forward position for position.
      sets: s.sets
        .sort((a, b) => a.setNumber - b.setNumber)
        .map((set) => ({ targetReps: set.targetReps, weight: set.weight, reps: set.reps, feel: set.feel })),
    }));
}

/** The target a session was chasing: its heaviest load at its highest rep target. */
function signatureOf(session: ExerciseSession): string {
  const weight = Math.max(...session.sets.map((s) => s.weight));
  const reps = Math.max(...session.sets.map((s) => s.targetReps));
  return `${weight}x${reps}`;
}

/**
 * How many sessions before the newest one were chasing the same target — the
 * count of times progression has already stalled here. Zero means the last
 * session was the first at this target.
 */
export function consecutiveSameTarget(sessions: ExerciseSession[]): number {
  if (sessions.length === 0) return 0;
  const newest = signatureOf(sessions[0]);
  let count = 0;
  for (let i = 1; i < sessions.length && signatureOf(sessions[i]) === newest; i++) count++;
  return count;
}

/** Heaviest set ever logged, tie-broken by reps — the exercise's standing PR. */
export function personalRecord(
  sessions: ExerciseSession[],
): { weight: number; reps: number } | null {
  let best: { weight: number; reps: number } | null = null;
  for (const session of sessions) {
    for (const set of session.sets) {
      if (!best || set.weight > best.weight || (set.weight === best.weight && set.reps > best.reps)) {
        best = { weight: set.weight, reps: set.reps };
      }
    }
  }
  return best;
}
