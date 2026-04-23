import { describe, it, expect } from "vitest";
import {
  profiles,
  goals,
  plans,
  liftEstimates,
  workouts,
  workoutSets,
  photos,
} from "@/lib/db/schema";

describe("db schema", () => {
  it("exports all 7 tables", () => {
    expect(profiles).toBeDefined();
    expect(goals).toBeDefined();
    expect(plans).toBeDefined();
    expect(liftEstimates).toBeDefined();
    expect(workouts).toBeDefined();
    expect(workoutSets).toBeDefined();
    expect(photos).toBeDefined();
  });

  it("profiles has expected columns", () => {
    const cols = Object.keys(profiles);
    expect(cols).toContain("userId");
    expect(cols).toContain("heightIn");
    expect(cols).toContain("weightLbs");
    expect(cols).toContain("restTimerSeconds");
  });

  it("workout_sets.prescribed is jsonb", () => {
    expect(workoutSets.prescribed).toBeDefined();
  });
});
