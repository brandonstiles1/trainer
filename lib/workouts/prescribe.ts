import { recommendNext, type Recommendation } from "@/lib/engine/double-progression";
import type { ExerciseMeta } from "@/lib/engine/exercise-meta";
import { metaFor, type ProgramExercise } from "@/lib/program/structure";
import { incrementFor, restFor, type ProgressionSettings } from "@/lib/program/settings";
import type { ExerciseSession } from "./exercise-history";
import type { StoredPrescribed } from "./stored-set";

/** What one exercise slot asks for: the routine entry, or defaults for an ad-hoc pick. */
export type SlotSpec = Pick<ProgramExercise, "name" | "sets" | "repMin" | "repMax"> &
  Partial<Pick<ProgramExercise, "equipment" | "compound" | "lowerBody" | "notes">>;

export type Prescription = {
  spec: SlotSpec;
  meta: ExerciseMeta;
  increment: number;
  restSeconds: number;
  recommendation: Recommendation;
  /** Newest finished session, complete or not — "last time" on the card. */
  last: ExerciseSession | null;
};

/** A routine-less exercise (extra session, swap) gets 3 sets in its inferred range. */
export function adHocSpec(name: string, sets = 3, range?: { min: number; max: number }): SlotSpec {
  const meta = metaFor({ name });
  const r = range ?? meta.repRange;
  return { name, sets, repMin: r.min, repMax: r.max };
}

/**
 * Today's recommendation for one exercise slot. Pure: history, settings and
 * the clock in, numbers out. The same call feeds the home screen preview and
 * the rows a new workout is created with, so what you see is what you get.
 */
export function prescribe(input: {
  spec: SlotSpec;
  sessions: ExerciseSession[];
  settings: ProgressionSettings;
  incrementOverride?: number | null;
  seedWeight?: number;
  now: Date;
}): Prescription {
  const { spec, settings } = input;
  const meta = metaFor(spec);
  const increment = incrementFor(meta, settings, input.incrementOverride);
  const recommendation = recommendNext({
    sessions: input.sessions,
    setCount: spec.sets,
    repRange: { min: spec.repMin, max: spec.repMax },
    increment,
    allowNegative: meta.type === "bodyweight",
    rules: settings,
    now: input.now,
    seedWeight: input.seedWeight,
  });
  return {
    spec,
    meta,
    increment,
    restSeconds: restFor(meta, settings),
    recommendation,
    last: input.sessions[0] ?? null,
  };
}

/** The `workout_sets` rows a prescription opens with. */
export function setRowsFor(p: Prescription, exerciseOrder: number) {
  return p.recommendation.sets.map((s, i) => {
    const prescribed: StoredPrescribed = {
      reps: s.targetReps,
      weight: s.weight,
      targetReps: s.targetReps,
      repMin: p.spec.repMin,
      repMax: p.spec.repMax,
      slotSets: p.spec.sets,
      equipment: p.meta.type,
      restSeconds: p.restSeconds,
      ...(i === 0 ? { action: p.recommendation.action, rationale: p.recommendation.reason } : {}),
    };
    return { exerciseName: p.spec.name, setNumber: i + 1, exerciseOrder, prescribed };
  });
}
