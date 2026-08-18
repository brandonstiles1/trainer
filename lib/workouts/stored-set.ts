import type { Feeling } from "@/lib/adapt";

/**
 * The `workout_sets.prescribed` payload: the target this set is chasing, plus
 * the one-line reason it moved (or didn't) since last session.
 *
 * `reps`/`targetReps` are the same number and both are written — `reps` is what
 * rows written before targets became editable carry, and older rows may also
 * still hold `amrap`/`calibration`/`deload` flags from the retired autoregulation
 * engine. Nothing reads those flags any more; they're just inert history.
 */
export type StoredPrescribed = {
  reps: number;
  weight: number;
  targetReps: number;
  /** Why these numbers — shown on the exercise card. Only set on set 1. */
  rationale?: string;
};

export type StoredActual = { reps: number; weight: number; feeling: Feeling };
