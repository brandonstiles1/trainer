"use server";

import {
  commitSet as commitSetImpl,
  editSet as editSetImpl,
  completeWorkout as completeWorkoutImpl,
  abandonWorkout as abandonWorkoutImpl,
} from "@/lib/actions/workouts";
import type { CommitSetInput } from "@/lib/actions/workouts";

export async function commitSet(input: CommitSetInput) {
  return commitSetImpl(input);
}
export async function editSet(input: CommitSetInput) {
  return editSetImpl(input);
}
export async function completeWorkout(workoutId: string) {
  return completeWorkoutImpl(workoutId);
}
export async function abandonWorkout(workoutId: string) {
  return abandonWorkoutImpl(workoutId);
}
