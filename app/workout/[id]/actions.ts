"use server";

import {
  commitSet as commitSetImpl,
  editSet as editSetImpl,
  completeWorkout as completeWorkoutImpl,
  abandonWorkout as abandonWorkoutImpl,
  skipSet as skipSetImpl,
  skipExercise as skipExerciseImpl,
  restartWorkout as restartWorkoutImpl,
} from "@/lib/actions/workouts";
import type { CommitSetInput } from "@/lib/actions/workouts";
import { pinBaseline as pinBaselineImpl } from "@/lib/actions/lift-estimates";

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
export async function pinBaseline(i: { exerciseName: string; weightLbs: number; reps: number }) {
  return pinBaselineImpl(i);
}
export async function skipSet(input: { workoutId: string; setId: string }) {
  return skipSetImpl(input);
}
export async function skipExercise(input: { workoutId: string; exerciseName: string }) {
  return skipExerciseImpl(input);
}
export async function restartWorkout(workoutId: string) {
  return restartWorkoutImpl(workoutId);
}
