export type Feeling = "red" | "yellow" | "green";

export type Prescribed = {
  reps: number;
  weight: number;
  branches: {
    under: { threshold_reps: number; next_set: { reps: number; weight: number } };
    on: { next_set: { reps: number; weight: number } };
    over: { threshold_reps: number; next_set: { reps: number; weight: number } };
  };
};

export type Actual = {
  reps: number;
  weight: number;
  feeling: Feeling;
};

type Notch = "under" | "on" | "over";

const order: Notch[] = ["under", "on", "over"];

function pickNotch(actualReps: number, branches: Prescribed["branches"]): Notch {
  if (actualReps < branches.under.threshold_reps) return "under";
  if (actualReps > branches.over.threshold_reps) return "over";
  return "on";
}

function shift(notch: Notch, feeling: Feeling): Notch {
  const idx = order.indexOf(notch);
  if (feeling === "red") return order[Math.max(0, idx - 1)];
  if (feeling === "green") return order[Math.min(order.length - 1, idx + 1)];
  return notch;
}

/**
 * Given the actual result of the current set and the branch structure,
 * return the prescribed reps+weight for the NEXT set.
 */
export function applyBranch(
  actual: Actual,
  branches: Prescribed["branches"],
): { reps: number; weight: number } {
  const notch = shift(pickNotch(actual.reps, branches), actual.feeling);
  return branches[notch].next_set;
}
