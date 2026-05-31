export type DiffSet = {
  id: string;
  exerciseName: string;
  completedAt: Date | null;
};

export type PlanTodayDiff = {
  /** Exercises with ≥1 completed set — left fully intact. */
  startedExercises: string[];
  /** Set ids belonging to not-started exercises — to be deleted. */
  setIdsToDelete: string[];
  /** New-plan-day exercises that are not started — to be (re)generated, in plan order. */
  exercisesToGenerate: string[];
};

/**
 * Compute how to adjust today's in-progress workout when the plan changes.
 * "Finish what you started, replace everything not yet started."
 */
export function planTodayDiff(params: {
  existingSets: DiffSet[];
  newDayExercises: string[];
}): PlanTodayDiff {
  const { existingSets, newDayExercises } = params;

  const started = new Set<string>();
  for (const s of existingSets) {
    if (s.completedAt !== null) started.add(s.exerciseName);
  }

  const setIdsToDelete = existingSets
    .filter((s) => !started.has(s.exerciseName))
    .map((s) => s.id);

  const exercisesToGenerate = newDayExercises.filter((name) => !started.has(name));

  return {
    startedExercises: [...started],
    setIdsToDelete,
    exercisesToGenerate,
  };
}
