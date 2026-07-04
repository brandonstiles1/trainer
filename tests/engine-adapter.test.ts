import { describe, it, expect } from "vitest";
import {
  recomputeWorkoutRows,
  type StoredPrescribed,
  type WorkoutRow,
} from "@/lib/workouts/engine-adapter";
import type { Feeling } from "@/lib/adapt";

let nextId = 0;
const row = (
  exerciseName: string,
  setNumber: number,
  prescribed: Partial<StoredPrescribed> & { reps: number; weight: number },
  actual: { reps: number; weight: number; feeling: Feeling } | null = null,
  resolved = actual !== null,
): WorkoutRow => ({
  id: `s${nextId++}`,
  exerciseName,
  setNumber,
  prescribed: { targetReps: prescribed.reps, ...prescribed },
  actual,
  resolved,
});

describe("the real cable-fly session: hard failure now cuts the load (no pinned floor)", () => {
  // Pinned 40×12 → baseline e1RM = 40 × (1 + 12/30) = 56.
  // Set 1 logged 3×40 hard → implied ≈ 44.7, a ~20% miss.
  const rows = [
    row("cable_chest_fly", 1, { reps: 12, weight: 40 }, { reps: 3, weight: 40, feeling: "red" }),
    row("cable_chest_fly", 2, { reps: 12, weight: 40 }),
    row("cable_chest_fly", 3, { reps: 12, weight: 40 }),
  ];
  const result = recomputeWorkoutRows({
    rows,
    exerciseOrder: ["cable_chest_fly"],
    baselines: { cable_chest_fly: 56 },
  });

  it("drops the remaining sets instead of repeating 40", () => {
    const [set2, set3] = result.changed;
    expect(set2.prescribed.weight).toBe(35); // clamped to −15% of the logged 40
    expect(set3.prescribed.weight).toBe(30);
    // The clamp holds the load above the ideal cut, so reps trim to the
    // rep-range floor to keep the set near the RIR target.
    expect(set2.prescribed.reps).toBe(10);
  });

  it("flags readiness and barely moves the baseline", () => {
    expect(result.readinessMultiplier).toBe(0.95);
    const state = result.states[0];
    expect(state.readinessFlagged).toBe(true);
    expect(state.persistE1rm).toBeCloseTo(56 * 0.98, 2);
  });
});

describe("the real lateral-raise session: big over-performance recalibrates", () => {
  // No stored estimate → baseline derives from set 1's prescription:
  // 12.5 × (1 + 14/30) ≈ 18.3. Logged 20×12.5 medium implies ≈ 21.9 → +19%.
  const rows = [
    row("lateral_raise", 1, { reps: 12, weight: 12.5 }, { reps: 20, weight: 12.5, feeling: "yellow" }),
    row("lateral_raise", 2, { reps: 12, weight: 12.5 }),
    row("lateral_raise", 3, { reps: 12, weight: 12.5 }),
  ];
  const result = recomputeWorkoutRows({ rows, exerciseOrder: ["lateral_raise"], baselines: {} });

  it("prescribes an unclamped confirmation set from the new e1RM", () => {
    const [set2] = result.changed;
    expect(set2.prescribed.weight).toBe(15); // > 12.5 × 1.15 — clamp doesn't apply
    expect(set2.prescribed.reps).toBe(12);
    expect(set2.prescribed.rationale).toMatch(/confirm/i);
  });

  it("holds the candidate e1RM from the raw logged set", () => {
    expect(result.states[0].recalibration).toMatchObject({ confirmed: false });
    expect(result.states[0].recalibration?.candidateE1rm).toBeCloseTo(21.88, 1);
  });
});

describe("skipped sets", () => {
  it("are excluded from the engine's view and never re-prescribed", () => {
    const rows = [
      row("bench_press", 1, { reps: 8, weight: 75 }, null, true), // skipped
      row("bench_press", 2, { reps: 8, weight: 75 }, { reps: 8, weight: 75, feeling: "yellow" }),
      row("bench_press", 3, { reps: 8, weight: 75 }),
    ];
    const result = recomputeWorkoutRows({
      rows,
      exerciseOrder: ["bench_press"],
      baselines: { bench_press: 100 },
    });
    const changedIds = result.changed.map((c) => c.id);
    expect(changedIds).not.toContain(rows[0].id);
    expect(changedIds).toContain(rows[2].id);
    // One completed set of fatigue, working e1RM ≈ 100.5 → 75 again.
    expect(result.changed.find((c) => c.id === rows[2].id)!.prescribed.weight).toBe(75);
  });
});

