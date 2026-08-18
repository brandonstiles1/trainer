/** The bits of a set this rule needs, on the server row or the client's copy. */
export type CarryCandidate = {
  id: string;
  exerciseName: string;
  setNumber: number;
  /** True once logged or skipped — resolved sets are never rewritten. */
  resolved: boolean;
  targetWeight: number;
};

/**
 * Change the load on one set and the rest of the exercise follows.
 *
 * With the autoregulation engine gone nothing re-derives the later sets, so a
 * set logged at a different weight than it asked for would otherwise leave the
 * remaining sets pointing at a load the user has already moved off. Rep targets
 * stay put — coming up a rep short doesn't lower what you're chasing — but the
 * bar is the bar.
 *
 * Returns the ids of the later, still-unlogged sets of the same exercise that
 * should move to `weight`; empty when nothing needs to change.
 */
export function setsToCarryWeight(
  sets: CarryCandidate[],
  logged: { exerciseName: string; setNumber: number; weight: number },
): string[] {
  return sets
    .filter(
      (s) =>
        !s.resolved &&
        s.exerciseName === logged.exerciseName &&
        s.setNumber > logged.setNumber &&
        s.targetWeight !== logged.weight,
    )
    .map((s) => s.id);
}
