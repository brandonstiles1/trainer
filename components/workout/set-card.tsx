"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Feeling } from "@/lib/branch";

export type SetCardProps = {
  exerciseName: string;
  setNumber: number;
  totalSets: number;
  prescribed: { reps: number; weight: number };
  onCommit: (actual: { reps: number; weight: number; feeling: Feeling }) => void | Promise<void>;
};

export function SetCard({ exerciseName, setNumber, totalSets, prescribed, onCommit }: SetCardProps) {
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
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Set {setNumber} of {totalSets}
        </p>
        <h2 className="text-2xl font-bold capitalize">{exerciseName.replace(/_/g, " ")}</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Prescribed: {prescribed.reps} reps @ {prescribed.weight} lbs
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="reps">Reps</Label>
          <Input
            id="reps"
            type="number"
            min={0}
            max={99}
            value={reps}
            onChange={(e) => setReps(Number(e.target.value))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="weight">Weight (lbs)</Label>
          <Input
            id="weight"
            type="number"
            min={0}
            step={2.5}
            value={weight}
            onChange={(e) => setWeight(Number(e.target.value))}
          />
        </div>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
          How did that feel?
        </p>
        <div className="grid grid-cols-3 gap-2">
          <Button
            type="button"
            variant={submitting === "red" ? "secondary" : "outline"}
            disabled={submitting !== null}
            className="h-20 text-2xl"
            onClick={() => commit("red")}
            aria-label="Hard"
          >
            🔴
          </Button>
          <Button
            type="button"
            variant={submitting === "yellow" ? "secondary" : "outline"}
            disabled={submitting !== null}
            className="h-20 text-2xl"
            onClick={() => commit("yellow")}
            aria-label="Medium"
          >
            🟡
          </Button>
          <Button
            type="button"
            variant={submitting === "green" ? "secondary" : "outline"}
            disabled={submitting !== null}
            className="h-20 text-2xl"
            onClick={() => commit("green")}
            aria-label="Easy"
          >
            🟢
          </Button>
        </div>
      </div>
    </div>
  );
}
