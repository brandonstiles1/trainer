import type { RepRange } from "./exercise-meta";

/**
 * Double progression, as one pure function.
 *
 * Each exercise has a rep range. Weight stays put while reps climb inside it;
 * once every prescribed set reaches the top of the range for N sessions in a
 * row (default two), the weight goes up one step and the target drops back to
 * the bottom. Repeatedly missing the bottom of the range suggests a step down.
 *
 * Only *complete* sessions count — every prescribed set logged, from a workout
 * that was actually finished. Incomplete sessions neither earn progress nor
 * break a streak; they're invisible to the rule. Time passing never adds
 * weight. Weights are whatever the user logs: for dumbbells that's per
 * dumbbell, so a 5 lb step on a pair is 10 lb total.
 */

export type LoggedSet = { weight: number; reps: number };

export type SessionLog = {
  finishedAt: Date;
  /** Every prescribed working set for this exercise was logged with real numbers. */
  complete: boolean;
  /** Logged working sets, in set order. Skipped sets are not here. */
  sets: LoggedSet[];
};

export type ProgressionRules = {
  /** Consecutive top-of-range sessions needed to earn a weight step. */
  successSessions: number;
  /** Consecutive below-range sessions before a step down is suggested. */
  missSessions: number;
  /** A gap longer than this many days suggests easing back in. */
  breakDays: number;
};

export const DEFAULT_RULES: ProgressionRules = {
  successSessions: 2,
  missSessions: 3,
  breakDays: 14,
};

export type RecommendInput = {
  /** This exercise's sessions, newest first. Complete and incomplete alike. */
  sessions: SessionLog[];
  setCount: number;
  repRange: RepRange;
  /** Load step for this exercise (per dumbbell for dumbbell lifts). */
  increment: number;
  /** Assisted bodyweight lifts log negative load; everything else floors at 0. */
  allowNegative?: boolean;
  rules?: ProgressionRules;
  now: Date;
  /** Opening load for an exercise with no history at all. */
  seedWeight?: number;
};

export type RecommendAction =
  /** No history yet — log what you lift. */
  | "start"
  /** Earned a weight step. */
  | "increase"
  /** Keep the weight; chase more reps. */
  | "hold"
  /** Stuck below the range — a step down is suggested. */
  | "decrease"
  /** First session after a long break — eased back. */
  | "ease_back";

export type Recommendation = {
  action: RecommendAction;
  /** Recommended load for every set. */
  weight: number;
  /** The working weight it's based on, or null when there's no usable history. */
  baseWeight: number | null;
  /** Per-set targets, prefilled into the log. */
  sets: Array<{ weight: number; targetReps: number }>;
  /** Consecutive complete sessions at the top of the range, at the base weight. */
  successStreak: number;
  /** Consecutive complete sessions below the range, at the base weight. */
  missStreak: number;
  /** One line for the card. */
  reason: string;
};

/** The weight a session was "at": its lightest working set, so a drop set can't inflate it. */
export function workingWeight(sets: LoggedSet[]): number {
  return Math.min(...sets.map((s) => s.weight));
}

const isValid = (s: LoggedSet) =>
  Number.isFinite(s.weight) && Number.isFinite(s.reps) && s.reps >= 0;

/** A session progression may read: complete, non-empty, every number real. */
export function qualifies(session: SessionLog): boolean {
  return session.complete && session.sets.length > 0 && session.sets.every(isValid);
}

const hitTop = (s: SessionLog, range: RepRange) => s.sets.every((set) => set.reps >= range.max);
const missedBottom = (s: SessionLog, range: RepRange) => s.sets.some((set) => set.reps < range.min);

