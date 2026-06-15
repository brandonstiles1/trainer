import { adaptChain, type AdaptSet, type Actual, type Prescribed } from "@/lib/adapt";

export type StoredSet = {
  id: string;
  setNumber: number;
  prescribed: Prescribed;
  actual: Actual | null;
};

/**
 * Recompute one exercise's sets (ordered by setNumber) via adaptChain and
 * return only the rows whose prescribed changed, so callers persist a minimal diff.
 * `baselineFloor` is the user's pinned weight for this lift (0 if none).
 */
export function recomputeExercise(
  ordered: StoredSet[],
  baselineFloor = 0,
): Array<{ id: string; prescribed: StoredSet["prescribed"] }> {
  const chain: AdaptSet[] = ordered.map((s) => ({ prescribed: s.prescribed, actual: s.actual }));
  const out = adaptChain(chain, baselineFloor);
  const changed: Array<{ id: string; prescribed: StoredSet["prescribed"] }> = [];
  out.forEach((c, i) => {
    const before = ordered[i].prescribed;
    if (
      c.prescribed.weight !== before.weight ||
      c.prescribed.reps !== before.reps ||
      c.prescribed.rationale !== before.rationale
    ) {
      changed.push({ id: ordered[i].id, prescribed: c.prescribed });
    }
  });
  return changed;
}
