import { describe, it, expect } from "vitest";
import {
  autoregulate,
  type CompletedSet,
  type ExercisePlan,
  type PlannedSet,
} from "@/lib/engine/autoregulate";
import type { ExerciseMeta } from "@/lib/engine/exercise-meta";

const meta = (over: Partial<ExerciseMeta> = {}): ExerciseMeta => ({
  type: "barbell",
  isCompound: true,
  muscleGroups: ["chest"],
  weightIncrement: 5,
  repRange: { min: 6, max: 10 },
  restSeconds: 150,
  ...over,
});

const set = (targetReps: number, targetRir = 2): PlannedSet => ({ targetReps, targetRir });

const plan = (
  name: string,
  baselineE1rm: number | null,
  sets: PlannedSet[],
  m: ExerciseMeta = meta(),
): ExercisePlan => ({ name, meta: m, sets, baselineE1rm });

const log = (
  exerciseName: string,
  setNumber: number,
  weight: number,
  reps: number,
  feel: CompletedSet["feel"],
): CompletedSet => ({ exerciseName, setNumber, weight, reps, feel });

describe("scenario 1: over-performance jumps the remaining sets and tapers with fatigue", () => {
  // Plan built off a 125×8@RIR2 baseline: e1RM = 125 × (1 + 10/30) ≈ 166.7.
  const bench = plan("bench_press", 500 / 3, [set(8), set(8), set(6), set(6)]);
  const res = autoregulate({ exercises: [bench] }, [log("bench_press", 1, 125, 12, "medium")]);

  it("prescribes all three remaining sets", () => {
    expect(res.prescriptions.map((p) => p.setNumber)).toEqual([2, 3, 4]);
  });

  it("jumps set 2 to ~140×8 off the ~185 implied max", () => {
    // 125×12 @ medium (RIR 2.5) → e1RM = 125 × (1 + 14.5/30) ≈ 185.4
    const p2 = res.prescriptions[0];
    expect(p2.weight).toBe(140);
    expect(p2.reps).toBe(8);
    expect(p2.reason).toMatch(/~185 max/);
  });

  it("tapers later sets with fatigue", () => {
    const [p2, p3, p4] = res.prescriptions;
    expect(p3.weight).toBeLessThanOrEqual(p2.weight);
    expect(p4.weight).toBeLessThan(p2.weight);
    expect([p3.reps, p4.reps]).toEqual([6, 6]);
  });

  it("treats the jump as recalibration: baseline is not persisted yet", () => {
    const state = res.exercises[0];
    expect(state.recalibration).toMatchObject({ confirmed: false });
    expect(state.recalibration?.candidateE1rm).toBeCloseTo(185.42, 1);
    expect(state.persistE1rm).toBeCloseTo(500 / 3, 5);
  });
});

describe("small over-performance blends instead of recalibrating", () => {
  it("EMA keeps the prescription near the plan", () => {
    const bench = plan("bench_press", 500 / 3, [set(8), set(8)]);
    const res = autoregulate({ exercises: [bench] }, [log("bench_press", 1, 125, 9, "medium")]);
    expect(res.exercises[0].recalibration).toBeNull();
    expect(res.prescriptions[0].weight).toBe(125);
  });
});

describe("scenario 2: recalibration replaces the baseline and requires confirmation", () => {
  const row = () =>
    plan("seated_row", 42, [set(10), set(8), set(8)], meta({ type: "machine", muscleGroups: ["back"], weightIncrement: 5 }));
  const wild = log("seated_row", 1, 80, 10, "easy"); // implied e1RM = 80 × (1 + 14/30) ≈ 117.3

  it("prescribes an unclamped confirmation set straight from the new e1RM at RIR 2", () => {
    const res = autoregulate({ exercises: [row()] }, [wild]);
    const confirm = res.prescriptions[0];
    // Way beyond the ±15% clamp (30 × 1.15 ≈ 34.5) — recalibration is exempt.
    expect(confirm.weight).toBeGreaterThanOrEqual(80);
    expect(confirm.reps).toBe(8);
    expect(confirm.reason).toMatch(/~117 max/);
    expect(confirm.reason).toMatch(/confirm/i);
  });

  it("interprets the logged set at full value — never clamped", () => {
    const res = autoregulate({ exercises: [row()] }, [wild]);
    expect(res.exercises[0].recalibration?.candidateE1rm).toBeCloseTo(117.33, 1);
  });

  it("keeps the old baseline until a medium/hard set confirms", () => {
    const res = autoregulate({ exercises: [row()] }, [wild]);
    expect(res.exercises[0].persistE1rm).toBe(42);
  });

  it("replaces (not blends) the baseline once confirmed", () => {
    const res = autoregulate({ exercises: [row()] }, [wild, log("seated_row", 2, 85, 8, "medium")]);
    const state = res.exercises[0];
    expect(state.recalibration?.confirmed).toBe(true);
    // EMA of candidate 117.3 and confirmation 114.75 — nowhere near the stale 42.
    expect(state.persistE1rm).toBeGreaterThan(110);
  });

  it("repeats recalibration if the confirmation set is easy again", () => {
    const res = autoregulate({ exercises: [row()] }, [wild, log("seated_row", 2, 85, 12, "easy")]);
    const state = res.exercises[0];
    expect(state.recalibration).toMatchObject({ confirmed: false });
    expect(state.recalibration?.candidateE1rm).toBeCloseTo(130.33, 1);
    expect(state.persistE1rm).toBe(42);
    expect(res.prescriptions[0].reason).toMatch(/confirm/i);
  });
});

