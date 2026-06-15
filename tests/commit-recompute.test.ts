import { describe, it, expect } from "vitest";
import { recomputeExercise, type StoredSet } from "@/lib/workouts/recompute-exercise";

const mk = (n: number, reps: number, weight: number, actual: StoredSet["actual"] = null): StoredSet => ({
  id: `s${n}`,
  setNumber: n,
  prescribed: { reps, weight, targetReps: reps },
  actual,
});

describe("recomputeExercise", () => {
  it("recomputes downstream weights from a logged set and returns only changed rows", () => {
    const sets: StoredSet[] = [
      mk(1, 10, 37, { reps: 8, weight: 100, feeling: "yellow" }),
      mk(2, 10, 37),
      mk(3, 10, 37),
    ];
    const changed = recomputeExercise(sets, 0);
    expect(changed.find((c) => c.id === "s2")?.prescribed.weight).toBe(90);
    expect(changed.find((c) => c.id === "s3")).toBeUndefined();
  });
});
