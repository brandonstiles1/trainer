import { describe, it, expect } from "vitest";
import { summarizeWorkout } from "@/lib/workouts/summarize-workout";

describe("summarizeWorkout", () => {
  it("computes volume and groups sets by exercise in order", () => {
    const out = summarizeWorkout([
      { exerciseName: "incline_press", setNumber: 1, actual: { reps: 8, weight: 140, feeling: "yellow" } },
      { exerciseName: "incline_press", setNumber: 2, actual: { reps: 8, weight: 140, feeling: "yellow" } },
      { exerciseName: "lateral_raise", setNumber: 1, actual: { reps: 15, weight: 20, feeling: "green" } },
    ]);
    expect(out.volume).toBe(8 * 140 + 8 * 140 + 15 * 20);
    expect(out.exercises.map((e) => e.name)).toEqual(["incline_press", "lateral_raise"]);
    expect(out.exercises[0].sets).toEqual(["8×140", "8×140"]);
  });

  it("excludes unlogged (null actual) sets from volume and set labels", () => {
    const out = summarizeWorkout([
      { exerciseName: "bench", setNumber: 1, actual: { reps: 5, weight: 185, feeling: "yellow" } },
      { exerciseName: "bench", setNumber: 2, actual: null },
    ]);
    expect(out.volume).toBe(5 * 185);
    expect(out.exercises[0].sets).toEqual(["5×185"]);
  });
});
