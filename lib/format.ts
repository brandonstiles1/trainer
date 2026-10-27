/** mm:ss, or h:mm:ss once we cross an hour. Used for the rest timer and the
 *  total-workout elapsed clock. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
}

export const titleCase = (s: string) =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * A load as the lifter thinks of it. Dumbbells are per dumbbell ("55 lb each");
 * bodyweight lifts read as added load or assistance ("BW", "BW +10", "BW −40").
 */
export function formatWeight(weight: number, equipment?: string): string {
  if (equipment === "bodyweight") {
    if (weight === 0) return "BW";
    return `BW ${weight > 0 ? "+" : "−"}${num(Math.abs(weight))}`;
  }
  return `${num(weight)} lb${equipment === "dumbbell" ? " each" : ""}`;
}

/** The size of a step, spelling out the pair total for dumbbells. */
export function formatStep(step: number, equipment?: string): string {
  return equipment === "dumbbell"
    ? `+${num(step)} lb per dumbbell (${num(step * 2)} lb total)`
    : `+${num(step)} lb`;
}

/** "50 × 10, 10, 9" when every set shares a weight, else "50×10 · 45×9". */
export function formatSets(sets: Array<{ weight: number; reps: number }>, equipment?: string): string {
  if (sets.length === 0) return "—";
  const same = sets.every((s) => s.weight === sets[0].weight);
  if (same) return `${formatWeight(sets[0].weight, equipment)} × ${sets.map((s) => s.reps).join(", ")}`;
  return sets.map((s) => `${num(s.weight)}×${s.reps}`).join(" · ");
}
