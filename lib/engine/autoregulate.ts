import { estimate1RM, weightForReps, roundToStep } from "@/lib/adapt";
import { defaultEngineConfig, type EngineConfig, type Feel } from "./config";
import type { ExerciseMeta, RepRange } from "./exercise-meta";

export type PlannedSet = { targetReps: number; targetRir: number };

export type ExercisePlan = {
  name: string;
  meta: ExerciseMeta;
  sets: PlannedSet[];
  /** Stored baseline e1RM; null → no history, run the calibration ramp. */
  baselineE1rm: number | null;
  /** Required for bodyweight exercises: e1RM math runs on bodyweight + added load. */
  bodyweightLbs?: number;
};

export type DayPlan = { exercises: ExercisePlan[] };

export type CompletedSet = {
  exerciseName: string;
  setNumber: number; // 1-based within the exercise
  /** Added load for bodyweight exercises (negative = assisted). */
  weight: number;
  reps: number;
  feel: Feel;
};

export type SetPrescription = {
  exerciseName: string;
  setNumber: number;
  weight: number;
  reps: number;
  amrap?: boolean;
  reason: string;
};

export type RecalibrationState = { candidateE1rm: number; confirmed: boolean };

export type ExerciseSessionState = {
  name: string;
  /** Working (fresh, un-fatigued) e1RM after all completed sets. Null while calibration is incomplete. */
  sessionE1rm: number | null;
  recalibration: RecalibrationState | null;
  readinessFlagged: boolean;
  /** What to store as the new baseline at session end (null = leave the stored value unchanged). */
  persistE1rm: number | null;
};

export type AutoregulateResult = {
  prescriptions: SetPrescription[];
  /** Session-wide multiplier set by hard underperformance; applies to all remaining work. */
  readinessMultiplier: number;
  exercises: ExerciseSessionState[];
};

const e1rmOf = (weight: number, reps: number, rir: number): number =>
  estimate1RM(weight, reps + rir);
const loadFor = (e1rm: number, reps: number, rir: number): number =>
  weightForReps(e1rm, reps + rir);
const ema = (prev: number, next: number, alpha: number): number =>
  alpha * next + (1 - alpha) * prev;
const clampReps = (reps: number, range: RepRange): number =>
  Math.min(range.max, Math.max(range.min, reps));

/**
 * Deterministic in-workout autoregulation. Given the day's plan and the sets
 * completed so far, prescribe weight/reps for every remaining set with a
 * one-line reason. Pure — no LLM, no I/O; safe to re-run after any edit.
 */
export function autoregulate(
  plan: DayPlan,
  completed: CompletedSet[],
  config: EngineConfig = defaultEngineConfig,
): AutoregulateResult {
  const prescriptions: SetPrescription[] = [];
  const exercises: ExerciseSessionState[] = [];
  let readiness = 1;
  const priorGroups: string[][] = []; // muscle groups of earlier exercises with completed work

  for (const ex of plan.exercises) {
    const done = completed
      .filter((c) => c.exerciseName === ex.name)
      .slice()
      .sort((a, b) => a.setNumber - b.setNumber);
    const carrySources = priorGroups.filter((groups) =>
      groups.some((g) => ex.meta.muscleGroups.includes(g)),
    ).length;
    const carry = Math.pow(1 - config.fatigue.carryoverDecay, carrySources);

    const run =
      ex.baselineE1rm == null
        ? runCalibration(ex, done, readiness, config)
        : runExercise({ ex, baseline: ex.baselineE1rm, done, carry, readinessIn: readiness, config });

    readiness = run.readiness;
    prescriptions.push(...run.prescriptions);
    exercises.push(run.state);
    if (done.length > 0) priorGroups.push(ex.meta.muscleGroups);
  }

  return { prescriptions, readinessMultiplier: readiness, exercises };
}

type RunResult = {
  prescriptions: SetPrescription[];
  state: ExerciseSessionState;
  readiness: number;
};

