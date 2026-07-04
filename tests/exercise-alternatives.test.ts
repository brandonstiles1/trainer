import { describe, it, expect } from "vitest";
import { alternativesFor } from "@/lib/workouts/exercise-alternatives";
import { inferExerciseMeta } from "@/lib/engine/infer-meta";

describe("alternativesFor", () => {
  it("suggests same-muscle-group isolation swaps for a curl", () => {
    const alts = alternativesFor("hammer_curl", []);
    expect(alts).toContain("preacher_curl");
    expect(alts).toContain("dumbbell_curl");
    expect(alts).not.toContain("hammer_curl"); // never itself
    expect(alts).not.toContain("chin_up"); // compound filtered out of an isolation swap
  });

  it("keeps compound character for a compound lift", () => {
    const alts = alternativesFor("barbell_row", []);
    expect(alts).toContain("seated_cable_row");
    expect(alts).not.toContain("rear_delt_fly");
    for (const alt of alts) expect(inferExerciseMeta(alt).isCompound).toBe(true);
  });

  it("excludes exercises already in the workout", () => {
    const alts = alternativesFor("hammer_curl", ["preacher_curl"]);
    expect(alts).not.toContain("preacher_curl");
  });

  it("every catalog suggestion round-trips through inferExerciseMeta with a real muscle group", () => {
    const all = new Set([
      ...alternativesFor("barbell_bench_press", []),
      ...alternativesFor("barbell_row", []),
      ...alternativesFor("overhead_press", []),
      ...alternativesFor("hammer_curl", []),
      ...alternativesFor("cable_pushdown", []),
      ...alternativesFor("barbell_squat", []),
      ...alternativesFor("plank", []),
    ]);
    for (const name of all) {
      expect(inferExerciseMeta(name).muscleGroups).not.toEqual(["full_body"]);
    }
  });
});
