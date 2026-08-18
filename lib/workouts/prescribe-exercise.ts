import { inferExerciseMeta } from "@/lib/engine/infer-meta";
import type { RepRange } from "@/lib/engine/exercise-meta";
import { openingTargets, planNextTargets } from "@/lib/engine/progression";
import { consecutiveSameTarget, type ExerciseSession } from "./exercise-history";
import type { StoredPrescribed } from "./stored-set";

/** Sets a brand-new exercise opens with; after that the log book decides. */
export const BASE_SET_COUNT = 3;

export type PrescribeExerciseInput = {
  name: string;
  /** This exercise's finished sessions, newest first. Empty → first time. */
  sessions: ExerciseSession[];
  /** Opening load for a first-timer, from an onboarding lift estimate. */
  seedWeight?: number;
  /** Plate-increment override for this exercise (user gym preference). */
  weightIncrement?: number;
  /** Rep-range override for this exercise (user preference). */
  repRange?: RepRange;
};

export type NewSetRow = { setNumber: number; prescribed: StoredPrescribed };

/**
 * The targets one exercise opens today's session with. Last session's sets
 * carried forward, nudged up when they were all cleared — see
 * `lib/engine/progression`.
 */
export function prescribeExercise(input: PrescribeExerciseInput): NewSetRow[] {
  const inferred = inferExerciseMeta(input.name);
  const meta = {
    ...inferred,
    ...(input.weightIncrement ? { weightIncrement: input.weightIncrement } : {}),
    ...(input.repRange ? { repRange: input.repRange } : {}),
  };

  const last = input.sessions[0];
  const result = last
    ? planNextTargets({
        lastSets: last.sets,
        plannedSets: last.plannedSets,
        repRange: meta.repRange,
        weightIncrement: meta.weightIncrement,
        allowNegativeWeight: meta.type === "bodyweight",
        priorHolds: consecutiveSameTarget(input.sessions),
      })
    : openingTargets({ meta, setCount: BASE_SET_COUNT, seedWeight: input.seedWeight });

  return result.sets.map((s, i) => ({
    setNumber: i + 1,
    prescribed: {
      reps: s.targetReps,
      weight: s.weight,
      targetReps: s.targetReps,
      ...(i === 0 ? { rationale: result.note } : {}),
    },
  }));
}
