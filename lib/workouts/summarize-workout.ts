type Row = {
  exerciseName: string;
  setNumber: number;
  actual: { reps: number; weight: number } | null;
};

export function summarizeWorkout(rows: Row[]) {
  let volume = 0;
  const order: string[] = [];
  const map = new Map<string, string[]>();
  for (const r of [...rows].sort((a, b) => a.setNumber - b.setNumber)) {
    if (!map.has(r.exerciseName)) { map.set(r.exerciseName, []); order.push(r.exerciseName); }
    if (r.actual) {
      volume += r.actual.reps * r.actual.weight;
      map.get(r.exerciseName)!.push(`${r.actual.reps}×${r.actual.weight}`);
    }
  }
  return { volume, exercises: order.map((name) => ({ name, sets: map.get(name)! })) };
}
