import { describe, it, expect } from "vitest";
import { prescribeExercise, type PrescribeExerciseInput } from "@/lib/workouts/prescribe-exercise";
import type { SessionSetLog } from "@/lib/engine/next-workout";

const base = (over: Partial<PrescribeExerciseInput> = {}): PrescribeExerciseInput => ({
  name: "bench_press",
  baselineE1rm: 500 / 3, // 125×8 @ RIR 2
  lastSession: null,
  e1rmHistory: [],
  weeklyHardSetsForGroup: 10,
  consecutiveEasySessions: 0,
  ...over,
});

const logs = (count: number, weight: number, reps: number, feel: SessionSetLog["feel"], prescribedReps = reps): SessionSetLog[] =>
  Array.from({ length: count }, () => ({ prescribedReps, weight, reps, feel }));

describe("prescribeExercise", () => {
  it("no history but a baseline → conservative probe sets", () => {
    const rows = prescribeExercise(base());
    expect(rows).toHaveLength(3);
    // Compound mid-range 8 reps @ RIR 2, ×0.95 probe: 166.7×0.95/1.333 ≈ 119 → 120.
    expect(rows[0].prescribed).toMatchObject({ reps: 8, weight: 120 });
    expect(rows[0].prescribed.calibration).toBeUndefined();
  });

  it("no baseline at all → calibration ramp with AMRAP, flagged", () => {
    const rows = prescribeExercise(base({ name: "machine_curl", baselineE1rm: null }));
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.prescribed.calibration)).toBe(true);
    expect(rows[0].prescribed).toMatchObject({ weight: 30, reps: 10 }); // machine start
    expect(rows[2].prescribed.amrap).toBe(true);
  });

  it("progresses from the last session via outcome classification", () => {
    const rows = prescribeExercise(
      base({ lastSession: { sets: logs(3, 100, 10, "medium"), wasDeload: false }, e1rmHistory: [140] }),
    );
    // (a): top of range, RIR ≥ 2 → +load, reset to bottom of range.
    expect(rows.every((r) => r.prescribed.weight === 105 && r.prescribed.reps === 6)).toBe(true);
    expect(rows[0].prescribed.rationale).toBeTruthy();
  });

  it("declining e1RM produces a deload-flagged half-session", () => {
    const rows = prescribeExercise(
      base({
        lastSession: { sets: logs(4, 100, 8, "hard"), wasDeload: false },
        e1rmHistory: [150, 145, 140],
      }),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.prescribed.deload && r.prescribed.weight === 100)).toBe(true);
  });

  it("a deloaded last session resets to base probe sets", () => {
    const rows = prescribeExercise(
      base({ lastSession: { sets: logs(2, 100, 8, "easy"), wasDeload: true } }),
    );
    expect(rows).toHaveLength(3); // back to base volume
    expect(rows.every((r) => !r.prescribed.deload)).toBe(true);
  });

  it("two easy sessions under the weekly cap add a set; at the cap they don't", () => {
    const session = { sets: logs(3, 100, 8, "medium"), wasDeload: false };
    const added = prescribeExercise(
      base({ lastSession: session, e1rmHistory: [140], consecutiveEasySessions: 2, weeklyHardSetsForGroup: 12 }),
    );
    expect(added).toHaveLength(4);
    const capped = prescribeExercise(
      base({ lastSession: session, e1rmHistory: [140], consecutiveEasySessions: 2, weeklyHardSetsForGroup: 20 }),
    );
    expect(capped).toHaveLength(3);
  });
});
