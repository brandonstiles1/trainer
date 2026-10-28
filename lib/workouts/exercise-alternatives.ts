import { inferExerciseMeta } from "@/lib/engine/infer-meta";

/**
 * Static swap catalog: common exercises per muscle group, in snake_case names
 * that inferExerciseMeta classifies correctly. Deterministic on purpose — the
 * swap picker never consults the LLM.
 */
const CATALOG: Record<string, string[]> = {
  chest: [
    "barbell_bench_press",
    "incline_dumbbell_press",
    "machine_chest_press",
    "dumbbell_fly",
    "cable_crossover",
    "push_up",
    "dip",
  ],
  back: [
    "barbell_row",
    "dumbbell_row",
    "seated_cable_row",
    "lat_pulldown",
    "pull_up",
    "chin_up",
    "t_bar_row",
    "inverted_row",
  ],
  shoulders: [
    "overhead_press",
    "dumbbell_shoulder_press",
    "arnold_press",
    "lateral_raise",
    "cable_lateral_raise",
    "front_raise",
    "rear_delt_fly",
    "face_pull",
  ],
  biceps: [
    "barbell_curl",
    "dumbbell_curl",
    "hammer_curl",
    "preacher_curl",
    "cable_curl",
    "incline_dumbbell_curl",
    "chin_up",
  ],
  triceps: [
    "cable_pushdown",
    "skullcrusher",
    "overhead_tricep_extension",
    "close_grip_bench_press",
    "dip",
    "dumbbell_kickback",
  ],
  legs: [
    "barbell_squat",
    "goblet_squat",
    "leg_press",
    "romanian_deadlift",
    "bulgarian_split_squat",
    "walking_lunge",
    "hip_thrust",
    "leg_extension",
    "leg_curl",
    "calf_raise",
  ],
  core: ["plank", "crunch", "hanging_leg_raise", "cable_woodchop", "ab_rollout", "sit_up"],
  full_body: ["kettlebell_swing", "burpee"],
};

/**
 * Similar exercises to swap in for `name`: same muscle group and same
 * compound/isolation character, excluding anything already in the workout.
 */
export function alternativesFor(name: string, exclude: string[]): string[] {
  const meta = inferExerciseMeta(name);
  const excluded = new Set([name, ...exclude]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of meta.muscleGroups) {
    for (const candidate of CATALOG[group] ?? []) {
      if (excluded.has(candidate) || seen.has(candidate)) continue;
      seen.add(candidate);
      if (inferExerciseMeta(candidate).isCompound !== meta.isCompound) continue;
      out.push(candidate);
    }
  }
  return out;
}

/** Every exercise the swap catalog knows, for pickers. */
export const CATALOG_EXERCISES: string[] = [...new Set(Object.values(CATALOG).flat())].sort();
