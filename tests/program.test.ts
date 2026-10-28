import { describe, it, expect } from "vitest";
import { DEFAULT_PROGRAM } from "@/lib/program/default-program";
import {
  estimateMinutes,
  metaFor,
  nextRotationDay,
  normalizeProgram,
} from "@/lib/program/structure";
import { DEFAULT_SETTINGS, incrementFor, parseSettings } from "@/lib/program/settings";
import { parseProgram } from "@/lib/program/validate";
import { prescribe, setRowsFor } from "@/lib/workouts/prescribe";
import type { ExerciseSession } from "@/lib/workouts/exercise-history";

const NOW = new Date("2026-10-27T12:00:00Z");

describe("rotation", () => {
  it("runs A → B → C → D → A", () => {
    const order = ["upper_width", "legs_abs", "chest_shoulders_traps", "back_arms_legs"];
    expect(nextRotationDay(DEFAULT_PROGRAM, null)?.day).toBe("A");
    expect(order.map((c) => nextRotationDay(DEFAULT_PROGRAM, c)?.day)).toEqual(["B", "C", "D", "A"]);
  });

  it("an unknown last workout (old plan, custom) starts at A", () => {
    expect(nextRotationDay(DEFAULT_PROGRAM, "push")?.day).toBe("A");
  });

  it("each workout is about 40 minutes", () => {
    for (const day of DEFAULT_PROGRAM.days) {
      const min = estimateMinutes(day.exercises, DEFAULT_SETTINGS);
      expect(min).toBeGreaterThanOrEqual(35);
      expect(min).toBeLessThanOrEqual(45);
    }
  });
});

describe("normalizeProgram", () => {
  it("reads an old weekday plan as a rotation with default sets and ranges", () => {
    const p = normalizeProgram({
      split: "ppl",
      days: [
        { day: "monday", category: "push", exercises: [{ name: "bench_press", order: 1 }] },
        { day: "wednesday", category: "pull", exercises: [{ name: "lateral_raise", order: 1 }] },
      ],
    });
    expect(p.days.map((d) => d.day)).toEqual(["A", "B"]);
    expect(p.days[0].exercises[0]).toMatchObject({ sets: 3, repMin: 8, repMax: 10 });
    expect(p.days[1].exercises[0]).toMatchObject({ repMin: 10, repMax: 15 });
  });

  it("leaves a v2 program as it is", () => {
    expect(normalizeProgram(DEFAULT_PROGRAM)).toEqual(DEFAULT_PROGRAM);
  });
});

describe("increments", () => {
  const ex = (name: string) =>
    DEFAULT_PROGRAM.days.flatMap((d) => d.exercises).find((e) => e.name === name)!;

  it("dumbbells step per dumbbell", () => {
    expect(incrementFor(metaFor(ex("incline_dumbbell_press")), DEFAULT_SETTINGS)).toBe(5);
  });

  it("lower-body barbell compounds step 10, upper 5", () => {
    expect(incrementFor(metaFor(ex("barbell_squat")), DEFAULT_SETTINGS)).toBe(10);
    expect(incrementFor(metaFor({ name: "barbell_bench_press" }), DEFAULT_SETTINGS)).toBe(5);
  });

  it("isolation machines take the smallest step", () => {
    expect(incrementFor(metaFor(ex("leg_curl")), DEFAULT_SETTINGS)).toBe(5);
  });

  it("a per-exercise override wins", () => {
    expect(incrementFor(metaFor(ex("cable_lateral_raise")), DEFAULT_SETTINGS, 2.5)).toBe(2.5);
  });

  it("settings clamp bad values and keep good ones", () => {
    expect(parseSettings({ dumbbellStep: 2.5, successSessions: 99, restTimer: "no" })).toMatchObject({
      dumbbellStep: 2.5,
      successSessions: 5,
      restTimer: true,
    });
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("prescribe", () => {
  const spec = { name: "incline_dumbbell_press", sets: 3, repMin: 8, repMax: 10 };
  const session = (weight: number, reps: number[], daysAgo: number, complete = true): ExerciseSession => ({
    workoutId: `w${daysAgo}`,
    finishedAt: new Date(NOW.getTime() - daysAgo * 86_400_000),
    complete,
    sets: reps.map((r) => ({ weight, reps: r })),
    allSets: reps.map((r) => ({ weight, reps: r })),
    repRange: null,
  });

  it("history from any workout counts — an extra session is just another session", () => {
    const p = prescribe({
      spec,
      sessions: [session(50, [10, 10, 10], 2), session(50, [10, 10, 10], 5)],
      settings: DEFAULT_SETTINGS,
      now: NOW,
    });
    expect(p.recommendation).toMatchObject({ action: "increase", weight: 55 });
  });

  it("writes the slot's set count and range onto every row, the note on set 1 only", () => {
    const p = prescribe({ spec, sessions: [session(50, [10, 10, 9], 2)], settings: DEFAULT_SETTINGS, now: NOW });
    const rows = setRowsFor(p, 0);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.prescribed.slotSets === 3 && r.prescribed.repMin === 8)).toBe(true);
    expect(rows[0].prescribed.rationale).toBeTruthy();
    expect(rows[1].prescribed.rationale).toBeUndefined();
    expect(rows[0].prescribed.equipment).toBe("dumbbell");
    expect(rows[0].prescribed.restSeconds).toBe(DEFAULT_SETTINGS.restCompoundSeconds);
  });

  it("uses the configured success threshold", () => {
    const p = prescribe({
      spec,
      sessions: [session(50, [10, 10, 10], 2)],
      settings: { ...DEFAULT_SETTINGS, successSessions: 1 },
      now: NOW,
    });
    expect(p.recommendation.action).toBe("increase");
  });
});

describe("parseProgram", () => {
  it("accepts the default program", () => {
    expect(parseProgram(DEFAULT_PROGRAM)).toEqual(DEFAULT_PROGRAM);
  });

  it("rejects an inverted rep range and renumbers order", () => {
    const bad = structuredClone(DEFAULT_PROGRAM);
    bad.days[0].exercises[0].repMin = 12;
    bad.days[0].exercises[0].repMax = 8;
    expect(() => parseProgram(bad)).toThrow(/rep range/);

    const shuffled = structuredClone(DEFAULT_PROGRAM);
    shuffled.days[0].exercises.reverse();
    expect(parseProgram(shuffled).days[0].exercises.map((e) => e.order)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
