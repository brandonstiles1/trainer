// Progression lives in lib/engine/double-progression and runs on logged reps and
// weights alone. The Epley math below survives for exactly one job: turning a
// signup answer ("I can bench 185×5") into an opening load for an exercise the
// user has never logged. See seedWeightsFor in lib/workouts/log-book.

/** Estimated one-rep max (Epley). */
export function estimate1RM(weight: number, reps: number): number {
  return weight * (1 + reps / 30);
}

/** Weight at which `reps` is the rep-max, given an estimated 1RM (inverse Epley). */
export function weightForReps(e1rm: number, reps: number): number {
  return e1rm / (1 + reps / 30);
}

/** Round to the nearest plate increment (default 5 lb). */
export function roundToStep(weight: number, step = 5): number {
  return Math.round(weight / step) * step;
}
