import { describe, it, expect } from "vitest";
import {
  groupExerciseSessions,
  personalRecord,
  type HistoryRow,
} from "@/lib/workouts/exercise-history";

const row = (over: Partial<HistoryRow> = {}): HistoryRow => ({
  workoutId: "w1",
  exerciseName: "barbell_curl",
  setNumber: 1,
  prescribed: { reps: 8, weight: 55, targetReps: 8 },
  actual: { reps: 8, weight: 55 },
  finishedAt: new Date("2026-08-01"),
  ...over,
});

const three = (over: Partial<HistoryRow> = {}, slotSets?: number) =>
  [1, 2, 3].map((n) =>
    row({ setNumber: n, prescribed: { reps: 8, weight: 55, targetReps: 8, slotSets }, ...over }),
  );

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
        row({ setNumber: 3, actual: { reps: 6, weight: 45 } }),
        row({ setNumber: 1, actual: { reps: 8, weight: 55 } }),
        row({ setNumber: 2, actual: { reps: 7, weight: 50 } }),
      ],
      "barbell_curl",
    );
    expect(sessions[0].sets.map((s) => s.weight)).toEqual([55, 50, 45]);
  });

  it("a fully logged exercise is complete", () => {
    expect(groupExerciseSessions(three(), "barbell_curl")[0].complete).toBe(true);
  });

  it("a skipped prescribed set makes the session incomplete", () => {
    const rows = three();
    rows[2] = { ...rows[2], actual: null };
    const [s] = groupExerciseSessions(rows, "barbell_curl");
    expect(s.complete).toBe(false);
    expect(s.sets).toHaveLength(2);
  });

  it("a removed set (fewer rows than the slot asked for) is incomplete", () => {
    const [s] = groupExerciseSessions(three({}, 4), "barbell_curl");
    expect(s.complete).toBe(false);
  });

  it("extra sets beyond the slot are kept for history but not judged", () => {
    const rows = [
      ...three({}, 3),
      row({ setNumber: 4, actual: null, prescribed: { reps: 8, weight: 55, targetReps: 8, slotSets: 3 } }),
      row({ setNumber: 5, actual: { reps: 3, weight: 55 }, prescribed: { reps: 8, weight: 55, targetReps: 8, slotSets: 3 } }),
    ];
    const [s] = groupExerciseSessions(rows, "barbell_curl");
    expect(s.complete).toBe(true);
    expect(s.sets).toHaveLength(3);
    expect(s.allSets).toHaveLength(4);
  });

  it("ignores other exercises and drops sessions with nothing logged", () => {
    expect(groupExerciseSessions([row({ exerciseName: "bench_press" })], "barbell_curl")).toEqual([]);
    expect(groupExerciseSessions([row({ actual: null })], "barbell_curl")).toEqual([]);
  });

  it("reads legacy rows that still carry an Easy/Medium/Hard feeling", () => {
    const legacy = row({ actual: { reps: 8, weight: 55, feeling: "red" } as HistoryRow["actual"] });
    expect(groupExerciseSessions([legacy], "barbell_curl")[0].sets[0]).toEqual({ weight: 55, reps: 8 });
  });

  it("treats a non-numeric logged value as missing data", () => {
    const bad = row({ actual: { reps: 8, weight: null as unknown as number } });
    expect(groupExerciseSessions([bad, row({ setNumber: 2 })], "barbell_curl")[0].complete).toBe(false);
  });
});

describe("personalRecord", () => {
  it("takes the heaviest set, breaking ties on reps", () => {
    const s = (weight: number, reps: number) => ({ allSets: [{ weight, reps }] });
    expect(personalRecord([s(55, 8), s(60, 5), s(60, 8)])).toEqual({ weight: 60, reps: 8 });
  });

  it("is null with no history", () => {
    expect(personalRecord([])).toBeNull();
  });
});
