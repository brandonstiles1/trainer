import { groupExerciseSessions, personalRecord, type HistoryRow } from "@/lib/workouts/exercise-history";
import { workingWeight } from "@/lib/engine/double-progression";

export type ProgressPoint = {
  /** ISO date of the session. */
  date: string;
  /** Lightest working set — the weight the session was "at". */
  weight: number;
  /** Heaviest set that session. */
  top: number;
  sets: Array<{ weight: number; reps: number }>;
  complete: boolean;
};

export type ExerciseProgress = {
  name: string;
  /** Oldest first, for charting. */
  points: ProgressPoint[];
  /** Working weight of the latest complete session, else the latest session. */
  current: number;
  /** Change in working weight from the first session to now. */
  change: number;
  pr: { weight: number; reps: number } | null;
  lastDate: string;
};

/** Per-exercise progress from every finished set, most recently trained first. */
export function summarizeProgress(rows: HistoryRow[]): ExerciseProgress[] {
  const names = [...new Set(rows.map((r) => r.exerciseName))];
  const out: ExerciseProgress[] = [];
  for (const name of names) {
    const sessions = groupExerciseSessions(rows, name);
    if (sessions.length === 0) continue;
    const points = sessions
      .map((s) => {
        const judged = s.sets.length > 0 ? s.sets : s.allSets;
        return {
          date: s.finishedAt.toISOString(),
          weight: workingWeight(judged),
          top: Math.max(...s.allSets.map((x) => x.weight)),
          sets: s.allSets,
          complete: s.complete,
        };
      })
      .reverse();
    const latest = [...points].reverse().find((p) => p.complete) ?? points[points.length - 1];
    out.push({
      name,
      points,
      current: latest.weight,
      change: latest.weight - points[0].weight,
      pr: personalRecord(sessions),
      lastDate: points[points.length - 1].date,
    });
  }
  return out.sort((a, b) => b.lastDate.localeCompare(a.lastDate));
}

/** Monday 00:00 (local to the given offset-free Date) of the week containing `d`. */
function weekStart(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

/** Finished workouts per week for the last `weeks` weeks, oldest first. */
export function weeklyCounts(finished: Date[], now: Date, weeks = 8): Array<{ week: string; count: number }> {
  const thisWeek = weekStart(now);
  const buckets = Array.from({ length: weeks }, (_, i) => {
    const start = new Date(thisWeek);
    start.setDate(start.getDate() - 7 * (weeks - 1 - i));
    return { start, count: 0 };
  });
  for (const d of finished) {
    const ws = weekStart(d).getTime();
    const b = buckets.find((x) => x.start.getTime() === ws);
    if (b) b.count++;
  }
  return buckets.map((b) => ({ week: b.start.toISOString(), count: b.count }));
}
