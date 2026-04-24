import { describe, it, expect } from "vitest";
import { WORKOUT_DESIGN_SYSTEM } from "@/lib/prompts/workout-design";

describe("WORKOUT_DESIGN_SYSTEM prompt", () => {
  it("mentions the submit_workout tool", () => {
    expect(WORKOUT_DESIGN_SYSTEM).toContain("submit_workout");
  });

  it("specifies branch threshold rules", () => {
    expect(WORKOUT_DESIGN_SYSTEM).toContain("threshold_reps");
  });

  it("enforces snake_case naming", () => {
    expect(WORKOUT_DESIGN_SYSTEM).toMatch(/snake_case/i);
  });

  it("is stable length for cache (1k–3k chars)", () => {
    expect(WORKOUT_DESIGN_SYSTEM.length).toBeGreaterThan(1000);
    expect(WORKOUT_DESIGN_SYSTEM.length).toBeLessThan(3000);
  });
});
