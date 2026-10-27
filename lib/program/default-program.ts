import type { ProgramStructure } from "./structure";

/**
 * The four-day aesthetics split: width, legs, chest/shoulders/traps, back/arms.
 * Names line up with the swap catalog so history follows exercises across
 * routines; equipment is spelled out where the name alone would mislead.
 */
export const DEFAULT_PROGRAM: ProgramStructure = {
  version: 2,
  split: "abcd_rotation",
  notes: "Four rotating workouts, ~40 minutes each. A → B → C → D → A, on whatever days you train.",
  days: [
    {
      day: "A",
      category: "upper_width",
      title: "Upper Body: Width",
      exercises: [
        { name: "incline_dumbbell_press", order: 1, sets: 3, repMin: 8, repMax: 10 },
        { name: "lat_pulldown", order: 2, sets: 3, repMin: 8, repMax: 12 },
        { name: "dumbbell_lateral_raise", order: 3, sets: 3, repMin: 12, repMax: 15 },
        { name: "chest_supported_row", order: 4, sets: 2, repMin: 10, repMax: 12, equipment: "machine", compound: true },
        { name: "dumbbell_shrug", order: 5, sets: 3, repMin: 10, repMax: 15 },
        { name: "cable_crunch", order: 6, sets: 2, repMin: 12, repMax: 15, equipment: "machine" },
      ],
    },
    {
      day: "B",
      category: "legs_abs",
      title: "Legs + Abs",
      exercises: [
        { name: "barbell_squat", order: 1, sets: 3, repMin: 8, repMax: 10, notes: "or leg press" },
        { name: "romanian_deadlift", order: 2, sets: 3, repMin: 8, repMax: 10, lowerBody: true },
        { name: "leg_curl", order: 3, sets: 2, repMin: 10, repMax: 12, equipment: "machine", compound: false },
        { name: "standing_calf_raise", order: 4, sets: 3, repMin: 12, repMax: 15, equipment: "machine", compound: false },
        { name: "hanging_knee_raise", order: 5, sets: 3, repMin: 10, repMax: 15, equipment: "bodyweight", compound: false, lowerBody: false },
      ],
    },
    {
      day: "C",
      category: "chest_shoulders_traps",
      title: "Chest, Shoulders + Traps",
      exercises: [
        { name: "dumbbell_bench_press", order: 1, sets: 3, repMin: 8, repMax: 10 },
        { name: "seated_dumbbell_shoulder_press", order: 2, sets: 3, repMin: 8, repMax: 10 },
        { name: "cable_lateral_raise", order: 3, sets: 3, repMin: 12, repMax: 15 },
        { name: "incline_cable_fly", order: 4, sets: 2, repMin: 10, repMax: 15, compound: false },
        { name: "dumbbell_shrug", order: 5, sets: 3, repMin: 10, repMax: 15 },
        { name: "rope_triceps_pushdown", order: 6, sets: 2, repMin: 10, repMax: 12 },
      ],
    },
    {
      day: "D",
      category: "back_arms_legs",
      title: "Back, Arms + Legs",
      exercises: [
        { name: "pull_up", order: 1, sets: 3, repMin: 6, repMax: 10, notes: "assisted is fine — log assistance as negative weight" },
        { name: "seated_cable_row", order: 2, sets: 3, repMin: 8, repMax: 12 },
        { name: "bulgarian_split_squat", order: 3, sets: 2, repMin: 8, repMax: 10, equipment: "dumbbell", compound: true, lowerBody: true, notes: "per leg" },
        { name: "reverse_pec_deck", order: 4, sets: 3, repMin: 12, repMax: 15, equipment: "machine", compound: false },
        { name: "incline_dumbbell_curl", order: 5, sets: 2, repMin: 10, repMax: 12 },
        { name: "hammer_curl", order: 6, sets: 2, repMin: 10, repMax: 12, equipment: "dumbbell" },
      ],
    },
  ],
};
