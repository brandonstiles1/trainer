import { describe, it, expect } from "vitest";
import {
  weeklyHardSets,
  isEasySession,
  nextSetCount,
  type LoggedSetForVolume,
} from "@/lib/engine/volume";
import type { Feel } from "@/lib/engine/config";

const NOW = new Date("2026-07-01T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const logged = (feel: Feel, completedAt: Date, muscleGroups = ["chest"]): LoggedSetForVolume => ({
  muscleGroups,
  feel,
  completedAt,
});

describe("weeklyHardSets", () => {
  it("counts medium/hard sets (RIR ≤ 3) inside the 7-day window", () => {
    const sets = [
      ...Array.from({ length: 6 }, () => logged("medium", daysAgo(2))),
      ...Array.from({ length: 4 }, () => logged("hard", daysAgo(5))),
      ...Array.from({ length: 3 }, () => logged("easy", daysAgo(1))), // RIR 4 — not hard
      ...Array.from({ length: 5 }, () => logged("hard", daysAgo(8))), // outside the window
    ];
    expect(weeklyHardSets(sets, NOW).get("chest")).toBe(10);
  });

  it("counts a multi-tagged set toward every muscle group", () => {
    const counts = weeklyHardSets([logged("hard", daysAgo(1), ["chest", "triceps"])], NOW);
    expect(counts.get("chest")).toBe(1);
    expect(counts.get("triceps")).toBe(1);
  });
});

describe("isEasySession", () => {
  it("true when all reps hit and nothing rated hard", () => {
    expect(
      isEasySession({
        sets: [
          { reps: 10, prescribedReps: 10, feel: "medium" },
          { reps: 11, prescribedReps: 10, feel: "easy" },
        ],
      }),
    ).toBe(true);
  });

  it("false on a missed rep or a hard set", () => {
    expect(
      isEasySession({ sets: [{ reps: 9, prescribedReps: 10, feel: "easy" }] }),
    ).toBe(false);
    expect(
      isEasySession({ sets: [{ reps: 10, prescribedReps: 10, feel: "hard" }] }),
    ).toBe(false);
  });
});

describe("scenario 6: volume autoregulation", () => {
  it("adds a set after 2 consecutive easy sessions under the weekly cap", () => {
    expect(
      nextSetCount({
        consecutiveEasySessions: 2,
        weeklyHardSets: 12,
        baseSetCount: 3,
        currentSetCount: 3,
      }),
    ).toBe(4);
  });

  it("does not add a set after only 1 easy session", () => {
    expect(
      nextSetCount({
        consecutiveEasySessions: 1,
        weeklyHardSets: 12,
        baseSetCount: 3,
        currentSetCount: 3,
      }),
    ).toBe(3);
  });

  it("never pushes a muscle group past 20 weekly sets", () => {
    expect(
      nextSetCount({
        consecutiveEasySessions: 2,
        weeklyHardSets: 20,
        baseSetCount: 3,
        currentSetCount: 5,
      }),
    ).toBe(5);
    // 19 → adding the 20th is allowed (cap is "never exceed", not "never reach").
    expect(
      nextSetCount({
        consecutiveEasySessions: 2,
        weeklyHardSets: 19,
        baseSetCount: 3,
        currentSetCount: 5,
      }),
    ).toBe(6);
  });

  it("resets to the base set count after a deload", () => {
    expect(
      nextSetCount({
        consecutiveEasySessions: 2,
        weeklyHardSets: 5,
        baseSetCount: 3,
        currentSetCount: 6,
        afterDeload: true,
      }),
    ).toBe(3);
  });
});
