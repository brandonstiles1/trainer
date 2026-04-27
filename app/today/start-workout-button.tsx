"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { startWorkout } from "./actions";

export function StartWorkoutButton() {
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <Button
      size="lg"
      className="w-full"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await startWorkout();
          if ("workoutId" in result) {
            router.push(`/workout/${result.workoutId}`);
          } else {
            router.refresh();
          }
        })
      }
    >
      {pending ? "Generating your workout…" : "Start Workout"}
    </Button>
  );
}
