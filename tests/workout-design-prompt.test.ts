import { describe, it, expect } from "vitest";
import { WORKOUT_DESIGN_SYSTEM } from "@/lib/prompts/workout-design";

describe("workout design prompt", () => {
  it("instructs deriving start weight from related maxes", () => {
    expect(WORKOUT_DESIGN_SYSTEM.toLowerCase()).toMatch(/deriv|related|% of/);
  });
  it("requires a rationale per exercise", () => {
    expect(WORKOUT_DESIGN_SYSTEM.toLowerCase()).toContain("rationale");
  });
  it("no longer mentions branches", () => {
    expect(WORKOUT_DESIGN_SYSTEM.toLowerCase()).not.toContain("branch");
  });
});
