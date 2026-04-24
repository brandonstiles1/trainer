"use server";

import { startWorkout as startWorkoutImpl } from "@/lib/actions/workouts";

export async function startWorkout() {
  return startWorkoutImpl();
}
