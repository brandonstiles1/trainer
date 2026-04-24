import { describe, it, expect } from "vitest";
import { workoutResponseSchema, submitWorkoutTool } from "@/lib/workout-tool";

const valid = {
  exercises: [
    {
      name: "bench_press",
      sets: [
        {
          set_number: 1,
          prescribed: { reps: 8, weight: 185 },
          branches: {
            under: { threshold_reps: 6, next_set: { reps: 8, weight: 175 } },
            on: { next_set: { reps: 8, weight: 185 } },
            over: { threshold_reps: 10, next_set: { reps: 8, weight: 195 } },
          },
        },
      ],
    },
  ],
};

describe("workoutResponseSchema", () => {
  it("accepts a valid response", () => {
    expect(workoutResponseSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty exercises", () => {
    expect(workoutResponseSchema.safeParse({ exercises: [] }).success).toBe(false);
  });

  it("rejects non-snake_case exercise names", () => {
    const bad = structuredClone(valid);
    bad.exercises[0].name = "Bench Press";
    expect(workoutResponseSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects missing branches", () => {
    const bad = { exercises: [{ name: "bench_press", sets: [{ set_number: 1, prescribed: { reps: 8, weight: 185 } }] }] };
    expect(workoutResponseSchema.safeParse(bad).success).toBe(false);
  });
});

describe("submitWorkoutTool", () => {
  it("is named correctly", () => {
    expect(submitWorkoutTool.name).toBe("submit_workout");
  });

  it("has a valid JSON Schema shape", () => {
    expect(submitWorkoutTool.input_schema.type).toBe("object");
    expect(submitWorkoutTool.input_schema.required).toContain("exercises");
  });
});
