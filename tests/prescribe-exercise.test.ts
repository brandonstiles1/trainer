import { describe, it, expect } from "vitest";
import { prescribeExercise, BASE_SET_COUNT } from "@/lib/workouts/prescribe-exercise";
import type { ExerciseSession } from "@/lib/workouts/exercise-history";
import { inferExerciseMeta } from "@/lib/engine/infer-meta";

const sessionOf = (
  sets: Array<{ targetReps: number; weight: number; reps: number }>,
  id = "w1",
  plannedSets?: number,
): ExerciseSession => ({
  workoutId: id,
  finishedAt: new Date("2026-08-01"),
  plannedSets: plannedSets ?? sets.length,
  sets: sets.map((s) => ({ ...s, feel: "medium" as const })),
});

const threeSetsAt = (targetReps: number, weight: number, reps = targetReps, id = "w1") =>
  sessionOf(
    Array.from({ length: 3 }, () => ({ targetReps, weight, reps })),
    id,
  );

describe("prescribeExercise", () => {
  it("opens a first-timer at the bottom of the rep range", () => {
    const rows = prescribeExercise({ name: "barbell_curl", sessions: [] });
    expect(rows).toHaveLength(BASE_SET_COUNT);
    expect(rows[0].setNumber).toBe(1);
    expect(rows[0].prescribed.targetReps).toBe(inferExerciseMeta("barbell_curl").repRange.min);
  });

  it("carries the seed load onto every opening set", () => {
    const rows = prescribeExercise({ name: "bench_press", sessions: [], seedWeight: 135 });
    expect(rows.every((r) => r.prescribed.weight === 135)).toBe(true);
  });

  it("adds a rep after a clean session", () => {
    const rows = prescribeExercise({
      name: "barbell_curl",
      sessions: [threeSetsAt(10, 55)],
    });
    expect(rows.map((r) => r.prescribed.targetReps)).toEqual([11, 11, 11]);
    expect(rows.every((r) => r.prescribed.weight === 55)).toBe(true);
  });

  it("repeats the target after a missed set", () => {
    const rows = prescribeExercise({
      name: "barbell_curl",
      sessions: [
        sessionOf([
          { targetReps: 10, weight: 55, reps: 10 },
          { targetReps: 10, weight: 55, reps: 9 },
          { targetReps: 10, weight: 55, reps: 9 },
        ]),
      ],
    });
    expect(rows.map((r) => r.prescribed.targetReps)).toEqual([10, 10, 10]);
  });

  it("keeps the session's set count rather than resetting to the default", () => {
    const rows = prescribeExercise({
      name: "barbell_curl",
      sessions: [sessionOf([{ targetReps: 10, weight: 55, reps: 10 }])],
    });
    expect(rows).toHaveLength(1);
  });

  it("holds the set count when a set was skipped rather than logged", () => {
    const rows = prescribeExercise({
      name: "barbell_curl",
      sessions: [
        sessionOf(
          [
            { targetReps: 10, weight: 55, reps: 10 },
            { targetReps: 10, weight: 55, reps: 10 },
          ],
          "w1",
          3,
        ),
      ],
    });
    expect(rows).toHaveLength(3);
    expect(rows[2].prescribed).toMatchObject({ weight: 55, targetReps: 11 });
  });

  it("honours a rep-range preference over the inferred default", () => {
    const rows = prescribeExercise({
      name: "barbell_curl",
      sessions: [threeSetsAt(6, 55)],
      repRange: { min: 4, max: 6 },
      weightIncrement: 5,
    });
    // Already at the top of the custom range, so this is a weight step.
    expect(rows[0].prescribed.weight).toBe(60);
    expect(rows[0].prescribed.targetReps).toBe(4);
  });

  it("honours a weight-increment preference", () => {
    const rows = prescribeExercise({
      name: "barbell_curl",
      sessions: [threeSetsAt(15, 55)],
      weightIncrement: 2.5,
    });
    expect(rows[0].prescribed.weight).toBe(57.5);
  });

  it("puts the reason on set 1 only", () => {
    const rows = prescribeExercise({
      name: "barbell_curl",
      sessions: [threeSetsAt(10, 55)],
    });
    expect(rows[0].prescribed.rationale).toBeTruthy();
    expect(rows.slice(1).every((r) => r.prescribed.rationale === undefined)).toBe(true);
  });

  it("writes reps and targetReps together so old readers still work", () => {
    const rows = prescribeExercise({ name: "barbell_curl", sessions: [threeSetsAt(10, 55)] });
    expect(rows.every((r) => r.prescribed.reps === r.prescribed.targetReps)).toBe(true);
  });

  it("flags a stall once the same target has held for three sessions", () => {
    const stuck = [
      threeSetsAt(10, 55, 9, "w1"),
      threeSetsAt(10, 55, 9, "w2"),
      threeSetsAt(10, 55, 9, "w3"),
    ];
    expect(prescribeExercise({ name: "barbell_curl", sessions: stuck })[0].prescribed.rationale)
      .toContain("stuck");
  });
});
