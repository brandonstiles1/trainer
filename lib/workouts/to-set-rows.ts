import type { WorkoutResponse } from "@/lib/workout-tool";

export type SetRow = {
  workoutId: string;
  exerciseName: string;
  setNumber: number;
  prescribed: {
    reps: number;
    weight: number;
    targetReps: number;
    rationale?: string;
  };
};

/** Flatten a generated workout into workout_sets rows (new prescribed shape). */
export function toSetRows(workoutId: string, gen: WorkoutResponse): SetRow[] {
  return gen.exercises.flatMap((ex) =>
    ex.sets.map((s) => ({
      workoutId,
      exerciseName: ex.name,
      setNumber: s.set_number,
      prescribed: {
        reps: s.target_reps,
        weight: s.weight,
        targetReps: s.target_reps,
        // Claude's rationale explains set 1; later sets are explained by adaptChain.
        ...(s.set_number === 1 ? { rationale: ex.rationale } : {}),
      },
    })),
  );
}
