import { describe, it, expect } from "vitest";
import { applyBranch } from "@/lib/branch";
import type { Prescribed, Actual } from "@/lib/branch";

const branches: Prescribed["branches"] = {
  under: { threshold_reps: 6, next_set: { reps: 8, weight: 175 } },
  on: { next_set: { reps: 8, weight: 185 } },
  over: { threshold_reps: 10, next_set: { reps: 8, weight: 195 } },
};

describe("applyBranch", () => {
  it("picks 'under' when reps are below threshold", () => {
    const actual: Actual = { reps: 5, weight: 185, feeling: "yellow" };
    expect(applyBranch(actual, branches)).toEqual({ reps: 8, weight: 175 });
  });

  it("picks 'over' when reps are above threshold", () => {
    const actual: Actual = { reps: 11, weight: 185, feeling: "yellow" };
    expect(applyBranch(actual, branches)).toEqual({ reps: 8, weight: 195 });
  });

  it("picks 'on' for reps inside the window", () => {
    const actual: Actual = { reps: 8, weight: 185, feeling: "yellow" };
    expect(applyBranch(actual, branches)).toEqual({ reps: 8, weight: 185 });
  });

  it("feeling=red shifts one notch down (on → under)", () => {
    const actual: Actual = { reps: 8, weight: 185, feeling: "red" };
    expect(applyBranch(actual, branches)).toEqual({ reps: 8, weight: 175 });
  });

  it("feeling=red shifts one notch down (over → on)", () => {
    const actual: Actual = { reps: 11, weight: 185, feeling: "red" };
    expect(applyBranch(actual, branches)).toEqual({ reps: 8, weight: 185 });
  });

  it("feeling=red on under stays at under (clamped)", () => {
    const actual: Actual = { reps: 5, weight: 185, feeling: "red" };
    expect(applyBranch(actual, branches)).toEqual({ reps: 8, weight: 175 });
  });

  it("feeling=green shifts one notch up (on → over)", () => {
    const actual: Actual = { reps: 8, weight: 185, feeling: "green" };
    expect(applyBranch(actual, branches)).toEqual({ reps: 8, weight: 195 });
  });

  it("feeling=green on over stays at over (clamped)", () => {
    const actual: Actual = { reps: 11, weight: 185, feeling: "green" };
    expect(applyBranch(actual, branches)).toEqual({ reps: 8, weight: 195 });
  });

  it("threshold is inclusive on 'under' (reps == threshold_reps is NOT under)", () => {
    const actual: Actual = { reps: 6, weight: 185, feeling: "yellow" };
    expect(applyBranch(actual, branches)).toEqual({ reps: 8, weight: 185 });
  });

  it("threshold is inclusive on 'over' (reps == threshold_reps is NOT over)", () => {
    const actual: Actual = { reps: 10, weight: 185, feeling: "yellow" };
    expect(applyBranch(actual, branches)).toEqual({ reps: 8, weight: 185 });
  });
});
