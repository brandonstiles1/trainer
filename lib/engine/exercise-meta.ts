export type ExerciseType = "barbell" | "dumbbell" | "machine" | "bodyweight";

export type RepRange = { min: number; max: number };

export type ExerciseMeta = {
  type: ExerciseType;
  isCompound: boolean;
  /** Lower-body compounds take bigger jumps (+5–10 lb) than upper-body ones. */
  isLowerBody: boolean;
  muscleGroups: string[];
  /** Fallback load step when no settings are in play. Dumbbells: per dumbbell. */
  weightIncrement: number;
  repRange: RepRange;
  restSeconds: number;
};

export const COMPOUND_REP_RANGE: RepRange = { min: 8, max: 10 };
export const ISOLATION_REP_RANGE: RepRange = { min: 10, max: 15 };
export const COMPOUND_REST_SECONDS = 105; // 90–120 s
export const ISOLATION_REST_SECONDS = 75; // 60–90 s

const DEFAULT_INCREMENT: Record<ExerciseType, number> = {
  barbell: 5,
  dumbbell: 5,
  machine: 5,
  bodyweight: 5,
};

/** Fill in rep range, rest target, and load step from the exercise's type. */
export function defaultExerciseMeta(input: {
  type: ExerciseType;
  isCompound: boolean;
  isLowerBody?: boolean;
  muscleGroups: string[];
  weightIncrement?: number;
}): ExerciseMeta {
  return {
    type: input.type,
    isCompound: input.isCompound,
    isLowerBody: input.isLowerBody ?? false,
    muscleGroups: input.muscleGroups,
    weightIncrement: input.weightIncrement ?? DEFAULT_INCREMENT[input.type],
    repRange: input.isCompound ? COMPOUND_REP_RANGE : ISOLATION_REP_RANGE,
    restSeconds: input.isCompound ? COMPOUND_REST_SECONDS : ISOLATION_REST_SECONDS,
  };
}