describe("cross-exercise effects", () => {
  it("a hard miss scales a later exercise down too", () => {
    const rows = [
      row("back_squat", 1, { reps: 8, weight: 100 }, { reps: 3, weight: 70, feeling: "red" }),
      row("back_squat", 2, { reps: 8, weight: 100 }),
      row("overhead_press", 1, { reps: 8, weight: 70 }),
    ];
    const scaled = recomputeWorkoutRows({
      rows,
      exerciseOrder: ["back_squat", "overhead_press"],
      baselines: { back_squat: 400 / 3, overhead_press: 100 },
    });
    const ohp = scaled.changed.find(
      (c) => c.id === rows[2].id,
    )!;
    expect(ohp.prescribed.weight).toBeLessThan(70);
  });
});

describe("calibration-flagged exercises", () => {
  it("run the ramp even though set 1 has a weight", () => {
    const rows = [
      row("machine_curl", 1, { reps: 10, weight: 30, calibration: true }),
      row("machine_curl", 2, { reps: 8, weight: 35, calibration: true }),
      row("machine_curl", 3, { reps: 12, weight: 35, calibration: true, amrap: true }),
    ];
    const result = recomputeWorkoutRows({ rows, exerciseOrder: ["machine_curl"], baselines: {} });
    expect(result.states[0].sessionE1rm).toBeNull(); // still calibrating
    const amrap = result.changed.find((c) => c.id === rows[2].id);
    if (amrap) expect(amrap.prescribed.amrap).toBe(true);
  });
});

describe("minimal diff contract", () => {
  it("returns only rows whose prescription actually changed", () => {
    // Logged exactly on target with medium feel → set 2 recomputes to the same
    // numbers but gains a rationale, set 3 likewise; nothing else.
    const rows = [
      row("bench_press", 1, { reps: 8, weight: 75 }, { reps: 8, weight: 75, feeling: "yellow" }),
      row("bench_press", 2, { reps: 8, weight: 75 }),
    ];
    const result = recomputeWorkoutRows({
      rows,
      exerciseOrder: ["bench_press"],
      baselines: { bench_press: 100 },
    });
    expect(result.changed.every((c) => c.id === rows[1].id)).toBe(true);
  });
});

describe("per-exercise increment override", () => {
  it("rounds prescriptions to the overridden step and trims reps when forced up", () => {
    const rows = [
      row("machine_chest_press", 1, { reps: 10, weight: 65 }, { reps: 10, weight: 65, feeling: "yellow" }),
      row("machine_chest_press", 2, { reps: 10, weight: 65 }),
    ];
    const withDefault = recomputeWorkoutRows({
      rows,
      exerciseOrder: ["machine_chest_press"],
      baselines: { machine_chest_press: 95 },
    });
    const withTens = recomputeWorkoutRows({
      rows,
      exerciseOrder: ["machine_chest_press"],
      baselines: { machine_chest_press: 95 },
      increments: { machine_chest_press: 10 },
    });
    for (const c of withTens.changed) {
      expect(c.prescribed.weight % 10).toBe(0);
    }
    // When the coarser step lands the load above the finer prescription, the
    // reps come down to compensate — never a strictly harder set.
    const fine = withDefault.changed[0];
    const coarse = withTens.changed[0];
    if (fine && coarse && coarse.prescribed.weight > fine.prescribed.weight) {
      expect(coarse.prescribed.reps).toBeLessThanOrEqual(fine.prescribed.reps);
    }
  });
});

describe("rep compensation at light weights", () => {
  it("a hard isolation set at a weight too light to step down trims the next set's reps", () => {
    // 15 lb curls: a 3–5% cut is under one 5 lb plate step, so the weight
    // rounds back to 15 — the reps must absorb the adjustment instead.
    const baseline = 15 * (1 + 14 / 30); // 12 reps at RIR 2 exactly on target
    const rows = [
      row("dumbbell_curl", 1, { reps: 12, weight: 15 }, { reps: 12, weight: 15, feeling: "red" }),
      row("dumbbell_curl", 2, { reps: 12, weight: 15 }),
    ];
    const result = recomputeWorkoutRows({
      rows,
      exerciseOrder: ["dumbbell_curl"],
      baselines: { dumbbell_curl: baseline },
    });
    const set2 = result.changed.find((c) => c.id === rows[1].id);
    expect(set2).toBeDefined();
    expect(set2!.prescribed.reps).toBeLessThan(12);
  });
});
