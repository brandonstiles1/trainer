import { describe, it, expect } from "vitest";
import { planNextSession, type SessionSetLog } from "@/lib/engine/next-workout";
import type { ExerciseMeta } from "@/lib/engine/exercise-meta";
import type { Feel } from "@/lib/engine/config";

const compound: ExerciseMeta = {
  type: "barbell",
  isCompound: true,
  muscleGroups: ["chest"],
  weightIncrement: 5,
  repRange: { min: 6, max: 10 },
  restSeconds: 150,
};

const sets = (
  count: number,
  weight: number,
  reps: number,
  feel: Feel,
  prescribedReps = reps,
): SessionSetLog[] =>
  Array.from({ length: count }, () => ({ prescribedReps, weight, reps, feel }));

describe("scenario 5: next-workout outcome classes", () => {
  it("(a) all sets at top of range with RIR ≥ 2 → +2.5–5% load, reset to bottom of range", () => {
    const next = planNextSession({
      meta: compound,
      lastSets: sets(3, 100, 10, "medium"),
      e1rmHistory: [140],
    });
    expect(next.outcome).toBe("increase_load");
    expect(next.sets).toEqual(
      Array.from({ length: 3 }, () => ({ weight: 105, targetReps: 6, targetRir: 2 })),
    );
  });

  it("(a) increase is always at least one physical increment", () => {
    const dumbbell: ExerciseMeta = { ...compound, type: "dumbbell", isCompound: false, repRange: { min: 10, max: 15 } };
    const next = planNextSession({
      meta: dumbbell,
      lastSets: sets(3, 15, 15, "easy"),
      e1rmHistory: [25],
    });
    expect(next.outcome).toBe("increase_load");
    expect(next.sets[0].weight).toBe(20); // 2.5% of 15 rounds to nothing — bump a full step
  });

  it("(b) targets hit mid-range → same load, +1 rep per set", () => {
    const next = planNextSession({
      meta: compound,
      lastSets: sets(3, 100, 8, "medium"),
      e1rmHistory: [140],
    });
    expect(next.outcome).toBe("add_rep");
    expect(next.sets[0]).toEqual({ weight: 100, targetReps: 9, targetRir: 2 });
  });

  it("(c) targets hit but RIR ≤ 1 on most sets → repeat identical prescription", () => {
    const next = planNextSession({
      meta: compound,
      lastSets: sets(3, 100, 8, "hard"),
      e1rmHistory: [140],
    });
    expect(next.outcome).toBe("consolidate");
    expect(next.sets[0]).toEqual({ weight: 100, targetReps: 8, targetRir: 2 });
  });

  it("(d) missed reps on 2+ sets → same reps at −5% load", () => {
    const lastSets: SessionSetLog[] = [
      { prescribedReps: 8, weight: 100, reps: 8, feel: "hard" },
      { prescribedReps: 8, weight: 100, reps: 6, feel: "hard" },
      { prescribedReps: 8, weight: 100, reps: 5, feel: "hard" },
    ];
    const next = planNextSession({ meta: compound, lastSets, e1rmHistory: [140] });
    expect(next.outcome).toBe("back_off");
    expect(next.sets[0]).toEqual({ weight: 95, targetReps: 8, targetRir: 2 });
  });

  it("(d) on a readiness-flagged day → plain repeat instead of backing off", () => {
    const lastSets: SessionSetLog[] = [
      { prescribedReps: 8, weight: 100, reps: 6, feel: "hard" },
      { prescribedReps: 8, weight: 100, reps: 5, feel: "hard" },
    ];
    const next = planNextSession({
      meta: compound,
      lastSets,
      e1rmHistory: [140],
      readinessFlagged: true,
    });
    expect(next.outcome).toBe("repeat");
    expect(next.sets[0]).toEqual({ weight: 100, targetReps: 8, targetRir: 2 });
  });

  it("(e) e1RM flat across 3 sessions → rotate the rep range", () => {
    const next = planNextSession({
      meta: compound,
      lastSets: sets(3, 100, 8, "medium"),
      e1rmHistory: [150, 150.5, 149.8],
    });
    expect(next.outcome).toBe("stall_breaker");
    expect(next.repRange).toEqual({ min: 10, max: 12 });
    // 149.8 / (1 + 12/30) ≈ 107 → 105 at the new 10-rep target.
    expect(next.sets[0]).toEqual({ weight: 105, targetReps: 10, targetRir: 2 });
  });

  it("(e) rotates back down when already in the high range", () => {
    const highRange: ExerciseMeta = { ...compound, repRange: { min: 10, max: 12 } };
    const next = planNextSession({
      meta: highRange,
      lastSets: sets(3, 100, 10, "medium"),
      e1rmHistory: [150, 150.2, 149.9],
    });
    expect(next.repRange).toEqual({ min: 6, max: 8 });
  });

  it("(f) e1RM declining 2 consecutive sessions → deload with same loads, half the sets", () => {
    const next = planNextSession({
      meta: compound,
      lastSets: sets(4, 100, 8, "hard"),
      e1rmHistory: [150, 145, 140],
    });
    expect(next.outcome).toBe("deload");
    expect(next.isDeload).toBe(true);
    expect(next.sets).toHaveLength(2);
    expect(next.sets[0]).toEqual({ weight: 100, targetReps: 8, targetRir: 2 });
  });

  it("one noisy dip does not trigger a deload", () => {
    const next = planNextSession({
      meta: compound,
      lastSets: sets(3, 100, 8, "medium"),
      e1rmHistory: [150, 145, 146],
    });
    expect(next.outcome).not.toBe("deload");
  });
});

describe("bodyweight progression is rep-based", () => {
  const pullup: ExerciseMeta = {
    type: "bodyweight",
    isCompound: true,
    muscleGroups: ["back"],
    weightIncrement: 5,
    repRange: { min: 6, max: 10 },
    restSeconds: 150,
  };

  it(">12 reps on every set → add weight", () => {
    const next = planNextSession({
      meta: pullup,
      lastSets: sets(3, 0, 13, "medium", 10),
      e1rmHistory: [230],
      bodyweightLbs: 180,
    });
    expect(next.outcome).toBe("add_bodyweight_load");
    expect(next.sets[0]).toEqual({ weight: 5, targetReps: 6, targetRir: 2 });
  });

  it("<6 reps on 2+ sets → add assistance", () => {
    const lastSets: SessionSetLog[] = [
      { prescribedReps: 8, weight: 0, reps: 5, feel: "hard" },
      { prescribedReps: 8, weight: 0, reps: 4, feel: "hard" },
      { prescribedReps: 8, weight: 0, reps: 8, feel: "hard" },
    ];
    const next = planNextSession({
      meta: pullup,
      lastSets,
      e1rmHistory: [200],
      bodyweightLbs: 180,
    });
    expect(next.outcome).toBe("add_assistance");
    expect(next.sets[0].weight).toBe(-5);
  });
});
