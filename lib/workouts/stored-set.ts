import type { ExerciseType } from "@/lib/engine/exercise-meta";
import type { RecommendAction } from "@/lib/engine/double-progression";

/**
 * The `workout_sets.prescribed` payload: the target this set opens with.
 *
 * `reps`/`targetReps` are the same number and both are written — `reps` is what
 * the oldest rows carry. Rows from earlier engines may also hold
 * `amrap`/`calibration`/`deload` flags; nothing reads them.
 */
export type StoredPrescribed = {
  reps: number;
  weight: number;
  targetReps: number;
  repMin?: number;
  repMax?: number;
  /**
   * The routine's set count for this exercise. Progression judges only these
   * sets, so an extra back-off set can't spoil a session and skipping one of
   * them makes the session incomplete.
   */
  slotSets?: number;
  equipment?: ExerciseType;
  restSeconds?: number;
  /** What the recommendation did and why — set 1 only. */
  action?: RecommendAction;
  rationale?: string;
};

/**
 * The `workout_sets.actual` payload. Rows logged before the Easy/Medium/Hard
 * rating was removed also carry a `feeling`; it's ignored.
 */
export type StoredActual = { reps: number; weight: number };
