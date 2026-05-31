"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startImpromptuWorkout } from "./actions";

type Day = {
  day: string;
  category: string;
  exercises: { name: string; order: number; notes?: string }[];
};

const WEEKDAY_ORDER = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
];

const humanize = (s: string) =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function ImpromptuBox({ days }: { days: Day[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function pick(day: string) {
    setError(null);
    start(async () => {
      try {
        const { workoutId } = await startImpromptuWorkout(day);
        router.push(`/workout/${workoutId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "could not start workout");
      }
    });
  }

  const sorted = days
    .slice()
    .sort((a, b) => WEEKDAY_ORDER.indexOf(a.day) - WEEKDAY_ORDER.indexOf(b.day));

  return (
    <div className="rounded-lg border bg-muted/30">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium"
      >
        Choose an impromptu workout
        <span className="text-muted-foreground">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="border-t px-2 py-2 space-y-1">
          {sorted.map((d) => {
            const preview = d.exercises
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((e) => e.name.replace(/_/g, " "))
              .join(", ");
            return (
              <button
                key={d.day}
                type="button"
                disabled={pending}
                onClick={() => pick(d.day)}
                className="w-full text-left rounded-md px-3 py-2 hover:bg-muted disabled:opacity-50"
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium">{humanize(d.category)}</span>
                  <span className="text-xs text-muted-foreground capitalize">{d.day}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate">{preview}</p>
              </button>
            );
          })}
          {pending && (
            <p className="text-xs text-muted-foreground px-3 py-1">Generating your workout…</p>
          )}
          {error && <p className="text-xs text-destructive px-3 py-1">{error}</p>}
        </div>
      )}
    </div>
  );
}
