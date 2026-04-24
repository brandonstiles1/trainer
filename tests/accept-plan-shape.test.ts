import { describe, it, expect } from "vitest";
import { extractPlan, planSchema } from "@/lib/plan-parser";

describe("accept plan integration shape", () => {
  const realistic = `Great — here's a 3-day push/pull/legs split.

<plan>
{
  "split": "push_pull_legs",
  "notes": "3 days/week, ~60 min each. Compounds first, accessories second.",
  "days": [
    {
      "day": "monday",
      "category": "push",
      "exercises": [
        { "name": "bench_press", "order": 1 },
        { "name": "overhead_press", "order": 2 },
        { "name": "incline_dumbbell_press", "order": 3 },
        { "name": "tricep_rope_extensions", "order": 4 }
      ]
    },
    {
      "day": "wednesday",
      "category": "pull",
      "exercises": [
        { "name": "deadlift", "order": 1 },
        { "name": "pullup", "order": 2 },
        { "name": "barbell_row", "order": 3 },
        { "name": "bicep_curl", "order": 4 }
      ]
    },
    {
      "day": "friday",
      "category": "legs",
      "exercises": [
        { "name": "back_squat", "order": 1 },
        { "name": "romanian_deadlift", "order": 2 },
        { "name": "walking_lunge", "order": 3 },
        { "name": "calf_raise", "order": 4 }
      ]
    }
  ]
}
</plan>

Let me know if you'd like changes.`;

  it("parses a realistic Claude response to a valid Plan", () => {
    const plan = extractPlan(realistic);
    expect(plan).not.toBeNull();
    expect(plan?.days).toHaveLength(3);
    expect(plan?.days.map((d) => d.category)).toEqual(["push", "pull", "legs"]);
  });

  it("re-validates via planSchema (safety check for jsonb column insert)", () => {
    const plan = extractPlan(realistic);
    expect(plan).not.toBeNull();
    const result = planSchema.safeParse(plan);
    expect(result.success).toBe(true);
  });
});
