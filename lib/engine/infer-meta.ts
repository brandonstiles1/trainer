import { defaultExerciseMeta, type ExerciseMeta, type ExerciseType } from "./exercise-meta";

/**
 * Deterministic exercise metadata from a snake_case name. Keyword-based and
 * intentionally forgiving — a wrong guess only shifts defaults (rep range,
 * increment, rest); the engine's numbers still come from logged performance.
 */
export function inferExerciseMeta(name: string): ExerciseMeta {
  const n = name.toLowerCase();
  const tokens = new Set(n.split(/[^a-z]+/).filter(Boolean));
  // Token match for short/ambiguous words, substring match for phrases.
  const has = (...words: string[]) =>
    words.some((w) => (w.includes("_") ? n.includes(w) : tokens.has(w)));

  const type: ExerciseType = has(
    "pull_up", "pullup", "chin_up", "chinup", "push_up", "pushup", "dip",
    "plank", "crunch", "sit_up", "situp", "burpee", "inverted_row",
    "muscle_up", "hanging", "leg_raise", "nordic",
  )
    ? "bodyweight"
    : has("machine", "cable", "smith", "rope", "pec_deck", "pulldown", "leg_curl", "leg_extension") // explicit equipment always wins
      ? "machine"
      : has("dumbbell", "db") // "dumbbell_bench_press" is a dumbbell lift, not a barbell one
        ? "dumbbell"
      : has("barbell", "bench", "squat", "deadlift", "rdl", "ohp", "overhead", "military", "clean", "snatch", "hip_thrust", "good_morning")
        ? "barbell"
        : has("dumbbell", "db", "goblet", "curl", "lateral_raise", "front_raise", "rear_delt", "arnold", "shrug", "kickback")
          ? "dumbbell"
          : "machine"; // stacks, pin-loaded, unknown — the safe default

  const isCompound =
    has(
      "press", "bench", "squat", "deadlift", "rdl", "row", "pull_up", "pullup",
      "chin", "dip", "lunge", "thrust", "clean", "snatch", "pulldown", "ohp",
    ) && !has("pushdown", "pressdown");

  const muscleGroups: string[] = [];
  if (has("bench", "chest", "fly", "flye", "pec", "push_up", "pushup", "incline", "decline", "crossover", "dip"))
    muscleGroups.push("chest");
  if (has("row", "pulldown", "pull_up", "pullup", "chin", "back", "pullover", "shrug"))
    muscleGroups.push("back");
  if (has("shoulder", "ohp", "overhead", "military", "lateral", "delt", "arnold", "upright", "face_pull", "front_raise"))
    muscleGroups.push("shoulders");
  if ((has("curl", "bicep", "biceps") && !has("leg", "hamstring", "nordic")) || has("chin"))
    muscleGroups.push("biceps");
  if (has("tricep", "triceps", "pushdown", "pressdown", "skullcrusher", "skull_crusher", "kickback", "close_grip", "dip") || (has("extension") && !has("leg", "back")))
    muscleGroups.push("triceps");
  if (has("squat", "deadlift", "rdl", "lunge", "leg", "calf", "quad", "hamstring", "glute", "thrust", "hip", "nordic", "adductor", "abductor", "step_up", "good_morning"))
    muscleGroups.push("legs");
  if (has("ab", "abs", "crunch", "plank", "core", "situp", "sit_up", "woodchop", "rollout", "leg_raise"))
    muscleGroups.push("core");
  if (muscleGroups.length === 0) muscleGroups.push("full_body");

  const isLowerBody = muscleGroups.includes("legs") && !muscleGroups.includes("core");

  return defaultExerciseMeta({ type, isCompound, isLowerBody, muscleGroups });
}
