"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SetCard } from "@/components/workout/set-card";
import { RestTimer } from "@/components/workout/rest-timer";
import { Button } from "@/components/ui/button";
import { commitSet, completeWorkout, abandonWorkout } from "./actions";
import type { Feeling } from "@/lib/branch";

export type SessionSet = {
  id: string;
  exerciseName: string;
  setNumber: number;
  prescribed: { reps: number; weight: number };
  completed: boolean;
  actual: { reps: number; weight: number; feeling: Feeling } | null;
};

export function Session({
  workoutId,
  initialSets,
  restSeconds,
}: {
  workoutId: string;
  initialSets: SessionSet[];
  restSeconds: number;
}) {
  const router = useRouter();
  const [sets, setSets] = useState(initialSets);
  const [resting, setResting] = useState(false);
  const [pending, startTransition] = useTransition();

  const currentIdx = sets.findIndex((s) => !s.completed);
  const current = currentIdx === -1 ? null : sets[currentIdx];
  const perExerciseTotal = current
    ? sets.filter((s) => s.exerciseName === current.exerciseName).length
    : 0;

  async function handleCommit(actual: { reps: number; weight: number; feeling: Feeling }) {
    if (!current) return;
    await commitSet({ workoutId, setId: current.id, actual });

    setSets((prev) =>
      prev.map((s) => (s.id === current.id ? { ...s, completed: true, actual } : s)),
    );
    setResting(true);
    startTransition(() => router.refresh());
  }

  async function handleComplete() {
    await completeWorkout(workoutId);
    router.refresh();
  }

  async function handleAbandon() {
    if (!confirm("Abandon this workout? Your progress so far is kept.")) return;
    await abandonWorkout(workoutId);
    router.push("/today");
  }

  if (current === null) {
    return (
      <main className="px-6 py-8 max-w-md mx-auto space-y-6">
        <h1 className="text-2xl font-bold">All sets logged 💪</h1>
        <p className="text-muted-foreground text-sm">Tap Finish to save your workout.</p>
        <Button className="w-full" size="lg" onClick={handleComplete} disabled={pending}>
          {pending ? "Saving…" : "Finish"}
        </Button>
      </main>
    );
  }

  return (
    <main className="px-6 py-8 max-w-md mx-auto space-y-6">
      {resting ? (
        <RestTimer seconds={restSeconds} onDone={() => setResting(false)} />
      ) : (
        <SetCard
          exerciseName={current.exerciseName}
          setNumber={current.setNumber}
          totalSets={perExerciseTotal}
          prescribed={current.prescribed}
          onCommit={handleCommit}
        />
      )}

      <div className="pt-4 border-t">
        <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={handleAbandon}>
          Abandon workout
        </Button>
      </div>
    </main>
  );
}
