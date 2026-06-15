import { describe, it, expect } from "vitest";
import { workoutResponseSchema, submitWorkoutTool } from "@/lib/workout-tool";

describe("workout tool schema", () => {
  it("accepts the simplified shape (rationale + target_reps, no branches)", () => {
    const ok = {
      exercises: [
        {
          name: "incline_press",
          rationale: "~70% of flat bench max 200",
          sets: [
            { set_number: 1, target_reps: 8, weight: 140 },
            { set_number: 2, target_reps: 8, weight: 140 },
          ],
        },
      ],
    };
    expect(workoutResponseSchema.safeParse(ok).success).toBe(true);
  });

  it("strips unknown fields like a stale branches tree", () => {
    const parsed = workoutResponseSchema.parse({
      exercises: [{ name: "incline_press", rationale: "x", sets: [{ set_number: 1, target_reps: 8, weight: 140 }] }],
    });
    expect(parsed.exercises[0].sets[0]).not.toHaveProperty("branches");
  });

  it("tool input_schema requires rationale and target_reps, not branches", () => {
    const props = (submitWorkoutTool.input_schema.properties.exercises as any).items.properties;
    expect(props.rationale).toBeDefined();
    const setProps = props.sets.items.properties;
    expect(setProps.target_reps).toBeDefined();
    expect(setProps.branches).toBeUndefined();
  });
});