describe("scenario 3: hard underperformance sets a readiness multiplier, baseline barely moves", () => {
  const squat = plan("back_squat", 400 / 3, [set(8), set(8), set(8)], meta({ muscleGroups: ["legs"] }));
  const ohp = plan("overhead_press", 100, [set(8), set(8)], meta({ muscleGroups: ["shoulders"] }));
  const bad = log("back_squat", 1, 70, 5, "hard"); // implied ≈ 82.8 vs expected ≈ 133.3 → −38%

  it("flags the session with a 0.90 readiness multiplier", () => {
    const res = autoregulate({ exercises: [squat, ohp] }, [bad]);
    expect(res.readinessMultiplier).toBe(0.9);
    expect(res.exercises[0].readinessFlagged).toBe(true);
  });

  it("scales the rest of the session down, including later exercises", () => {
    const flagged = autoregulate({ exercises: [squat, ohp] }, [bad]);
    const control = autoregulate({ exercises: [ohp] }, []);
    const ohpFlagged = flagged.prescriptions.find(
      (p) => p.exerciseName === "overhead_press" && p.setNumber === 1,
    )!;
    const ohpControl = control.prescriptions[0];
    expect(ohpFlagged.weight).toBeLessThan(ohpControl.weight);
    expect(ohpControl.weight).toBe(70); // 100 × 0.95 / (1 + 10/30) ≈ 71 → 70
    expect(ohpFlagged.weight).toBe(65); // ×0.90 readiness on top
  });

  it("applies only minor decay to the stored baseline", () => {
    const res = autoregulate({ exercises: [squat, ohp] }, [bad]);
    const persisted = res.exercises[0].persistE1rm!;
    expect(persisted).toBeCloseTo((400 / 3) * 0.98, 2);
    expect(persisted).toBeGreaterThan((400 / 3) * 0.95);
  });
});

describe("scenario 7: clamping applies to prescriptions, never to logged data", () => {
  it("caps a prescription's set-to-set weight change at ±15%", () => {
    // Big planned rep drop (12 → 5) would otherwise jump the weight ~17%.
    const fly = plan(
      "cable_fly",
      86,
      [set(12), set(5)],
      meta({ isCompound: false, repRange: { min: 5, max: 15 }, muscleGroups: ["chest"] }),
    );
    const res = autoregulate({ exercises: [fly] }, [log("cable_fly", 1, 60, 12, "medium")]);
    const p2 = res.prescriptions[0];
    expect(p2.weight).toBeLessThanOrEqual(60 * 1.15);
    expect(p2.reps).toBe(5);
  });

  it("clamps prescribed reps into the exercise's rep range", () => {
    const curl = plan(
      "db_curl",
      60,
      [set(20)],
      meta({ type: "dumbbell", isCompound: false, repRange: { min: 10, max: 15 }, muscleGroups: ["biceps"] }),
    );
    const res = autoregulate({ exercises: [curl] }, []);
    expect(res.prescriptions[0].reps).toBe(15);
  });
});

describe("fatigue carryover between exercises sharing a muscle group", () => {
  it("discounts a later exercise when an earlier one hit the same muscle", () => {
    const bench = plan("bench_press", 500 / 3, [set(8)]);
    const incline = plan("incline_press", 120, [set(8), set(8)]);
    const withCarry = autoregulate(
      { exercises: [bench, incline] },
      [log("bench_press", 1, 125, 8, "medium")],
    );
    const fresh = autoregulate({ exercises: [incline] }, []);
    const carried = withCarry.prescriptions.find((p) => p.exerciseName === "incline_press")!;
    expect(carried.weight).toBeLessThan(fresh.prescriptions[0].weight);
  });

  it("does not discount when muscle groups differ", () => {
    const bench = plan("bench_press", 500 / 3, [set(8)]);
    const rdl = plan("rdl", 120, [set(8)], meta({ muscleGroups: ["hamstrings"] }));
    const both = autoregulate({ exercises: [bench, rdl] }, [log("bench_press", 1, 125, 8, "medium")]);
    const alone = autoregulate({ exercises: [rdl] }, []);
    expect(both.prescriptions.find((p) => p.exerciseName === "rdl")!.weight).toBe(
      alone.prescriptions[0].weight,
    );
  });
});

describe("set-1 readiness probe", () => {
  it("prescribes the opening set slightly conservative", () => {
    const bench = plan("bench_press", 500 / 3, [set(8)]);
    const res = autoregulate({ exercises: [bench] }, []);
    // Unadjusted: 166.7 / (1 + 10/30) = 125; probe factor 0.95 → ~119 → 120.
    expect(res.prescriptions[0].weight).toBe(120);
    expect(res.prescriptions[0].reason).toMatch(/conservative/i);
  });

  it("an easy probe pushes the rest of the exercise up vs a medium probe", () => {
    const mk = () => plan("bench_press", 500 / 3, [set(8), set(8)]);
    const easy = autoregulate({ exercises: [mk()] }, [log("bench_press", 1, 120, 8, "easy")]);
    const medium = autoregulate({ exercises: [mk()] }, [log("bench_press", 1, 120, 8, "medium")]);
    expect(easy.prescriptions[0].weight).toBeGreaterThan(medium.prescriptions[0].weight);
  });
});

describe("bodyweight exercises", () => {
  it("runs e1RM math on bodyweight + added load and can prescribe assistance", () => {
    const pullup: ExercisePlan = {
      name: "pull_up",
      meta: meta({ type: "bodyweight", muscleGroups: ["back"] }),
      sets: [set(8)],
      baselineE1rm: 240,
      bodyweightLbs: 180,
    };
    const res = autoregulate({ exercises: [pullup] }, []);
    // 240 × 0.95 / (1 + 10/30) = 171 total → added = 171 − 180 ≈ −10 (assisted).
    expect(res.prescriptions[0].weight).toBe(-10);
  });
});
