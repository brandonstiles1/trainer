import { describe, it, expect } from "vitest";
import { openingTargets, planNextTargets, type LoggedSet } from "@/lib/engine/progression";
import { inferExerciseMeta } from "@/lib/engine/infer-meta";

const range = { min: 8, max: 12 };
const base = { repRange: range, weightIncrement: 5 };

const set = (over: Partial<LoggedSet> = {}): LoggedSet => ({
  targetReps: 8,
  weight: 55,
  reps: 8,
  feel: "medium",
  ...over,
});

describe("planNextTargets — the clean session", () => {
  it("adds a rep when every set hits its target", () => {
    // 55×8, 55×8, 55×8 against a target of 8 — the user's own example.
    const result = planNextTargets({ ...base, lastSets: [set(), set(), set()] });
    expect(result.outcome).toBe("add_rep");
    expect(result.sets).toEqual([
      { weight: 55, targetReps: 9 },
      { weight: 55, targetReps: 9 },
      { weight: 55, targetReps: 9 },
    ]);
  });

  it("holds when a single set comes up short", () => {
    // 55×8, 55×7, 55×7 — the counter-example: no progression.
    const result = planNextTargets({
      ...base,
      lastSets: [set(), set({ reps: 7 }), set({ reps: 7 })],
    });
    expect(result.outcome).toBe("hold_missed");
    expect(result.sets.every((s) => s.weight === 55 && s.targetReps === 8)).toBe(true);
  });

  it("holds on one missed rep in one set", () => {
    const result = planNextTargets({ ...base, lastSets: [set(), set(), set({ reps: 7 })] });
    expect(result.outcome).toBe("hold_missed");
  });

  it("meets overshoot where it landed rather than stepping from the old target", () => {
    const result = planNextTargets({
      ...base,
      lastSets: [set({ reps: 10 }), set({ reps: 10 }), set({ reps: 10 })],
    });
    expect(result.sets[0].targetReps).toBe(11);
  });

  it("takes the lowest set when overshoot is uneven", () => {
    const result = planNextTargets({
      ...base,
      lastSets: [set({ reps: 11 }), set({ reps: 9 }), set({ reps: 10 })],
    });
    expect(result.sets[0].targetReps).toBe(10);
  });
});

describe("planNextTargets — earning the weight", () => {
  it("swaps a rep bump for a weight step at the top of the range", () => {
    const top = set({ targetReps: 12, reps: 12 });
    const result = planNextTargets({ ...base, lastSets: [top, top, top] });
    expect(result.outcome).toBe("add_weight");
    expect(result.sets).toEqual([
      { weight: 60, targetReps: 8 },
      { weight: 60, targetReps: 8 },
      { weight: 60, targetReps: 8 },
    ]);
  });

  it("bumps past the top of the range too", () => {
    const over = set({ targetReps: 12, reps: 15 });
    const result = planNextTargets({ ...base, lastSets: [over, over] });
    expect(result.outcome).toBe("add_weight");
    expect(result.sets[0]).toEqual({ weight: 60, targetReps: 8 });
  });

  it("uses the exercise's own step size", () => {
    const top = set({ targetReps: 12, reps: 12 });
    const result = planNextTargets({ ...base, weightIncrement: 2.5, lastSets: [top] });
    expect(result.sets[0].weight).toBe(57.5);
  });

  it("keeps loads the user actually logged rather than snapping to a grid", () => {
    const odd = set({ targetReps: 12, reps: 12, weight: 52.5 });
    const result = planNextTargets({ ...base, lastSets: [odd] });
    expect(result.sets[0].weight).toBe(57.5);
  });

  it("floors at zero for loaded exercises but lets assisted work go negative", () => {
    const top = set({ targetReps: 12, reps: 12, weight: 0 });
    expect(planNextTargets({ ...base, lastSets: [top] }).sets[0].weight).toBe(5);

    const assisted = set({ targetReps: 12, reps: 12, weight: -20 });
    const result = planNextTargets({ ...base, lastSets: [assisted], allowNegativeWeight: true });
    expect(result.sets[0].weight).toBe(-15);
  });
});

