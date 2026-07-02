import { describe, it, expect } from "vitest";
import {
  autoregulate,
  type CompletedSet,
  type ExercisePlan,
} from "@/lib/engine/autoregulate";
import type { ExerciseMeta } from "@/lib/engine/exercise-meta";

const machineMeta: ExerciseMeta = {
  type: "machine",
  isCompound: false,
  muscleGroups: ["biceps"],
  weightIncrement: 5,
  repRange: { min: 10, max: 15 },
  restSeconds: 75,
};

const curl = (setCount = 3): ExercisePlan => ({
  name: "machine_curl",
  meta: machineMeta,
  sets: Array.from({ length: setCount }, () => ({ targetReps: 12, targetRir: 2 })),
  baselineE1rm: null,
});

const log = (
  setNumber: number,
  weight: number,
  reps: number,
  feel: CompletedSet["feel"],
): CompletedSet => ({ exerciseName: "machine_curl", setNumber, weight, reps, feel });

describe("scenario 4: no-baseline calibration ramp", () => {
  it("prescribes light×10, +20%×8, then an AMRAP", () => {
    const res = autoregulate({ exercises: [curl()] }, []);
    const [s1, s2, s3] = res.prescriptions;
    expect(s1).toMatchObject({ setNumber: 1, weight: 30, reps: 10 }); // machine start weight
    expect(s1.reason).toMatch(/no baseline/i);
    expect(s2).toMatchObject({ setNumber: 2, weight: 35, reps: 8 }); // 30 × 1.2 → 35
    expect(s3.amrap).toBe(true);
    expect(s3.reason).toMatch(/AMRAP/);
    expect(res.exercises[0].persistE1rm).toBeNull(); // nothing to persist yet
  });

  it("ramps set 2 off the actually-logged set 1 weight", () => {
    const res = autoregulate({ exercises: [curl()] }, [log(1, 40, 10, "easy")]);
    expect(res.prescriptions[0]).toMatchObject({ setNumber: 2, weight: 50, reps: 8 }); // 40 × 1.2 → 50
  });

  it("prescribes the AMRAP at ~70% of the estimated max from set 2", () => {
    const res = autoregulate({ exercises: [curl()] }, [
      log(1, 30, 10, "easy"),
      log(2, 40, 8, "medium"),
    ]);
    // est e1RM = 40 × (1 + 10.5/30) = 54 → AMRAP at 0.7 × 54 ≈ 38 → 40.
    const amrap = res.prescriptions[0];
    expect(amrap.setNumber).toBe(3);
    expect(amrap.weight).toBe(40);
    expect(amrap.amrap).toBe(true);
  });

  it("seeds the baseline from the AMRAP set", () => {
    const res = autoregulate({ exercises: [curl()] }, [
      log(1, 30, 10, "easy"),
      log(2, 40, 8, "medium"),
      log(3, 40, 12, "hard"),
    ]);
    // AMRAP → RIR 0: e1RM = 40 × (1 + 12/30) = 56.
    expect(res.exercises[0].sessionE1rm).toBeCloseTo(56, 5);
    expect(res.exercises[0].persistE1rm).toBeCloseTo(56, 5);
    expect(res.prescriptions).toHaveLength(0);
  });

  it("prescribes planned sets beyond the ramp from the seeded e1RM", () => {
    const res = autoregulate({ exercises: [curl(4)] }, [
      log(1, 30, 10, "easy"),
      log(2, 40, 8, "medium"),
      log(3, 40, 12, "hard"),
    ]);
    const p4 = res.prescriptions[0];
    expect(p4.setNumber).toBe(4);
    expect(p4.reps).toBe(12);
    // Seed 56 with ramp fatigue → ~53 working; 12 reps @ RIR 2 → ~36 → 35.
    expect(p4.weight).toBe(35);
  });
});
