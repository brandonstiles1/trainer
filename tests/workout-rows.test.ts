import { describe, it, expect } from "vitest";
import { toSetRows } from "@/lib/workouts/to-set-rows";
import type { WorkoutResponse } from "@/lib/workout-tool";

const gen: WorkoutResponse = {
  exercises: [
    {
      name: "incline_press",
      rationale: "≈70% of flat bench 200",
      sets: [
        { set_number: 1, target_reps: 8, weight: 140 },
        { set_number: 2, target_reps: 8, weight: 140 },
      ],
    },
  ],
};

describe("toSetRows", () => {
  it("builds rows with the new prescribed shape (reps, weight, targetReps, rationale on set 1)", () => {
    const rows = toSetRows("workout-1", gen);
    expect(rows).toHaveLength(2);
    expect(rows[0].prescribed).toEqual({
      reps: 8,
      weight: 140,
      targetReps: 8,
      rationale: "≈70% of flat bench 200",
    });
    expect(rows[1].prescribed).toEqual({ reps: 8, weight: 140, targetReps: 8 });
  });
});
