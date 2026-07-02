import { defaultEngineConfig, type EngineConfig, type Feel } from "./config";

export type LoggedSetForVolume = {
  muscleGroups: string[];
  feel: Feel;
  completedAt: Date;
};

/**
 * Rolling hard-set count (feel-implied RIR ≤ threshold) per muscle group over
 * the config window. A set tagged with several groups counts toward each.
 */
export function weeklyHardSets(
  sets: LoggedSetForVolume[],
  now: Date,
  config: EngineConfig = defaultEngineConfig,
): Map<string, number> {
  const cutoff = now.getTime() - config.volume.windowDays * 86_400_000;
  const counts = new Map<string, number>();
  for (const s of sets) {
    if (s.completedAt.getTime() < cutoff) continue;
    if (config.feelRir[s.feel] > config.volume.hardSetRirThreshold) continue;
    for (const g of s.muscleGroups) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  return counts;
}

export type SessionForVolume = {
  sets: Array<{ reps: number; prescribedReps: number; feel: Feel }>;
};

/** All reps hit and nothing rated hard — the session that earns an extra set. */
export function isEasySession(session: SessionForVolume): boolean {
  return (
    session.sets.length > 0 &&
    session.sets.every((s) => s.reps >= s.prescribedReps && s.feel !== "hard")
  );
}

/**
 * Volume autoregulation for one exercise: add a set after enough consecutive
 * easy sessions while its muscle group is under the weekly cap; reset to the
 * base count after a deload. Never pushes a group past the cap.
 */
export function nextSetCount(
  input: {
    consecutiveEasySessions: number;
    /** Highest weekly hard-set count across the exercise's muscle groups. */
    weeklyHardSets: number;
    baseSetCount: number;
    currentSetCount: number;
    afterDeload?: boolean;
  },
  config: EngineConfig = defaultEngineConfig,
): number {
  const { volume } = config;
  if (input.afterDeload) return input.baseSetCount;
  if (
    input.consecutiveEasySessions >= volume.easySessionsToAddSet &&
    input.weeklyHardSets < volume.weeklyHardSetCap
  ) {
    return input.currentSetCount + 1;
  }
  return input.currentSetCount;
}
