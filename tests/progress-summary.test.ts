import { describe, it, expect } from "vitest";
import { summarizeProgress, weeklyCounts } from "@/lib/progress/summarize";
import type { HistoryRow } from "@/lib/workouts/exercise-history";

const rows = (workoutId: string, date: string, weight: number, reps: number[], name = "lat_pulldown"): HistoryRow[] =>
  reps.map((r, i) => ({
    workoutId,
    exerciseName: name,
    setNumber: i + 1,
    prescribed: { reps: 8, weight, targetReps: 8, slotSets: 3 },
    actual: { weight, reps: r },
    finishedAt: new Date(date),
  }));

describe("summarizeProgress", () => {
  it("charts oldest first and reports current weight, change and PR", () => {
    const [p] = summarizeProgress([
      ...rows("w2", "2026-10-10", 110, [9, 9, 8]),
      ...rows("w1", "2026-10-01", 100, [12, 12, 12]),
    ]);
    expect(p.points.map((x) => x.weight)).toEqual([100, 110]);
    expect(p.current).toBe(110);
    expect(p.change).toBe(10);
    expect(p.pr).toEqual({ weight: 110, reps: 9 });
  });

  it("current ignores a newer incomplete session", () => {
    const [p] = summarizeProgress([
      ...rows("w2", "2026-10-10", 120, [9]),
      ...rows("w1", "2026-10-01", 100, [12, 12, 12]),
    ]);
    expect(p.points[1].complete).toBe(false);
    expect(p.current).toBe(100);
  });
});

describe("weeklyCounts", () => {
  it("buckets finished workouts by Monday-start week", () => {
    const now = new Date(2026, 9, 28); // Wed
    const counts = weeklyCounts(
      [new Date(2026, 9, 26), new Date(2026, 9, 27), new Date(2026, 9, 20), new Date(2026, 5, 1)],
      now,
      3,
    );
    expect(counts.map((c) => c.count)).toEqual([0, 1, 2]);
  });
});
