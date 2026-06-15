import { describe, it, expect } from "vitest";
import { estimate1RM, weightForReps, roundToStep } from "@/lib/adapt";

describe("Epley helpers", () => {
  it("estimate1RM: 100x8 ≈ 126.67", () => {
    expect(estimate1RM(100, 8)).toBeCloseTo(126.6667, 3);
  });
  it("weightForReps inverts estimate1RM", () => {
    const e = estimate1RM(100, 8);
    expect(weightForReps(e, 8)).toBeCloseTo(100, 6);
  });
  it("roundToStep rounds to nearest 5 by default", () => {
    expect(roundToStep(90.48)).toBe(90);
    expect(roundToStep(92.6)).toBe(95);
    expect(roundToStep(13, 2.5)).toBe(12.5);
  });
});