function runExercise(params: {
  ex: ExercisePlan;
  baseline: number;
  done: CompletedSet[];
  /** Starting fatigue factor (carryover from earlier exercises, or ramp fatigue). */
  carry: number;
  readinessIn: number;
  config: EngineConfig;
  setOffset?: number;
  /** Last logged set before this run's window (used when `done` is empty). */
  prevLogged?: CompletedSet;
}): RunResult {
  const { ex, baseline, done, carry, readinessIn, config } = params;
  const setOffset = params.setOffset ?? 0;
  const prevLogged = params.prevLogged ?? null;
  const { feelRir, fatigue, readiness: rd, probe } = config;
  const bw = ex.meta.type === "bodyweight" ? (ex.bodyweightLbs ?? 0) : 0;
  const inc = ex.meta.weightIncrement;

  let fresh = baseline;
  let fatigueFactor = carry;
  let readiness = readinessIn;
  let probeMult = 1;
  let recal: RecalibrationState | null = null;
  let readinessFlagged = false;

  for (let i = 0; i < done.length; i++) {
    const s = done[i];
    const rir = feelRir[s.feel];
    // Logged data is ground truth — the implied e1RM is never clamped or reinterpreted.
    const implied = e1rmOf(bw + s.weight, s.reps, rir);

    if (recal && !recal.confirmed) {
      if (s.feel === "easy") {
        // Confirmation came back easy too → the replacement was also wrong; replace again.
        recal = { candidateE1rm: implied, confirmed: false };
        fresh = implied;
      } else {
        recal = { candidateE1rm: recal.candidateE1rm, confirmed: true };
        fresh = ema(fresh, implied, config.emaAlpha);
      }
    } else if (implied > baseline * (1 + config.recalibrationThreshold)) {
      // Baseline was wrong, not noisy — replace it and require a confirming set.
      recal = { candidateE1rm: implied, confirmed: false };
      fresh = implied;
    } else {
      const expected = fresh * fatigueFactor * probeMult * readiness;
      if (implied < expected * (1 - rd.underperformanceThreshold)) {
        const deficit = 1 - implied / expected;
        readiness = Math.min(
          readiness,
          deficit > rd.severeThreshold ? rd.severeMultiplier : rd.mildMultiplier,
        );
        readinessFlagged = true;
        fresh *= 1 - rd.baselineDecay; // one bad day barely moves the stored number
      } else {
        fresh = ema(fresh, implied, config.emaAlpha);
      }
    }

    if (i === 0 && setOffset === 0) {
      // Set 1 is the readiness probe: its feel adjusts the rest of this exercise.
      if (s.feel === "easy") probeMult = 1 + probe.easyBoost;
      else if (s.feel === "hard") probeMult = 1 - probe.hardCut;
    }
    fatigueFactor *=
      1 - (rir <= fatigue.hardRirThreshold ? fatigue.hardSetDecay : fatigue.easySetDecay);
  }

  const prescriptions: SetPrescription[] = [];
  const last = done[done.length - 1] ?? prevLogged;
  let refTotal = last ? bw + last.weight : null;
  let projFactor = fatigueFactor;

  for (let j = done.length; j < ex.sets.length; j++) {
    const planned = ex.sets[j];
    let reps = clampReps(planned.targetReps, ex.meta.repRange);
    const isConfirmation = recal !== null && !recal.confirmed && j === done.length && last !== null;
    let weight: number;
    let reason: string;
    let rir = planned.targetRir;

    if (isConfirmation && recal && last) {
      // Unclamped confirmation set straight from the new e1RM at RIR 2.
      rir = 2;
      const totalRaw = loadFor(fresh * projFactor, reps, rir);
      weight = boundAdded(roundToStep(totalRaw - bw, inc), ex.meta);
      reason = `${last.weight}×${last.reps} felt ${last.feel}, suggesting ~${Math.round(
        recal.candidateE1rm,
      )} max. Confirm with ${weight}×${reps} (leaving 2–3 reps) before we save it.`;
    } else {
      let target = fresh * projFactor * probeMult * readiness;
      if (j === 0 && setOffset === 0) target *= probe.conservativeFactor;
      const totalRaw = target / (1 + (reps + rir) / 30);
      weight = boundAdded(prescribeWithinBand(totalRaw, refTotal, bw, inc, config.clampPct), ex.meta);
      // Coarse increments can round the load back up past the target (or a
      // needed cut can round to no change at all); trim reps so the set still
      // lands near the intended RIR instead of silently getting harder.
      const total = bw + weight;
      if (total > 0) {
        const achievable = Math.round(30 * (target / total - 1) - rir);
        if (achievable < reps) reps = clampReps(achievable, ex.meta.repRange);
      }
      const rirLabel =
        rir === 0.5 ? "0–1 reps (very close to max)" : rir <= 2.5 ? "2–3 reps" : "4+ reps";
      const readinessNote = readiness < 1 ? ` You're a bit fatigued today.` : "";
      reason = last
        ? `${last.weight}×${last.reps} felt ${last.feel}. Your estimated max: ~${Math.round(
            fresh,
          )} lbs. So ${weight}×${reps} should leave ${rirLabel} for next time.${readinessNote}`
        : `Starting at ~${Math.round(
            baseline,
          )} lbs max. This first set is slightly conservative: ${weight}×${reps}, leaving ${rirLabel}.${readinessNote}`;
    }

    prescriptions.push({ exerciseName: ex.name, setNumber: setOffset + j + 1, weight, reps, reason });
    refTotal = bw + weight;
    projFactor *=
      1 - (rir <= fatigue.hardRirThreshold ? fatigue.hardSetDecay : fatigue.easySetDecay);
  }

  const persistE1rm =
    recal && !recal.confirmed
      ? baseline
      : readinessFlagged
        ? baseline * (1 - rd.baselineDecay)
        : fresh;

  return {
    prescriptions,
    readiness,
    state: { name: ex.name, sessionE1rm: fresh, recalibration: recal, readinessFlagged, persistE1rm },
  };
}

