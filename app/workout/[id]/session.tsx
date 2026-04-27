"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RestTimer } from "@/components/workout/rest-timer";
import { commitSet, completeWorkout, abandonWorkout } from "./actions";
import { applyBranch, type Feeling } from "@/lib/branch";

type Branches = Parameters<typeof applyBranch>[1];

export type SessionSet = {
  id: string;
  exerciseName: string;
  setNumber: number;
  prescribed: { reps: number; weight: number; branches: Branches };
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
  const [activeSetId, setActiveSetId] = useState<string | null>(
    () => initialSets.find((s) => !s.completed)?.id ?? null,
  );
  const [restingSetId, setRestingSetId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const completedCount = sets.filter((s) => s.completed).length;
  const allDone = completedCount === sets.length;

  const byExercise = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, SessionSet[]>();
    for (const s of sets) {
      if (!map.has(s.exerciseName)) {
        map.set(s.exerciseName, []);
        order.push(s.exerciseName);
      }
      map.get(s.exerciseName)!.push(s);
    }
    return order.map((name) => [name, map.get(name)!] as const);
  }, [sets]);

  async function handleCommit(setId: string, actual: { reps: number; weight: number; feeling: Feeling }) {
    const idx = sets.findIndex((s) => s.id === setId);
    if (idx === -1) return;
    const current = sets[idx];

    const next = sets.find(
      (s, i) => i > idx && s.exerciseName === current.exerciseName && !s.completed,
    );

    let updated = sets.map((s) =>
      s.id === setId ? { ...s, completed: true, actual } : s,
    );
    if (next) {
      const adjusted = applyBranch(actual, current.prescribed.branches);
      updated = updated.map((s) =>
        s.id === next.id
          ? {
              ...s,
              prescribed: { ...s.prescribed, reps: adjusted.reps, weight: adjusted.weight },
            }
          : s,
      );
    }
    setSets(updated);
    setRestingSetId(setId);

    const nextActive = next ?? updated.find((s) => !s.completed && s.id !== setId) ?? null;
    setActiveSetId(nextActive?.id ?? null);

    await commitSet({ workoutId, setId, actual });
  }

  async function handleFinish() {
    await completeWorkout(workoutId);
    startTransition(() => router.refresh());
  }

  async function handleAbandon() {
    if (!confirm("Abandon this workout? Your progress so far is kept.")) return;
    await abandonWorkout(workoutId);
    router.push("/today");
  }

  return (
    <main className="px-4 py-6 max-w-md mx-auto space-y-3 pb-24">
      <h1 className="text-xl font-bold px-2">Workout</h1>

      {byExercise.map(([exerciseName, exerciseSets]) => {
        const done = exerciseSets.filter((s) => s.completed).length;
        const total = exerciseSets.length;
        const hasActiveOrResting = exerciseSets.some(
          (s) => s.id === activeSetId || s.id === restingSetId,
        );
        const exerciseDone = done === total;

        return (
          <details
            key={exerciseName}
            open={hasActiveOrResting || !exerciseDone}
            className="rounded-lg border bg-card overflow-hidden group"
          >
            <summary className="flex items-center justify-between px-4 py-3 cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden">
              <div>
                <h2 className="font-semibold capitalize">
                  {exerciseName.replace(/_/g, " ")}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {done}/{total} sets {exerciseDone && "✓"}
                </p>
              </div>
              <span className="text-muted-foreground text-sm transition-transform group-open:rotate-180">
                ▾
              </span>
            </summary>

            <ul className="divide-y border-t">
              {exerciseSets.map((s) => (
                <SetRow
                  key={s.id}
                  set={s}
                  isActive={activeSetId === s.id}
                  isResting={restingSetId === s.id}
                  restSeconds={restSeconds}
                  onActivate={() => {
                    setRestingSetId(null);
                    setActiveSetId(s.id);
                  }}
                  onCommit={(actual) => handleCommit(s.id, actual)}
                  onRestDone={() => setRestingSetId(null)}
                />
              ))}
            </ul>
          </details>
        );
      })}

      <div className="pt-4 space-y-2">
        <Button
          className="w-full"
          size="lg"
          disabled={!allDone || pending}
          onClick={handleFinish}
        >
          {pending
            ? "Saving…"
            : allDone
              ? "Finish workout"
              : `Finish (${completedCount}/${sets.length} sets)`}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-muted-foreground"
          onClick={handleAbandon}
        >
          Abandon workout
        </Button>
      </div>
    </main>
  );
}

