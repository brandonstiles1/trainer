import { describe, it, expect } from "vitest";
import { setsToCarryWeight, type CarryCandidate } from "@/lib/workouts/carry-weight";

const set = (over: Partial<CarryCandidate> & { id: string }): CarryCandidate => ({
  exerciseName: "barbell_curl",
  setNumber: 1,
  resolved: false,
  targetWeight: 55,
  ...over,
});

const threeSets = [
  set({ id: "a", setNumber: 1, resolved: true }),
  set({ id: "b", setNumber: 2 }),
  set({ id: "c", setNumber: 3 }),
];

describe("setsToCarryWeight", () => {
  it("moves the later sets of the exercise onto the load actually lifted", () => {
    const ids = setsToCarryWeight(threeSets, {
      exerciseName: "barbell_curl",
      setNumber: 1,
      weight: 60,
    });
    expect(ids).toEqual(["b", "c"]);
  });

  it("changes nothing when the logged weight matched the target", () => {
    expect(
      setsToCarryWeight(threeSets, { exerciseName: "barbell_curl", setNumber: 1, weight: 55 }),
    ).toEqual([]);
  });

  it("never rewrites earlier or already-resolved sets", () => {
    const ids = setsToCarryWeight(
      [
        set({ id: "a", setNumber: 1, resolved: true }),
        set({ id: "b", setNumber: 2, resolved: true }),
        set({ id: "c", setNumber: 3 }),
      ],
      { exerciseName: "barbell_curl", setNumber: 2, weight: 60 },
    );
    expect(ids).toEqual(["c"]);
  });

  it("leaves other exercises alone", () => {
    const ids = setsToCarryWeight(
      [...threeSets, set({ id: "z", exerciseName: "bench_press", setNumber: 2 })],
      { exerciseName: "barbell_curl", setNumber: 1, weight: 60 },
    );
    expect(ids).not.toContain("z");
  });

  it("skips sets already sitting at the new weight", () => {
    const ids = setsToCarryWeight(
      [
        set({ id: "a", setNumber: 1, resolved: true }),
        set({ id: "b", setNumber: 2, targetWeight: 60 }),
        set({ id: "c", setNumber: 3 }),
      ],
      { exerciseName: "barbell_curl", setNumber: 1, weight: 60 },
    );
    expect(ids).toEqual(["c"]);
  });
});
