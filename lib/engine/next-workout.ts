import { weightForReps, roundToStep } from "@/lib/adapt";
import { defaultEngineConfig, type EngineConfig } from "./config";
import type { Feel } from "./config";
import type { ExerciseMeta, RepRange } from "./exercise-meta";

export type SessionSetLog = {
  prescribedReps: number;
  /** Logged (added load for bodyweight). Ground truth — never reinterpreted. */
  weight: number;
  reps: number;
  feel: Feel;
};

export type NextSetPlan = { weight: number; targetReps: number; targetRir: number };

export type NextOutcome =
  | "increase_load" // (a) all sets at top of range with RIR ≥ 2
  | "add_rep" // (b) targets hit mid-range
  | "consolidate" // (c) targets hit but RIR ≤ 1 on most sets
  | "back_off" // (d) missed reps on 2+ sets
  | "repeat" // (d) on a readiness-flagged day, or a single missed set
  | "stall_breaker" // (e) e1RM flat across 3 sessions
  | "deload" // (f) e1RM declining 2 consecutive sessions
  | "add_bodyweight_load"
  | "add_assistance";

export type NextPrescription = {
  outcome: NextOutcome;
  isDeload: boolean;
  repRange: RepRange;
  sets: NextSetPlan[];
  note: string;
};

/**
 * Deterministic next-session prescription from the session just finished.
 * Classification order: deload trigger, stall breaker, then per-set outcomes.
 */
