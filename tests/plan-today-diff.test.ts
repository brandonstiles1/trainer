import { describe, it, expect } from "vitest";
import { planTodayDiff } from "@/lib/workouts/plan-today-diff";

type Set = { id: string; exerciseName: string; completedAt: Date | null };

describe("planTodayDiff", () => {
  it("preserves started exercises and replaces everything not started", () => {
    const existingSets: Set[] = [
      { id: "a1", exerciseName: "bench_press", completedAt: new Date() }, // started
      { id: "a2", exerciseName: "bench_press", completedAt: null },       // started exercise → keep
      { id: "b1", exerciseName: "overhead_press", completedAt: null },    // not started → delete
      { id: "c1", exerciseName: "tricep_rope_extensions", completedAt: null }, // removed from plan → delete
    ];
    const newDayExercises = ["bench_press", "overhead_press", "lateral_raise"];

    const diff = planTodayDiff({ existingSets, newDayExercises });

    expect(diff.startedExercises.sort()).toEqual(["bench_press"]);
    expect(diff.setIdsToDelete.sort()).toEqual(["b1", "c1"]);
    // bench_press is started (skip); overhead_press + lateral_raise need fresh sets.
    expect(diff.exercisesToGenerate).toEqual(["overhead_press", "lateral_raise"]);
  });

  it("nothing started → delete all existing, generate the whole new day", () => {
    const existingSets: Set[] = [
      { id: "a1", exerciseName: "bench_press", completedAt: null },
      { id: "b1", exerciseName: "overhead_press", completedAt: null },
    ];
    const newDayExercises = ["squat", "leg_press"];

    const diff = planTodayDiff({ existingSets, newDayExercises });

    expect(diff.startedExercises).toEqual([]);
    expect(diff.setIdsToDelete.sort()).toEqual(["a1", "b1"]);
    expect(diff.exercisesToGenerate).toEqual(["squat", "leg_press"]);
  });

  it("preserves order of newDayExercises in exercisesToGenerate", () => {
    const diff = planTodayDiff({
      existingSets: [],
      newDayExercises: ["c", "a", "b"],
    });
    expect(diff.exercisesToGenerate).toEqual(["c", "a", "b"]);
  });
});
