import { describe, it, expect } from "vitest";
import { formatReviewContext, type ReviewSetRow } from "@/lib/workouts/review-context";

const row = (over: Partial<ReviewSetRow> = {}): ReviewSetRow => ({
  workoutId: "w1",
  exerciseName: "barbell_curl",
  setNumber: 1,
  prescribed: { reps: 8, weight: 55, targetReps: 8 },
  actual: { reps: 8, weight: 55, feeling: "yellow" },
  ...over,
});

const workout = { id: "w1", dayKey: "pull", startedAt: new Date("2026-08-12T18:00:00Z") };

describe("formatReviewContext", () => {
  it("writes each set as target versus logged, with how it felt", () => {
    const out = formatReviewContext({ workouts: [workout], sets: [row()] });
    expect(out).toContain("2026-08-12 — pull");
    expect(out).toContain("barbell_curl: 8×55 (target 8×55, felt okay)");
  });

  it("marks skipped sets rather than dropping them", () => {
    const out = formatReviewContext({
      workouts: [workout],
      sets: [row(), row({ setNumber: 2, actual: null })],
    });
    expect(out).toContain("skipped (target 8×55)");
  });

  it("groups an exercise's sets onto one line", () => {
    const out = formatReviewContext({
      workouts: [workout],
      sets: [
        row({ setNumber: 1 }),
        row({ setNumber: 2, actual: { reps: 7, weight: 55, feeling: "red" } }),
      ],
    });
    const line = out.split("\n").find((l) => l.includes("barbell_curl"))!;
    expect(line).toContain("8×55");
    expect(line).toContain("7×55");
    expect(line).toContain("felt hard");
  });

  it("orders sessions oldest first so the week reads forwards", () => {
    const later = { id: "w2", dayKey: "push", startedAt: new Date("2026-08-14T18:00:00Z") };
    const out = formatReviewContext({
      workouts: [later, workout],
      sets: [row(), row({ workoutId: "w2", exerciseName: "bench_press" })],
    });
    expect(out.indexOf("2026-08-12")).toBeLessThan(out.indexOf("2026-08-14"));
  });

  it("says so plainly when there's nothing to review", () => {
    expect(formatReviewContext({ workouts: [], sets: [] })).toBe("No sessions this week.");
  });

  it("notes a session where everything was skipped", () => {
    const out = formatReviewContext({ workouts: [workout], sets: [] });
    expect(out).toContain("(no sets logged)");
  });
});
