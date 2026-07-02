import type { Feeling } from "@/lib/adapt";
import type { ExerciseType, RepRange } from "./exercise-meta";

export type Feel = "easy" | "medium" | "hard";

export type EngineConfig = {
  /** How a subjective feel rating translates to reps in reserve. */
  feelRir: Record<Feel, number>;
  /** Weight of the newest logged set when blending into the session e1RM. */
  emaAlpha: number;
  fatigue: {
    /** e1RM decay per completed set at RIR ≤ hardRirThreshold. */
    hardSetDecay: number;
    /** e1RM decay per completed set easier than that. */
    easySetDecay: number;
    hardRirThreshold: number;
    /** Decay applied per earlier exercise sharing a muscle-group tag. */
    carryoverDecay: number;
  };
  /** Max set-to-set weight change for PRESCRIPTIONS (logged data is never clamped). */
  clampPct: number;
  /** Implied e1RM this far above baseline triggers recalibration (replace, don't blend). */
  recalibrationThreshold: number;
  readiness: {
    /** Implied e1RM this far below expectation flags a bad day. */
    underperformanceThreshold: number;
    /** Deficit beyond this uses the severe multiplier. */
    severeThreshold: number;
    mildMultiplier: number;
    severeMultiplier: number;
    /** Minor decay applied to the stored baseline on a readiness-flagged day. */
    baselineDecay: number;
  };
  probe: {
    /** Set 1 of each exercise is prescribed slightly conservative by this factor. */
    conservativeFactor: number;
    /** Probe felt easy → boost the rest of the exercise by this fraction. */
    easyBoost: number;
    /** Probe felt hard → cut the rest of the exercise by this fraction. */
    hardCut: number;
  };
  calibration: {
    firstSetReps: number;
    /** Set 2 = set 1 weight × this. */
    rampFactor: number;
    secondSetReps: number;
    /** AMRAP set is prescribed at this fraction of the estimated max. */
    amrapPct: number;
    startWeights: Record<ExerciseType, number>;
  };
  volume: {
    weeklyHardSetCap: number;
    /** A set counts as hard when its feel-implied RIR is ≤ this. */
    hardSetRirThreshold: number;
    /** Consecutive all-reps-hit medium/easy sessions required to add a set. */
    easySessionsToAddSet: number;
    windowDays: number;
  };
  progression: {
    increasePct: number;
    maxIncreasePct: number;
    decreasePct: number;
    /** Flat e1RM across this many sessions → stall breaker. */
    stallSessions: number;
    /** Relative e1RM movement below this counts as flat. */
    stallTolerance: number;
    /** Declining e1RM across this many consecutive sessions → deload. */
    declineSessions: number;
    /** Rep ranges the stall breaker rotates between. */
    stallRepRanges: [RepRange, RepRange];
    /** Bodyweight exercise: reps above this on every set → add load. */
    bodyweightAddLoadReps: number;
    /** Bodyweight exercise: reps below this on 2+ sets → add assistance. */
    bodyweightAssistReps: number;
  };
};

export const defaultEngineConfig: EngineConfig = {
  feelRir: { easy: 4, medium: 2.5, hard: 0.5 },
  emaAlpha: 0.4,
  fatigue: {
    hardSetDecay: 0.03,
    easySetDecay: 0.01,
    hardRirThreshold: 2,
    carryoverDecay: 0.05,
  },
  clampPct: 0.15,
  recalibrationThreshold: 0.1,
  readiness: {
    underperformanceThreshold: 0.15,
    severeThreshold: 0.25,
    mildMultiplier: 0.95,
    severeMultiplier: 0.9,
    baselineDecay: 0.02,
  },
  probe: { conservativeFactor: 0.95, easyBoost: 0.05, hardCut: 0.1 },
  calibration: {
    firstSetReps: 10,
    rampFactor: 1.2,
    secondSetReps: 8,
    amrapPct: 0.7,
    startWeights: { barbell: 45, dumbbell: 15, machine: 30, bodyweight: 0 },
  },
  volume: {
    weeklyHardSetCap: 20,
    hardSetRirThreshold: 3,
    easySessionsToAddSet: 2,
    windowDays: 7,
  },
  progression: {
    increasePct: 0.025,
    maxIncreasePct: 0.05,
    decreasePct: 0.05,
    stallSessions: 3,
    stallTolerance: 0.01,
    declineSessions: 2,
    stallRepRanges: [
      { min: 6, max: 8 },
      { min: 10, max: 12 },
    ],
    bodyweightAddLoadReps: 12,
    bodyweightAssistReps: 6,
  },
};

/** Bridge from the app's logged traffic-light feeling to the engine's feel scale. */
export function feelFromFeeling(feeling: Feeling): Feel {
  switch (feeling) {
    case "green":
      return "easy";
    case "yellow":
      return "medium";
    case "red":
      return "hard";
  }
}