export function planNextSession(
  input: {
    meta: ExerciseMeta;
    lastSets: SessionSetLog[];
    /** Session-final e1RMs, oldest → newest, including the session just finished. */
    e1rmHistory: number[];
    readinessFlagged?: boolean;
    bodyweightLbs?: number;
    targetRir?: number;
  },
  config: EngineConfig = defaultEngineConfig,
): NextPrescription {
  const { meta, lastSets, e1rmHistory } = input;
  const p = config.progression;
  const rir = input.targetRir ?? 2;
  const inc = meta.weightIncrement;
  const bw = meta.type === "bodyweight" ? (input.bodyweightLbs ?? 0) : 0;
  const rirOf = (feel: Feel) => config.feelRir[feel];

  if (isDeclining(e1rmHistory, p.declineSessions, p.stallTolerance)) {
    const half = Math.max(1, Math.floor(lastSets.length / 2));
    return {
      outcome: "deload",
      isDeload: true,
      repRange: meta.repRange,
      sets: lastSets
        .slice(0, half)
        .map((s) => ({ weight: s.weight, targetReps: s.prescribedReps, targetRir: rir })),
      note: `Est. max declined ${p.declineSessions} sessions straight — deload: same loads, half the sets, then resume.`,
    };
  }

  if (isFlat(e1rmHistory, p.stallSessions, p.stallTolerance)) {
    const [low, high] = p.stallRepRanges;
    const rotated = meta.repRange.min >= high.min ? low : high;
    const latest = e1rmHistory[e1rmHistory.length - 1];
    const weight = roundToStep(weightForReps(latest, rotated.min + rir) - bw, inc);
    return {
      outcome: "stall_breaker",
      isDeload: false,
      repRange: rotated,
      sets: lastSets.map(() => ({ weight, targetReps: rotated.min, targetRir: rir })),
      note: `Est. max flat across ${p.stallSessions} sessions — rotating to ${rotated.min}–${rotated.max} reps to break the stall.`,
    };
  }

  const missed = lastSets.filter((s) => s.reps < s.prescribedReps).length;
  const targetsHit = missed === 0;
  const sameSets = (): NextSetPlan[] =>
    lastSets.map((s) => ({ weight: s.weight, targetReps: s.prescribedReps, targetRir: rir }));

  if (meta.type === "bodyweight") {
    if (lastSets.length > 0 && lastSets.every((s) => s.reps > p.bodyweightAddLoadReps)) {
      return {
        outcome: "add_bodyweight_load",
        isDeload: false,
        repRange: meta.repRange,
        sets: lastSets.map((s) => ({
          weight: s.weight + inc,
          targetReps: meta.repRange.min,
          targetRir: rir,
        })),
        note: `Every set beat ${p.bodyweightAddLoadReps} reps — add ${inc} lb and restart at ${meta.repRange.min} reps.`,
      };
    }
    if (lastSets.filter((s) => s.reps < p.bodyweightAssistReps).length >= 2) {
      return {
        outcome: "add_assistance",
        isDeload: false,
        repRange: meta.repRange,
        sets: lastSets.map((s) => ({
          weight: s.weight - inc,
          targetReps: s.prescribedReps,
          targetRir: rir,
        })),
        note: `Reps fell under ${p.bodyweightAssistReps} on 2+ sets — add ${inc} lb of assistance.`,
      };
    }
  }

  if (missed >= 2) {
    if (input.readinessFlagged) {
      return {
        outcome: "repeat",
        isDeload: false,
        repRange: meta.repRange,
        sets: sameSets(),
        note: "Missed reps on a readiness-flagged day — repeating the prescription; one bad day doesn't erase strength.",
      };
    }
    return {
      outcome: "back_off",
      isDeload: false,
      repRange: meta.repRange,
      sets: lastSets.map((s) => ({
        weight: decreasedLoad(s.weight, inc, p.decreasePct),
        targetReps: s.prescribedReps,
        targetRir: rir,
      })),
      note: `Missed reps on ${missed} sets — same reps at −${Math.round(p.decreasePct * 100)}% load.`,
    };
  }

  if (
    targetsHit &&
    lastSets.length > 0 &&
    lastSets.every((s) => s.reps >= meta.repRange.max && rirOf(s.feel) >= 2)
  ) {
    return {
      outcome: "increase_load",
      isDeload: false,
      repRange: meta.repRange,
      sets: lastSets.map((s) => ({
        weight: increasedLoad(s.weight, inc, p.increasePct, p.maxIncreasePct),
        targetReps: meta.repRange.min,
        targetRir: rir,
      })),
      note: `Top of the rep range with ≥2 in reserve on every set — load up, back to ${meta.repRange.min} reps.`,
    };
  }

  if (targetsHit && lastSets.filter((s) => rirOf(s.feel) <= 1).length > lastSets.length / 2) {
    return {
      outcome: "consolidate",
      isDeload: false,
      repRange: meta.repRange,
      sets: sameSets(),
      note: "Targets hit but most sets were near failure — repeat and consolidate before progressing.",
    };
  }

  if (targetsHit && lastSets.length > 0) {
    return {
      outcome: "add_rep",
      isDeload: false,
      repRange: meta.repRange,
      sets: lastSets.map((s) => ({
        weight: s.weight,
        targetReps: Math.min(meta.repRange.max, s.prescribedReps + 1),
        targetRir: rir,
      })),
      note: "Targets hit mid-range — same load, one more rep per set.",
    };
  }

  return {
    outcome: "repeat",
    isDeload: false,
    repRange: meta.repRange,
    sets: sameSets(),
    note: "Close but not clean — repeating the prescription.",
  };
}

/** Every one of the last `n` session-to-session deltas is a material drop. */
function isDeclining(history: number[], n: number, tolerance: number): boolean {
  if (history.length < n + 1) return false;
  for (let i = history.length - n; i < history.length; i++) {
    if (history[i] >= history[i - 1] * (1 - tolerance)) return false;
  }
  return true;
}

/** The last `n` e1RMs moved less than `tolerance` relative to their mean. */
function isFlat(history: number[], n: number, tolerance: number): boolean {
  if (history.length < n) return false;
  const window = history.slice(-n);
  const mean = window.reduce((a, b) => a + b, 0) / n;
  return mean > 0 && (Math.max(...window) - Math.min(...window)) / mean <= tolerance;
}

/** +2.5–5%, but always at least one physical increment. */
function increasedLoad(weight: number, inc: number, pct: number, maxPct: number): number {
  const target = roundToStep(weight * (1 + pct), inc);
  const capped = Math.min(target, roundToStep(weight * (1 + maxPct), inc));
  return Math.max(capped, weight + inc);
}

/** −5%, but always at least one physical increment down (floored at 0). */
function decreasedLoad(weight: number, inc: number, pct: number): number {
  const target = roundToStep(weight * (1 - pct), inc);
  return target >= weight ? Math.max(0, weight - inc) : target;
}
