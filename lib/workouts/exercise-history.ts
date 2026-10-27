import type { LoggedSet, SessionLog } from "@/lib/engine/double-progression";
import type { StoredActual, StoredPrescribed } from "./stored-set";

/** A workout_sets row joined to its (finished) workout, as the history queries return it. */
export type HistoryRow = {
  workoutId: string;
  exerciseName: string;
  setNumber: number;
  prescribed: StoredPrescribed;
  actual: StoredActual | null;
  finishedAt: Date | null;
};

/** One past session of a single exercise. */
export type ExerciseSession = SessionLog & {
  workoutId: string;
  /** Every logged set, prescribed or extra — for history and PRs. */
  allSets: LoggedSet[];
  /** The rep range the session was prescribed, when the row recorded it. */
  repRange: { min: number; max: number } | null;
};

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/**
 * Group one exercise's rows into finished sessions, newest first.
 *
 * A session is *complete* when each of its prescribed working sets — the first
 * `slotSets` by set number — was logged with real numbers. Only those sets are
 * handed to progression; anything added on top shows in history but isn't
 * judged. Sessions with nothing logged at all are dropped.
 */
export function groupExerciseSessions(rows: HistoryRow[], exerciseName: string): ExerciseSession[] {
  const byWorkout = new Map<string, HistoryRow[]>();
  for (const row of rows) {
    if (row.exerciseName !== exerciseName || !row.finishedAt) continue;
    const list = byWorkout.get(row.workoutId) ?? [];
    list.push(row);
    byWorkout.set(row.workoutId, list);
  }

  const sessions: ExerciseSession[] = [];
  for (const [workoutId, list] of byWorkout) {
    list.sort((a, b) => a.setNumber - b.setNumber);
    const logged = (r: HistoryRow) => r.actual !== null && isNum(r.actual.weight) && isNum(r.actual.reps);
    const allSets = list.filter(logged).map((r) => ({ weight: r.actual!.weight, reps: r.actual!.reps }));
    if (allSets.length === 0) continue;

    const declared = Math.max(0, ...list.map((r) => r.prescribed?.slotSets ?? 0));
    const slotSets = declared > 0 ? declared : list.length;
    const prescribed = list.slice(0, slotSets);
    const first = list[0].prescribed;

    sessions.push({
      workoutId,
      finishedAt: list[0].finishedAt!,
      complete: prescribed.length === slotSets && prescribed.every(logged),
      sets: prescribed.filter(logged).map((r) => ({ weight: r.actual!.weight, reps: r.actual!.reps })),
      allSets,
      repRange: first?.repMin && first?.repMax ? { min: first.repMin, max: first.repMax } : null,
    });
  }
  return sessions.sort((a, b) => b.finishedAt.getTime() - a.finishedAt.getTime());
}

/** Heaviest set ever logged, tie-broken by reps — the exercise's standing PR. */
export function personalRecord(
  sessions: Array<Pick<ExerciseSession, "allSets">>,
): { weight: number; reps: number } | null {
  let best: { weight: number; reps: number } | null = null;
  for (const session of sessions) {
    for (const set of session.allSets) {
      if (!best || set.weight > best.weight || (set.weight === best.weight && set.reps > best.reps)) {
        best = { weight: set.weight, reps: set.reps };
      }
    }
  }
  return best;
}
