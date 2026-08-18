import type { Feel } from "./feel";
import type { ExerciseMeta, RepRange } from "./exercise-meta";

/** One set as it was actually performed, alongside the target it was chasing. */
export type LoggedSet = {
  /** What the log book asked for. */
  targetReps: number;
  /** Logged load (added load for bodyweight exercises). */
  weight: number;
  reps: number;
  feel: Feel;
};

export type TargetSet = { weight: number; targetReps: number };

export type ProgressionOutcome =
  /** Every set met its target — same load, one more rep. */
  | "add_rep"
  /** Topped out the rep range — one weight step up, back to the bottom of the range. */
  | "add_weight"
  /** A set came up short — run the same targets again. */
  | "hold_missed"
  /** Reps all hit, but it was a grind on most sets — bank it before pushing. */
  | "hold_hard";

export type ProgressionResult = {
  outcome: ProgressionOutcome;
  sets: TargetSet[];
  /** One line for the exercise card: what happened last time and what changed. */
  note: string;
};

export type ProgressionInput = {
  /** Last session's logged sets for this exercise, in set order. Skipped sets excluded. */
  lastSets: LoggedSet[];
  /**
   * Sets the exercise carried last session, skipped ones included. Defaults to
   * the number of logged sets; anything above that is padded from the last set
   * so a skipped set doesn't shrink the exercise.
   */
  plannedSets?: number;
  repRange: RepRange;
  weightIncrement: number;
  /** Bodyweight exercises may carry negative added load (assisted); others floor at 0. */
  allowNegativeWeight?: boolean;
  /**
   * How many sessions in a row this exercise has already held the same target
   * (not counting the one being planned). At 2+ the note stops nudging and
   * starts suggesting a way out.
   */
  priorHolds?: number;
};

/** Two or more grinding sets is enough to bank the session instead of pushing. */
const HARD_SETS_TO_HOLD = 2;

/**
 * The whole progression rule, in one pure function.
 *
 * Last session's sets carry forward as-is — position for position, load for
 * load. They only move when the session was clean: every set at or above its
 * target. Then reps climb one at a time to the top of the range, and the next
 * clean session there buys a weight step and a reset to the bottom.
 *
 * Overshooting counts. Three sets of 10 against a target of 8 means the next
 * target is 11, not 9 — the log is the truth, and it doesn't walk you backwards.
 */
export function planNextTargets(input: ProgressionInput): ProgressionResult {
  const { lastSets, repRange, weightIncrement: inc } = input;
  if (lastSets.length === 0)
    throw new Error("planNextTargets needs at least one logged set — use openingTargets instead");
  const holds = input.priorHolds ?? 0;

  const carried: TargetSet[] = lastSets.map((s) => ({
    weight: s.weight,
    targetReps: s.targetReps,
  }));
  // A set that was skipped rather than logged still holds its slot, opening at
  // whatever the set before it was doing.
  while (carried.length < (input.plannedSets ?? 0)) {
    carried.push({ ...carried[carried.length - 1] });
  }
  // Targets are uniform across sets in practice; the max is the honest read of
  // "what was this session asking for" when they aren't.
  const target = Math.max(...lastSets.map((s) => s.targetReps));
  const holdAt = (): TargetSet[] => carried.map((s) => ({ ...s, targetReps: target }));

  const missed = lastSets.filter((s) => s.reps < s.targetReps).length;
  if (missed > 0) {
    const shortfall = `${missed} of ${lastSets.length} set${lastSets.length === 1 ? "" : "s"}`;
    return {
      outcome: "hold_missed",
      sets: holdAt(),
      note:
        holds >= 2
          ? `Short on ${shortfall} again — ${holds + 1} sessions stuck here. Worth dropping to ${dropWeight(lastSets, inc, input.allowNegativeWeight)} lbs and building back.`
          : `Short on ${shortfall} last time — same targets again.`,
    };
  }

  const hard = lastSets.filter((s) => s.feel === "hard").length;
  if (hard >= HARD_SETS_TO_HOLD) {
    return {
      outcome: "hold_hard",
      sets: holdAt(),
      note: `All reps hit, but ${hard} sets were a grind — holding at ${target} to bank it.`,
    };
  }

  // Clean session. Meet the reps that were actually done, then take one more.
  const achieved = Math.min(...lastSets.map((s) => s.reps));
  const next = Math.max(target, achieved) + 1;

  if (next <= repRange.max) {
    return {
      outcome: "add_rep",
      sets: carried.map((s) => ({ ...s, targetReps: next })),
      note: `Hit all ${lastSets.length} sets at ${achieved}${achieved > target ? "+" : ""} — going for ${next} today.`,
    };
  }

  return {
    outcome: "add_weight",
    sets: carried.map((s) => ({
      weight: bumpWeight(s.weight, inc, input.allowNegativeWeight),
      targetReps: repRange.min,
    })),
    note: `Topped out at ${achieved} reps — +${inc} lbs, back to ${repRange.min}.`,
  };
}

/**
 * Load carries forward exactly as logged, so a bump is one step on top of the
 * user's own number rather than a snap onto a grid they never used.
 */
function bumpWeight(weight: number, inc: number, allowNegative?: boolean): number {
  const next = weight + inc;
  return allowNegative ? next : Math.max(0, next);
}

/** Suggested regression load for a stuck exercise: one step below the lightest set. */
function dropWeight(sets: LoggedSet[], inc: number, allowNegative?: boolean): number {
  const lightest = Math.min(...sets.map((s) => s.weight));
  const dropped = lightest - inc;
  return allowNegative ? dropped : Math.max(0, dropped);
}

/**
 * Opening targets for an exercise with no logged history: the plan's set count
 * at the bottom of the rep range, with a load the user has to fill in (or that
 * we seed from what they told us during onboarding).
 */
export function openingTargets(input: {
  meta: ExerciseMeta;
  setCount: number;
  /** Seed load from an onboarding lift estimate, if there is one. */
  seedWeight?: number;
}): ProgressionResult {
  const weight = Math.max(0, Math.round(input.seedWeight ?? 0));
  return {
    outcome: "add_rep",
    sets: Array.from({ length: input.setCount }, () => ({
      weight,
      targetReps: input.meta.repRange.min,
    })),
    note: input.seedWeight
      ? `First time logging this — starting from the numbers you gave at signup. Change them to whatever you actually lift.`
      : `First time logging this — put in what you lift and it'll grow from there.`,
  };
}
