import { describe, it, expect } from "vitest";
import { inferExerciseMeta } from "@/lib/engine/infer-meta";

describe("inferExerciseMeta", () => {
  it("classifies the common lifts", () => {
    expect(inferExerciseMeta("bench_press")).toMatchObject({
      type: "barbell",
      isCompound: true,
      muscleGroups: ["chest"],
      repRange: { min: 8, max: 10 },
    });
    expect(inferExerciseMeta("back_squat")).toMatchObject({ type: "barbell", isCompound: true });
    expect(inferExerciseMeta("pull_up")).toMatchObject({ type: "bodyweight", isCompound: true });
  });

  it("cable chest fly → machine isolation hitting chest", () => {
    expect(inferExerciseMeta("cable_chest_fly")).toMatchObject({
      type: "machine",
      isCompound: false,
      muscleGroups: ["chest"],
      repRange: { min: 10, max: 15 },
      weightIncrement: 5,
    });
  });

  it("lateral raise → dumbbell isolation hitting shoulders", () => {
    expect(inferExerciseMeta("lateral_raise")).toMatchObject({
      type: "dumbbell",
      isCompound: false,
      muscleGroups: ["shoulders"],
    });
  });

  it("resolves ambiguous keywords sensibly", () => {
    expect(inferExerciseMeta("leg_curl").muscleGroups).toEqual(["legs"]); // not biceps
    expect(inferExerciseMeta("leg_extension").muscleGroups).toEqual(["legs"]); // not triceps
    expect(inferExerciseMeta("tricep_pushdown")).toMatchObject({
      isCompound: false,
      muscleGroups: ["triceps"],
    });
    expect(inferExerciseMeta("lat_pulldown")).toMatchObject({
      isCompound: true,
      muscleGroups: ["back"],
    });
    expect(inferExerciseMeta("face_pull").muscleGroups).toContain("shoulders");
  });

  it("an explicit dumbbell beats barbell keywords", () => {
    expect(inferExerciseMeta("dumbbell_bench_press")).toMatchObject({ type: "dumbbell", isCompound: true });
    expect(inferExerciseMeta("leg_curl")).toMatchObject({ type: "machine", isLowerBody: true });
    expect(inferExerciseMeta("barbell_squat")).toMatchObject({ isCompound: true, isLowerBody: true });
    expect(inferExerciseMeta("incline_dumbbell_press")).toMatchObject({ isLowerBody: false });
  });

  it("falls back to a full-body machine exercise for unknown names", () => {
    expect(inferExerciseMeta("mystery_move")).toMatchObject({
      type: "machine",
      muscleGroups: ["full_body"],
    });
  });
});