/**
 * Round the added load to the exercise's increment, keeping the TOTAL weight
 * within ±clampPct of the previous set's total. Rounding may land just outside
 * the band; nudge one increment back toward it. Prescriptions only — logged
 * sets never pass through here.
 */
function prescribeWithinBand(
  rawTotal: number,
  refTotal: number | null,
  bw: number,
  inc: number,
  clampPct: number,
): number {
  if (refTotal == null || refTotal <= 0) return roundToStep(rawTotal - bw, inc);
  const lo = refTotal * (1 - clampPct);
  const hi = refTotal * (1 + clampPct);
  let added = roundToStep(Math.min(hi, Math.max(lo, rawTotal)) - bw, inc);
  if (bw + added > hi) added -= inc;
  else if (bw + added < lo) added += inc;
  return added;
}

/** Bodyweight exercises may prescribe negative added load (assisted); others floor at 0. */
function boundAdded(added: number, meta: ExerciseMeta): number {
  return meta.type === "bodyweight" ? added : Math.max(0, added);
}

/**
 * No stored e1RM → calibration ramp: light × 10 (expect easy), +20% × 8, then
 * AMRAP at ~70% of the estimated max. The AMRAP seeds the baseline; any planned
 * sets beyond the ramp run through the normal engine from that seed.
 */
function runCalibration(
  ex: ExercisePlan,
  done: CompletedSet[],
  readinessIn: number,
  config: EngineConfig,
): RunResult {
  const cal = config.calibration;
  const { feelRir, fatigue } = config;
  const bw = ex.meta.type === "bodyweight" ? (ex.bodyweightLbs ?? 0) : 0;
  const inc = ex.meta.weightIncrement;
  const prescriptions: SetPrescription[] = [];

  const start = cal.startWeights[ex.meta.type];
  const set1W = done[0]?.weight ?? start;

  if (done.length === 0) {
    prescriptions.push({
      exerciseName: ex.name,
      setNumber: 1,
      weight: start,
      reps: cal.firstSetReps,
      reason: `No baseline — calibration set 1: light ${start}×${cal.firstSetReps}, should feel easy`,
    });
  }
  if (done.length <= 1) {
    const w = roundToStep(set1W * cal.rampFactor, inc);
    prescriptions.push({
      exerciseName: ex.name,
      setNumber: 2,
      weight: w,
      reps: cal.secondSetReps,
      reason: `Calibration ramp: +${Math.round((cal.rampFactor - 1) * 100)}% → ${w}×${cal.secondSetReps}`,
    });
  }
  if (done.length <= 2) {
    const est = done[1]
      ? e1rmOf(bw + done[1].weight, done[1].reps, feelRir[done[1].feel])
      : e1rmOf(bw + roundToStep(set1W * cal.rampFactor, inc), cal.secondSetReps, feelRir.medium);
    const w = roundToStep(cal.amrapPct * est - bw, inc);
    const expectedReps = Math.max(1, Math.round(30 * (est / Math.max(1, bw + w) - 1)));
    prescriptions.push({
      exerciseName: ex.name,
      setNumber: 3,
      weight: w,
      reps: expectedReps,
      amrap: true,
      reason: `AMRAP at ~${Math.round(cal.amrapPct * 100)}% of est. max (~${Math.round(
        est,
      )}) — go to the last clean rep to seed your baseline`,
    });
  }

  if (done.length < 3) {
    return {
      prescriptions,
      readiness: readinessIn,
      state: {
        name: ex.name,
        sessionE1rm: null,
        recalibration: null,
        readinessFlagged: false,
        persistE1rm: null,
      },
    };
  }

  const amrap = done[2];
  const seed = e1rmOf(bw + amrap.weight, amrap.reps, 0); // AMRAP → nothing in reserve
  const rampFatigue = done.slice(0, 3).reduce((f, s, i) => {
    const rir = i === 2 ? 0 : feelRir[s.feel];
    return f * (1 - (rir <= fatigue.hardRirThreshold ? fatigue.hardSetDecay : fatigue.easySetDecay));
  }, 1);

  if (ex.sets.length <= 3) {
    return {
      prescriptions,
      readiness: readinessIn,
      state: {
        name: ex.name,
        sessionE1rm: seed,
        recalibration: null,
        readinessFlagged: false,
        persistE1rm: seed,
      },
    };
  }

  const tail = runExercise({
    ex: { ...ex, sets: ex.sets.slice(3) },
    baseline: seed,
    done: done.slice(3),
    carry: rampFatigue,
    readinessIn,
    config,
    setOffset: 3,
    prevLogged: amrap,
  });
  return {
    prescriptions: [...prescriptions, ...tail.prescriptions],
    readiness: tail.readiness,
    state: { ...tail.state, persistE1rm: tail.state.persistE1rm ?? seed },
  };
}
