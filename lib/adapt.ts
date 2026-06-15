export type Feeling = "red" | "yellow" | "green";
export type Actual = { reps: number; weight: number; feeling: Feeling };
export type Prescribed = {
  reps: number;
  weight: number;
  targetReps: number;
  rationale?: string;
};
export type AdaptSet = { prescribed: Prescribed; actual: Actual | null };

/** Rep buffer (RIR) by how the previous set felt. Tunable. */
const BUFFER: Record<Feeling, number> = { yellow: 2, green: 0, red: 3 };

/**
 * Recompute the prescribed weight for every set after the first, from the
 * ORDERED chain of actuals. Pure — returns a new array, never mutates input.
 * A set is only recomputed when its immediate predecessor has been logged.
 * Editing any set and re-running this re-flows all sets after it.
 */
export function adaptChain(sets: AdaptSet[], baselineFloor = 0): AdaptSet[] {
  return sets.map((set, i) => {
    if (i === 0) return set; // seed (set 1) is authoritative
    const prev = sets[i - 1].actual;
    if (!prev) return set; // predecessor not logged → leave seed value
    const e1rm = estimate1RM(prev.weight, prev.reps);
    const buffer = BUFFER[prev.feeling];
    const targetReps = set.prescribed.targetReps;
    const raw = weightForReps(e1rm, targetReps + buffer);
    const weight = Math.max(baselineFloor, roundToStep(raw));
    return {
      ...set,
      prescribed: {
        ...set.prescribed,
        reps: targetReps,
        weight,
        rationale: `Prior set ${prev.reps}×${prev.weight} ≈ ${Math.round(
          e1rm,
        )} est. 1RM; targeting ${targetReps} reps → ${weight}`,
      },
    };
  });
}

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
