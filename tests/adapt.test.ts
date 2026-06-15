import { describe, it, expect } from "vitest";
import { estimate1RM, weightForReps, roundToStep } from "@/lib/adapt";
import { adaptChain, type AdaptSet, type Feeling } from "@/lib/adapt";

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

const seed = (targetReps: number, weight: number): AdaptSet => ({
  prescribed: { reps: targetReps, weight, targetReps },
  actual: null,
});
const logged = (s: AdaptSet, reps: number, weight: number, feeling: Feeling): AdaptSet => ({
  ...s,
  actual: { reps, weight, feeling },
});

describe("adaptChain", () => {
  it("leaves set 1 (seed) untouched", () => {
    const out = adaptChain([seed(10, 37), seed(10, 37), seed(10, 37)]);
    expect(out[0].prescribed.weight).toBe(37);
  });

  it("reacts to a huge over-performance (tricep example)", () => {
    const s1 = logged(seed(10, 37), 8, 100, "yellow");
    const out = adaptChain([s1, seed(10, 37)]);
    expect(out[1].prescribed.weight).toBe(90);
    expect(out[1].prescribed.reps).toBe(10);
  });

  it("feeling=green pushes harder than yellow", () => {
    const green = adaptChain([logged(seed(8, 100), 8, 100, "green"), seed(8, 100)]);
    const yellow = adaptChain([logged(seed(8, 100), 8, 100, "yellow"), seed(8, 100)]);
    expect(green[1].prescribed.weight).toBeGreaterThan(yellow[1].prescribed.weight);
  });

  it("never prescribes below the baseline floor", () => {
    const out = adaptChain([logged(seed(10, 20), 4, 20, "red"), seed(10, 20)], 50);
    expect(out[1].prescribed.weight).toBeGreaterThanOrEqual(50);
  });

  it("editing an earlier set re-flows everything after it", () => {
    const chain = [logged(seed(8, 140), 8, 155, "yellow"), seed(8, 140), seed(8, 140)];
    const out = adaptChain(chain);
    const set2 = out[1].prescribed.weight;
    expect(set2).toBeGreaterThan(140);
    expect(out[1].prescribed.rationale).toMatch(/1RM/);
  });

  it("does not recompute a set whose predecessor has no actual yet", () => {
    const out = adaptChain([seed(8, 140), seed(8, 140)]);
    expect(out[1].prescribed.weight).toBe(140);
  });
});
