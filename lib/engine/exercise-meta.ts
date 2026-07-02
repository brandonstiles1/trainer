export type ExerciseType = "barbell" | "dumbbell" | "machine" | "bodyweight";

export type RepRange = { min: number; max: number };

export type ExerciseMeta = {
  type: ExerciseType;
  isCompound: boolean;
  muscleGroups: string[];
  /** Smallest load step: barbell/dumbbell 5 lb, machines their plate step, bodyweight = added-load step. */
  weightIncrement: number;
  repRange: RepRange;
  restSeconds: number;
};

export const COMPOUND_REP_RANGE: RepRange = { min: 6, max: 10 };
export const ISOLATION_REP_RANGE: RepRange = { min: 10, max: 15 };
export const COMPOUND_REST_SECONDS = 150; // 2–3 min
export const ISOLATION_REST_SECONDS = 75; // 60–90 s

const DEFAULT_INCREMENT: Record<ExerciseType, number> = {
  barbell: 5,
  dumbbell: 5,
  machine: 10,
  bodyweight: 5,
};

/** Fill in rep range, rest target, and load step from the exercise's type. */
export function defaultExerciseMeta(input: {
  type: ExerciseType;
  isCompound: boolean;
  muscleGroups: string[];
  weightIncrement?: number;
}): ExerciseMeta {
  return {
    type: input.type,
    isCompound: input.isCompound,
    muscleGroups: input.muscleGroups,
    weightIncrement: input.weightIncrement ?? DEFAULT_INCREMENT[input.type],
    repRange: input.isCompound ? COMPOUND_REP_RANGE : ISOLATION_REP_RANGE,
    restSeconds: input.isCompound ? COMPOUND_REST_SECONDS : ISOLATION_REST_SECONDS,
  };
}