describe("planNextTargets — the feel gate", () => {
  it("holds when reps were hit but two sets were a grind", () => {
    const result = planNextTargets({
      ...base,
      lastSets: [set({ feel: "hard" }), set({ feel: "hard" }), set()],
    });
    expect(result.outcome).toBe("hold_hard");
    expect(result.sets[0].targetReps).toBe(8);
  });

  it("still progresses on a single hard set", () => {
    const result = planNextTargets({
      ...base,
      lastSets: [set(), set(), set({ feel: "hard" })],
    });
    expect(result.outcome).toBe("add_rep");
  });

  it("does not let feel override a missed rep", () => {
    const result = planNextTargets({
      ...base,
      lastSets: [set({ feel: "easy" }), set({ feel: "easy", reps: 6 })],
    });
    expect(result.outcome).toBe("hold_missed");
  });
});

describe("planNextTargets — notes", () => {
  it("suggests a way out once the same target has stuck for three sessions", () => {
    const result = planNextTargets({
      ...base,
      lastSets: [set({ reps: 7 }), set({ reps: 7 })],
      priorHolds: 2,
    });
    expect(result.note).toContain("3 sessions stuck");
    expect(result.note).toContain("50"); // one step below the lightest set
  });

  it("keeps the note plain before then", () => {
    const result = planNextTargets({
      ...base,
      lastSets: [set({ reps: 7 })],
      priorHolds: 1,
    });
    expect(result.note).not.toContain("stuck");
  });

  it("names the new target when it moves", () => {
    const result = planNextTargets({ ...base, lastSets: [set(), set()] });
    expect(result.note).toContain("9");
  });
});

describe("planNextTargets — edges", () => {
  it("refuses to plan from nothing", () => {
    expect(() => planNextTargets({ ...base, lastSets: [] })).toThrow(/openingTargets/);
  });

  it("handles a one-set exercise", () => {
    const result = planNextTargets({ ...base, lastSets: [set()] });
    expect(result.sets).toHaveLength(1);
    expect(result.note).toContain("1 set");
  });

  it("reads mixed targets as the highest one asked for", () => {
    const result = planNextTargets({
      ...base,
      lastSets: [set({ targetReps: 8, reps: 8 }), set({ targetReps: 10, reps: 10 })],
    });
    expect(result.sets.every((s) => s.targetReps === 11)).toBe(true);
  });

  it("carries drop-set loads forward position for position", () => {
    const result = planNextTargets({
      ...base,
      lastSets: [set({ weight: 55 }), set({ weight: 50 }), set({ weight: 45 })],
    });
    expect(result.sets.map((s) => s.weight)).toEqual([55, 50, 45]);
  });
});

describe("openingTargets", () => {
  it("opens at the bottom of the range with no load when there's nothing to go on", () => {
    const result = openingTargets({ meta: inferExerciseMeta("barbell_curl"), setCount: 3 });
    expect(result.sets).toHaveLength(3);
    expect(result.sets[0].weight).toBe(0);
    expect(result.sets[0].targetReps).toBe(inferExerciseMeta("barbell_curl").repRange.min);
    expect(result.note).toContain("First time");
  });

  it("uses a seed load when signup gave us one", () => {
    const result = openingTargets({
      meta: inferExerciseMeta("bench_press"),
      setCount: 3,
      seedWeight: 135,
    });
    expect(result.sets.every((s) => s.weight === 135)).toBe(true);
  });
});

describe("planNextTargets — set count", () => {
  it("pads back up to the planned count when a set was skipped", () => {
    const result = planNextTargets({
      ...base,
      lastSets: [set(), set()],
      plannedSets: 3,
    });
    expect(result.sets).toHaveLength(3);
    expect(result.sets[2]).toEqual({ weight: 55, targetReps: 9 });
  });

  it("ignores a planned count below what was actually logged", () => {
    const result = planNextTargets({ ...base, lastSets: [set(), set(), set()], plannedSets: 1 });
    expect(result.sets).toHaveLength(3);
  });
});