/** How many sessions in a row, newest first, satisfy `test` at `weight`. */
function streak(
  sessions: SessionLog[],
  weight: number,
  test: (s: SessionLog) => boolean,
): number {
  let n = 0;
  for (const s of sessions) {
    if (workingWeight(s.sets) !== weight || !test(s)) break;
    n++;
  }
  return n;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

const floorAt = (w: number, allowNegative?: boolean) => (allowNegative ? w : Math.max(0, w));

/** Round down onto the increment grid (used when easing back after a break). */
function roundDown(weight: number, step: number): number {
  if (step <= 0) return weight;
  return Math.floor(weight / step + 1e-9) * step;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const fmt = (w: number) => `${Number.isInteger(w) ? w : w.toFixed(1)} lb`;

export function recommendNext(input: RecommendInput): Recommendation {
  const rules = input.rules ?? DEFAULT_RULES;
  const { repRange: range, increment: inc, setCount } = input;
  const uniform = (weight: number, reps: number) =>
    Array.from({ length: setCount }, () => ({ weight, targetReps: reps }));

  const usable = input.sessions.filter(qualifies);
  const latestAny = input.sessions.find((s) => s.sets.length > 0 && s.sets.every(isValid));

  if (usable.length === 0) {
    if (latestAny) {
      // Only incomplete sessions so far: repeat the load, don't judge it.
      const w = workingWeight(latestAny.sets);
      return {
        action: "hold",
        weight: w,
        baseWeight: null,
        sets: uniform(w, range.min),
        successStreak: 0,
        missStreak: 0,
        reason: `Last session wasn't complete, so it doesn't count yet — finish all ${setCount} sets at ${fmt(w)}.`,
      };
    }
    const w = floorAt(Math.round(input.seedWeight ?? 0), input.allowNegative);
    return {
      action: "start",
      weight: w,
      baseWeight: null,
      sets: uniform(w, range.min),
      successStreak: 0,
      missStreak: 0,
      reason: "First time — log what you lift and the app takes it from there.",
    };
  }

  const last = usable[0];
  const base = workingWeight(last.sets);
  const successStreak = streak(usable, base, (s) => hitTop(s, range));
  const missStreak = streak(usable, base, (s) => missedBottom(s, range));

  // A long break eases you back in, whatever the streaks say. Nothing resets:
  // log the lighter weight and the rule simply continues from there.
  const newest = input.sessions[0]?.finishedAt ?? last.finishedAt;
  const daysAway = Math.floor((input.now.getTime() - newest.getTime()) / 86_400_000);
  if (daysAway > rules.breakDays && base > 0) {
    const eased = floorAt(Math.min(base - inc, roundDown(base * 0.9, inc)), input.allowNegative);
    return {
      action: "ease_back",
      weight: eased,
      baseWeight: base,
      sets: uniform(eased, range.min),
      successStreak,
      missStreak,
      reason: `${plural(Math.round(daysAway / 7), "week")} since you last trained this — eased back to ${fmt(eased)}. Bump it up if it feels light.`,
    };
  }

  if (successStreak >= rules.successSessions) {
    const next = floorAt(base + inc, input.allowNegative);
    return {
      action: "increase",
      weight: next,
      baseWeight: base,
      sets: uniform(next, range.min),
      successStreak,
      missStreak,
      reason: `${range.max}+ reps on every set ${successStreak} sessions running — up to ${fmt(next)}, back to ${range.min} reps.`,
    };
  }

  if (missStreak >= rules.missSessions) {
    const next = floorAt(base - inc, input.allowNegative);
    return {
      action: "decrease",
      weight: next,
      baseWeight: base,
      sets: uniform(next, range.min),
      successStreak,
      missStreak,
      reason: `Under ${range.min} reps ${missStreak} sessions running — try ${fmt(next)} and build back up. Keep ${fmt(base)} if you'd rather.`,
    };
  }

  // Hold the weight; each set chases one more rep than last time, inside the range.
  const sets = Array.from({ length: setCount }, (_, i) => {
    const prev = last.sets[Math.min(i, last.sets.length - 1)];
    return { weight: base, targetReps: clamp(prev.reps + 1, range.min, range.max) };
  });
  const remaining = rules.successSessions - successStreak;
  const reason =
    successStreak > 0
      ? `Topped out last time. ${plural(remaining, "more session")} at ${range.max} on every set earns ${fmt(base + inc)}.`
      : missStreak > 0
        ? `Below ${range.min} last time — same weight, aim for ${range.min}+ on every set.`
        : `Same weight — get every set to ${range.max} reps, ${plural(rules.successSessions, "session")} in a row, to move up.`;

  return { action: "hold", weight: base, baseWeight: base, sets, successStreak, missStreak, reason };
}
