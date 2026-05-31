import { describe, it, expect } from "vitest";
import { findPlanDay } from "@/lib/workouts/find-plan-day";

const structure = {
  split: "ppl",
  days: [
    { day: "monday", category: "push", exercises: [{ name: "bench_press", order: 1 }] },
    { day: "wednesday", category: "pull", exercises: [{ name: "deadlift", order: 1 }] },
  ],
};

describe("findPlanDay", () => {
  it("returns the matching day", () => {
    expect(findPlanDay(structure, "wednesday")?.category).toBe("pull");
  });

  it("returns null when the day is absent", () => {
    expect(findPlanDay(structure, "sunday")).toBeNull();
  });

  it("ignores extra structure fields and returns the full day object", () => {
    const day = findPlanDay(structure, "monday");
    expect(day).toEqual({
      day: "monday",
      category: "push",
      exercises: [{ name: "bench_press", order: 1 }],
    });
  });
});