function SetRow({
  set,
  isActive,
  isResting,
  restSeconds,
  onActivate,
  onCommit,
  onRestDone,
}: {
  set: SessionSet;
  isActive: boolean;
  isResting: boolean;
  restSeconds: number;
  onActivate: () => void;
  onCommit: (actual: { reps: number; weight: number; feeling: Feeling }) => Promise<void>;
  onRestDone: () => void;
}) {
  if (set.completed && isResting) {
    return (
      <li className="px-4 py-3 space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Set {set.setNumber}</span>
          <span className="tabular-nums">
            ✓ {set.actual?.reps} × {set.actual?.weight} lbs <FeelingDot feeling={set.actual?.feeling} />
          </span>
        </div>
        <RestTimer seconds={restSeconds} onDone={onRestDone} />
      </li>
    );
  }

  if (set.completed) {
    return (
      <li>
        <button
          type="button"
          onClick={onActivate}
          className="w-full px-4 py-3 flex items-center justify-between text-sm text-muted-foreground hover:bg-muted/50"
          title="Tap to re-edit"
        >
          <span>Set {set.setNumber}</span>
          <span className="tabular-nums">
            ✓ {set.actual?.reps} × {set.actual?.weight} lbs <FeelingDot feeling={set.actual?.feeling} />
          </span>
        </button>
      </li>
    );
  }

  if (!isActive) {
    return (
      <li>
        <button
          type="button"
          onClick={onActivate}
          className="w-full px-4 py-3 flex items-center justify-between text-sm hover:bg-muted/50"
        >
          <span className="text-muted-foreground">Set {set.setNumber}</span>
          <span className="tabular-nums">
            {set.prescribed.reps} × {set.prescribed.weight} lbs
          </span>
        </button>
      </li>
    );
  }

  return (
    <li className="px-4 py-4">
      <SetEditor
        setNumber={set.setNumber}
        prescribed={set.prescribed}
        onCommit={onCommit}
      />
    </li>
  );
}

function FeelingDot({ feeling }: { feeling?: string }) {
  if (feeling === "red") return <span aria-label="hard">🔴</span>;
  if (feeling === "yellow") return <span aria-label="medium">🟡</span>;
  if (feeling === "green") return <span aria-label="easy">🟢</span>;
  return null;
}

function SetEditor({
  setNumber,
  prescribed,
  onCommit,
}: {
  setNumber: number;
  prescribed: { reps: number; weight: number };
  onCommit: (actual: { reps: number; weight: number; feeling: Feeling }) => Promise<void>;
}) {
  const [reps, setReps] = useState(prescribed.reps);
  const [weight, setWeight] = useState(prescribed.weight);
  const [submitting, setSubmitting] = useState<Feeling | null>(null);

  const commit = async (feeling: Feeling) => {
    setSubmitting(feeling);
    try {
      await onCommit({ reps, weight, feeling });
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        Set {setNumber} · prescribed {prescribed.reps} × {prescribed.weight} lbs
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor={`reps-${setNumber}`}>Reps</Label>
          <Input
            id={`reps-${setNumber}`}
            type="number"
            min={0}
            max={99}
            value={reps}
            onChange={(e) => setReps(Number(e.target.value))}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`weight-${setNumber}`}>Weight (lbs)</Label>
          <Input
            id={`weight-${setNumber}`}
            type="number"
            min={0}
            step={2.5}
            value={weight}
            onChange={(e) => setWeight(Number(e.target.value))}
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 pt-1">
        <Button
          type="button"
          variant={submitting === "red" ? "secondary" : "outline"}
          disabled={submitting !== null}
          className="h-14 text-xl"
          onClick={() => commit("red")}
          aria-label="Hard"
        >
          🔴
        </Button>
        <Button
          type="button"
          variant={submitting === "yellow" ? "secondary" : "outline"}
          disabled={submitting !== null}
          className="h-14 text-xl"
          onClick={() => commit("yellow")}
          aria-label="Medium"
        >
          🟡
        </Button>
        <Button
          type="button"
          variant={submitting === "green" ? "secondary" : "outline"}
          disabled={submitting !== null}
          className="h-14 text-xl"
          onClick={() => commit("green")}
          aria-label="Easy"
        >
          🟢
        </Button>
      </div>
    </div>
  );
}
