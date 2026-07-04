import { estimate1RM, type Feeling } from "@/lib/adapt";
import {
  autoregulate,
  type CompletedSet,
  type ExercisePlan,
  type ExerciseSessionState,
} from "@/lib/engine/autoregulate";
import { defaultEngineConfig, feelFromFeeling, type EngineConfig } from "@/lib/engine/config";
import { inferExerciseMeta } from "@/lib/engine/infer-meta";

/** Default reps-in-reserve target for prescribed working sets. */
export const TARGET_RIR = 2;

export type StoredPrescribed = {
  reps: number;
  weight: number;
  targetReps: number;
  rationale?: string;
  /** AMRAP set (calibration seeding) — go to the last clean rep. */
  amrap?: boolean;
  /** Part of a no-baseline calibration ramp. */
  calibration?: boolean;
  /** Part of a deload session. */
  deload?: boolean;
};

export type StoredActual = { reps: number; weight: number; feeling: Feeling };

export type WorkoutRow = {
  id: string;
  exerciseName: string;
  setNumber: number;
  prescribed: StoredPrescribed;
  actual: StoredActual | null;
  /** completedAt is set — logged (actual present) or skipped (actual null). */
  resolved: boolean;
};

export type RecomputeResult = {
  /** Rows whose prescription changed — persist/apply a minimal diff. */
  changed: Array<{ id: string; prescribed: StoredPrescribed }>;
  states: ExerciseSessionState[];
  readinessMultiplier: number;
};

/**
 * Run the deterministic engine over an entire workout's stored rows and return
 * updated prescriptions for every unresolved set. Pure — runs identically on
 * the server (persistence) and the client (instant optimistic mirror).
 *
 * Baseline per exercise: the stored e1RM if one exists; a calibration-flagged
 * exercise with none runs the calibration ramp; otherwise the baseline is
 * derived from set 1's standing prescription (treated as a TARGET_RIR set).
 * Skipped sets are excluded from the engine's view of the exercise.
 */
export function recomputeWorkoutRows(
  input: {
    rows: WorkoutRow[];
    /** Plan-day exercise order; names not listed keep first-appearance order. */
    exerciseOrder: string[];
    baselines: Record<string, number | null | undefined>;
    bodyweightLbs?: number;
    /** Per-exercise plate-increment overrides (user gym preference). */
    increments?: Record<string, number | undefined>;
  },
  config: EngineConfig = defaultEngineConfig,
): RecomputeResult {
  const { rows, baselines } = input;

  const names: string[] = [];
  const byName = new Map<string, WorkoutRow[]>();
  for (const row of rows) {
    if (!byName.has(row.exerciseName)) {
      byName.set(row.exerciseName, []);
      names.push(row.exerciseName);
    }
    byName.get(row.exerciseName)!.push(row);
  }
  const rank = new Map(input.exerciseOrder.map((n, i) => [n, i]));
  names.sort((a, b) => (rank.get(a) ?? 999) - (rank.get(b) ?? 999));

  const exercises: ExercisePlan[] = [];
  const completed: CompletedSet[] = [];
  const unresolvedByName = new Map<string, WorkoutRow[]>();

  for (const name of names) {
    const bySetNumber = (a: WorkoutRow, b: WorkoutRow) => a.setNumber - b.setNumber;
    const logged = byName.get(name)!.filter((r) => r.resolved && r.actual).sort(bySetNumber);
    const unresolved = byName.get(name)!.filter((r) => !r.resolved).sort(bySetNumber);
    // Skipped sets (resolved, no actual) are dropped: they did no work and
    // their slot no longer needs a prescription.
    const logical = [...logged, ...unresolved];
    unresolvedByName.set(name, unresolved);

    const inferred = inferExerciseMeta(name);
    const increment = input.increments?.[name];
    const meta = increment ? { ...inferred, weightIncrement: increment } : inferred;
    const addedBw = meta.type === "bodyweight" ? (input.bodyweightLbs ?? 0) : 0;
    exercises.push({
      name,
      meta,
      sets: logical.map((r) => ({
        targetReps: r.prescribed.targetReps ?? r.prescribed.reps,
        targetRir: TARGET_RIR,
      })),
      baselineE1rm: resolveBaseline(baselines[name], byName.get(name)!, logical, addedBw),
      bodyweightLbs: input.bodyweightLbs,
    });
    logged.forEach((r, i) =>
      completed.push({
        exerciseName: name,
        setNumber: i + 1,
        weight: r.actual!.weight,
        reps: r.actual!.reps,
        feel: feelFromFeeling(r.actual!.feeling),
      }),
    );
  }

  const result = autoregulate({ exercises }, completed, config);

  const changed: RecomputeResult["changed"] = [];
  for (const name of names) {
    const unresolved = unresolvedByName.get(name)!;
    const prescriptions = result.prescriptions
      .filter((p) => p.exerciseName === name)
      .sort((a, b) => a.setNumber - b.setNumber);
    const count = Math.min(unresolved.length, prescriptions.length);
    for (let i = 0; i < count; i++) {
      const row = unresolved[i];
      const p = prescriptions[i];
      const next: StoredPrescribed = {
        ...row.prescribed,
        reps: p.reps,
        weight: p.weight,
        rationale: p.reason,
        ...(p.amrap ? { amrap: true } : {}),
      };
      if (
        next.reps !== row.prescribed.reps ||
        next.weight !== row.prescribed.weight ||
        next.rationale !== row.prescribed.rationale
      ) {
        changed.push({ id: row.id, prescribed: next });
      }
    }
  }

  return { changed, states: result.exercises, readinessMultiplier: result.readinessMultiplier };
}

function resolveBaseline(
  stored: number | null | undefined,
  allRows: WorkoutRow[],
  logical: WorkoutRow[],
  bodyweightLbs: number,
): number | null {
  if (stored != null) return stored;
  if (allRows.some((r) => r.prescribed.calibration)) return null;
  const first = logical[0];
  if (!first || first.prescribed.weight + bodyweightLbs <= 0) return null;
  return estimate1RM(
    first.prescribed.weight + bodyweightLbs,
    (first.prescribed.targetReps ?? first.prescribed.reps) + TARGET_RIR,
  );
}
