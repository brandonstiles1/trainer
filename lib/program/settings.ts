import { DEFAULT_RULES, type ProgressionRules } from "@/lib/engine/double-progression";
import type { ExerciseMeta } from "@/lib/engine/exercise-meta";

/**
 * Everything on the Settings screen that shapes the numbers, stored as one
 * jsonb blob on `profiles.progression`. Unknown or missing keys fall back to
 * the defaults, so the blob can grow without a migration.
 */
export type ProgressionSettings = ProgressionRules & {
  /** Step per dumbbell. 5 → a pair goes up 10 lb total. */
  dumbbellStep: number;
  barbellUpperStep: number;
  barbellLowerStep: number;
  /** Cable stacks and plate-loaded machines. */
  machineUpperStep: number;
  machineLowerStep: number;
  /** Added (or removed assistance) load on pull-ups, dips and the like. */
  bodyweightStep: number;
  restTimer: boolean;
  restCompoundSeconds: number;
  restIsolationSeconds: number;
};

export const DEFAULT_SETTINGS: ProgressionSettings = {
  ...DEFAULT_RULES,
  dumbbellStep: 5,
  barbellUpperStep: 5,
  barbellLowerStep: 10,
  machineUpperStep: 5,
  machineLowerStep: 10,
  bodyweightStep: 5,
  restTimer: true,
  restCompoundSeconds: 105,
  restIsolationSeconds: 75,
};

const LIMITS: { [K in keyof ProgressionSettings]: ProgressionSettings[K] extends number ? [number, number] : null } = {
  successSessions: [1, 5],
  missSessions: [2, 6],
  breakDays: [7, 60],
  dumbbellStep: [1, 10],
  barbellUpperStep: [1, 20],
  barbellLowerStep: [1, 20],
  machineUpperStep: [1, 20],
  machineLowerStep: [1, 20],
  bodyweightStep: [1, 20],
  restTimer: null,
  restCompoundSeconds: [30, 300],
  restIsolationSeconds: [30, 300],
};

/** Read whatever is stored, keeping only valid values and defaulting the rest. */
export function parseSettings(raw: unknown): ProgressionSettings {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof ProgressionSettings)[]) {
    const value = src[key];
    const limit = LIMITS[key];
    if (limit === null) {
      if (typeof value === "boolean") out[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = Math.min(limit[1], Math.max(limit[0], value));
    }
  }
  return out as ProgressionSettings;
}

/**
 * The load step one exercise progresses by. A per-exercise override (set from
 * the exercise's info panel) wins; otherwise it comes from the equipment and
 * whether it's a lower-body compound. Isolation lifts take the equipment's
 * smallest step.
 */
export function incrementFor(
  meta: Pick<ExerciseMeta, "type" | "isCompound" | "isLowerBody">,
  settings: ProgressionSettings,
  override?: number | null,
): number {
  if (override && override > 0) return override;
  const lower = meta.isCompound && meta.isLowerBody;
  switch (meta.type) {
    case "dumbbell":
      return settings.dumbbellStep;
    case "barbell":
      return lower ? settings.barbellLowerStep : settings.barbellUpperStep;
    case "machine":
      return lower ? settings.machineLowerStep : settings.machineUpperStep;
    case "bodyweight":
      return settings.bodyweightStep;
  }
}

export function restFor(meta: Pick<ExerciseMeta, "isCompound">, settings: ProgressionSettings): number {
  return meta.isCompound ? settings.restCompoundSeconds : settings.restIsolationSeconds;
}
