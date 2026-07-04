import { autoregulate } from "@/lib/engine/autoregulate";
import { defaultEngineConfig, type EngineConfig } from "@/lib/engine/config";
import { inferExerciseMeta } from "@/lib/engine/infer-meta";
import { planNextSession, type SessionSetLog } from "@/lib/engine/next-workout";
import { nextSetCount } from "@/lib/engine/volume";
import { TARGET_RIR, type StoredPrescribed } from "./engine-adapter";

export const BASE_SET_COUNT = 3;

export type LastSession = {
  /** Logged sets of this exercise in its most recent session, in set order. */
  sets: SessionSetLog[];
  wasDeload: boolean;
};

export type PrescribeExerciseInput = {
  name: string;
  /** Stored baseline e1RM; null → calibration ramp. */
  baselineE1rm: number | null;
  lastSession: LastSession | null;
  /** Session-final e1RMs, oldest → newest. */
  e1rmHistory: number[];
  /** Rolling 7-day hard sets for the exercise's busiest muscle group. */
  weeklyHardSetsForGroup: number;
  consecutiveEasySessions: number;
  bodyweightLbs?: number;
  /** Plate-increment override for this exercise (user gym preference). */
  weightIncrement?: number;
};

export type NewSetRow = { setNumber: number; prescribed: StoredPrescribed };

/**
 * Deterministic session prescription for one exercise at workout-creation time.
 * History → outcome-classified progression (+ volume adjustment); a bare
 * baseline → conservative probe sets; nothing at all → calibration ramp.
 */
export function prescribeExercise(
  input: PrescribeExerciseInput,
  config: EngineConfig = defaultEngineConfig,
): NewSetRow[] {
  const inferred = inferExerciseMeta(input.name);
  const meta = input.weightIncrement
    ? { ...inferred, weightIncrement: input.weightIncrement }
    : inferred;
  const midReps = Math.floor((meta.repRange.min + meta.repRange.max) / 2);

  // No usable history (or just deloaded — volume and intensity reset): let the
  // engine open from the baseline, or run the calibration ramp without one.
  if (!input.lastSession || input.lastSession.sets.length === 0 || input.lastSession.wasDeload) {
    const result = autoregulate(
      {
        exercises: [
          {
            name: input.name,
            meta,
            baselineE1rm: input.baselineE1rm,
            bodyweightLbs: input.bodyweightLbs,
            sets: Array.from({ length: BASE_SET_COUNT }, () => ({
              targetReps: midReps,
              targetRir: TARGET_RIR,
            })),
          },
        ],
      },
      [],
      config,
    );
    return result.prescriptions.map((p) => ({
      setNumber: p.setNumber,
      prescribed: {
        reps: p.reps,
        weight: p.weight,
        targetReps: p.reps,
        rationale: p.reason,
        ...(p.amrap ? { amrap: true } : {}),
        ...(input.baselineE1rm == null ? { calibration: true } : {}),
      },
    }));
  }

  const next = planNextSession(
    {
      meta,
      lastSets: input.lastSession.sets,
      e1rmHistory: input.e1rmHistory,
      bodyweightLbs: input.bodyweightLbs,
      targetRir: TARGET_RIR,
    },
    config,
  );

  const sets = [...next.sets];
  if (!next.isDeload) {
    const count = nextSetCount(
      {
        consecutiveEasySessions: input.consecutiveEasySessions,
        weeklyHardSets: input.weeklyHardSetsForGroup,
        baseSetCount: BASE_SET_COUNT,
        currentSetCount: sets.length,
      },
      config,
    );
    while (sets.length < count) sets.push({ ...sets[sets.length - 1] });
  }

  return sets.map((s, i) => ({
    setNumber: i + 1,
    prescribed: {
      reps: s.targetReps,
      weight: s.weight,
      targetReps: s.targetReps,
      ...(i === 0 ? { rationale: next.note } : {}),
      ...(next.isDeload ? { deload: true } : {}),
    },
  }));
}
