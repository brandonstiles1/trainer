import { describe, it, expect } from "vitest";
import {
  consecutiveSameTarget,
  groupExerciseSessions,
  personalRecord,
  type ExerciseSession,
  type HistoryRow,
} from "@/lib/workouts/exercise-history";

const row = (over: Partial<HistoryRow> = {}): HistoryRow => ({
  workoutId: "w1",
  exerciseName: "barbell_curl",
  setNumber: 1,
  prescribed: { reps: 8, weight: 55, targetReps: 8 },
  actual: { reps: 8, weight: 55, feeling: "yellow" },
  finishedAt: new Date("2026-08-01"),
  ...over,
});

const session = (weight: number, targetReps: number, reps = targetReps): ExerciseSession => ({
  workoutId: `w-${weight}-${targetReps}-${reps}`,
  finishedAt: new Date("2026-08-01"),
  plannedSets: 1,
  sets: [{ targetReps, weight, reps, feel: "medium" }],
});

describe("groupExerciseSessions", () => {
  it("groups by workout, newest first", () => {
    const sessions = groupExerciseSessions(
      [
        row({ workoutId: "old", finishedAt: new Date("2026-07-01") }),
        row({ workoutId: "new", finishedAt: new Date("2026-08-01") }),
      ],
      "barbell_curl",
    );
    expect(sessions.map((s) => s.workoutId)).toEqual(["new", "old"]);
  });

  it("keeps sets in set order regardless of row order", () => {
    const sessions = groupExerciseSessions(
      [
        row({ setNumber: 3, actual: { reps: 6, weight: 45, feeling: "red" } }),
        row({ setNumber: 1, actual: { reps: 8, weight: 55, feeling: "green" } }),
        row({ setNumber: 2, actual: { reps: 7, weight: 50, feeling: "yellow" } }),
      ],
      "barbell_curl",
    );
    expect(sessions[0].sets.map((s) => s.weight)).toEqual([55, 50, 45]);
  });

  it("ignores other exercises and skipped sets", () => {
    const sessions = groupExerciseSessions(
      [
        row({ setNumber: 1 }),
        row({ setNumber: 2, actual: null }),
        row({ exerciseName: "bench_press", setNumber: 1 }),
      ],
      "barbell_curl",
    );
    expect(sessions[0].sets).toHaveLength(1);
  });

  it("counts a skipped set toward the session's planned size", () => {
    const sessions = groupExerciseSessions(
      [row({ setNumber: 1 }), row({ setNumber: 2 }), row({ setNumber: 3, actual: null })],
      "barbell_curl",
    );
    expect(sessions[0].sets).toHaveLength(2);
    expect(sessions[0].plannedSets).toBe(3);
  });

  it("drops a session where everything was skipped", () => {
    const sessions = groupExerciseSessions([row({ actual: null })], "barbell_curl");
    expect(sessions).toEqual([]);
  });

  it("falls back to the prescribed reps when targetReps predates the field", () => {
    const legacy = row({
      prescribed: { reps: 10, weight: 55 } as HistoryRow["prescribed"],
    });
    expect(groupExerciseSessions([legacy], "barbell_curl")[0].sets[0].targetReps).toBe(10);
  });

  it("translates the logged feeling into a feel", () => {
    const sessions = groupExerciseSessions(
      [row({ actual: { reps: 8, weight: 55, feeling: "red" } })],
      "barbell_curl",
    );
    expect(sessions[0].sets[0].feel).toBe("hard");
  });
});

describe("consecutiveSameTarget", () => {
  it("counts sessions before the newest that chased the same numbers", () => {
    expect(consecutiveSameTarget([session(55, 8), session(55, 8), session(55, 8)])).toBe(2);
  });

  it("stops counting at the first different target", () => {
    expect(consecutiveSameTarget([session(55, 8), session(55, 8), session(50, 8)])).toBe(1);
  });

  it("is zero for a fresh target and for no history", () => {
    expect(consecutiveSameTarget([session(55, 8), session(55, 7)])).toBe(0);
    expect(consecutiveSameTarget([])).toBe(0);
  });
});

describe("personalRecord", () => {
  it("takes the heaviest set, breaking ties on reps", () => {
    expect(personalRecord([session(55, 8), session(60, 5), session(60, 8)])).toEqual({
      weight: 60,
      reps: 8,
    });
  });

  it("is null with no history", () => {
    expect(personalRecord([])).toBeNull();
  });
});
