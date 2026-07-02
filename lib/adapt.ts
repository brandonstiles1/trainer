export type Feeling = "red" | "yellow" | "green";
export type Actual = { reps: number; weight: number; feeling: Feeling };

// In-workout adaptation lives in lib/engine (autoregulate) via
// lib/workouts/engine-adapter; this module keeps the shared Epley math.

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
