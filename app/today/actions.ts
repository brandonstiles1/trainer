"use server";

import {
  startWorkout as startWorkoutImpl,
  startImpromptuWorkout as startImpromptuWorkoutImpl,
} from "@/lib/actions/workouts";

export async function startWorkout() {
  return startWorkoutImpl();
}

export async function startImpromptuWorkout(sourceDay: string) {
  return startImpromptuWorkoutImpl(sourceDay);
}
