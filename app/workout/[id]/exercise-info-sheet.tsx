"use client";

import { useState } from "react";
import { Trophy } from "lucide-react";
import { FEEL_LABEL, type Feel } from "@/lib/engine/feel";
import type { RepRange } from "@/lib/engine/exercise-meta";

export type PastSession = {
  /** ISO string — Dates don't survive the server/client boundary as Dates. */
  finishedAt: string | null;
  sets: Array<{ targetReps: number; weight: number; reps: number; feel: Feel }>;
};

export type ExerciseInfo = {
  /** Finished sessions of this exercise, newest first. */
  sessions: PastSession[];
  personalRecord: { weight: number; reps: number } | null;
  weightIncrement: number;
  repRange: RepRange;
};

const WEIGHT_INCREMENTS = [2.5, 5, 10];

const feelDot: Record<Feel, string> = {
  hard: "var(--feel-hard-fg)",
  medium: "var(--feel-okay-fg)",
  easy: "var(--teal)",
};

const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function relativeDay(iso: string | null): string {
  if (!iso) return "earlier";
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  return `${Math.round(days / 7)} weeks ago`;
}

/**
 * What the info icon opens: this exercise's recent sessions, its PR, and the
 * two settings that decide when it earns a bump.
 */
export function ExerciseInfoSheet({
  exerciseName,
  info,
  onClose,
  onIncrementChange,
  onRepRangeChange,
}: {
  exerciseName: string;
  info: ExerciseInfo;
  onClose: () => void;
  onIncrementChange: (increment: number) => void;
  onRepRangeChange: (range: RepRange) => void;
}) {
  const [range, setRange] = useState(info.repRange);

  const commitRange = (next: RepRange) => {
    if (next.min < 1 || next.max > 30 || next.min > next.max) return;
    setRange(next);
    onRepRangeChange(next);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-8 animate-in fade-in"
      onClick={onClose}
    >
      <div
        className="max-h-[80dvh] w-full max-w-sm overflow-y-auto rounded-[18px] bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-base font-semibold text-foreground">{titleCase(exerciseName)}</h3>
          {info.personalRecord && (
            <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-[var(--teal)]">
              <Trophy className="size-3" />
              PR {info.personalRecord.reps} × {info.personalRecord.weight}
            </span>
          )}
        </div>

        <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Last time
        </p>
        {info.sessions.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No history yet — today&apos;s sets become the baseline.
          </p>
        ) : (
          <div className="mt-2 space-y-3">
            {info.sessions.map((session, i) => (
              <div
                key={session.finishedAt ?? i}
                className="rounded-[12px] border-[0.5px] border-[color:var(--hairline)] px-3 py-2.5"
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-medium text-foreground">
                    {relativeDay(session.finishedAt)}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    target {Math.max(...session.sets.map((s) => s.targetReps))} reps
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                  {session.sets.map((s, j) => (
                    <span
                      key={j}
                      className={`flex items-center gap-1.5 text-sm tabular-nums ${
                        s.reps < s.targetReps ? "text-muted-foreground" : "text-foreground"
                      }`}
                    >
                      <span
                        aria-hidden
                        className="size-1.5 rounded-full"
                        style={{ backgroundColor: feelDot[s.feel] }}
                      />
                      {s.reps} × {s.weight}
                      <span className="sr-only">, felt {FEEL_LABEL[s.feel]}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="mt-5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Progression
        </p>
        <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
          Clear every set and the target climbs a rep. At {range.max} reps it&apos;s{" "}
          +{info.weightIncrement} lbs and back to {range.min}.
        </p>

        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-sm text-foreground">Rep range</span>
          <div className="flex items-center gap-1.5">
            <StepperField
              label="min reps"
              value={range.min}
              onChange={(min) => commitRange({ ...range, min })}
            />
            <span className="text-sm text-muted-foreground">–</span>
            <StepperField
              label="max reps"
              value={range.max}
              onChange={(max) => commitRange({ ...range, max })}
            />
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-sm text-foreground">Weight step</span>
          <div className="flex gap-1.5">
            {WEIGHT_INCREMENTS.map((inc) => (
              <button
                key={inc}
                type="button"
                onClick={() => onIncrementChange(inc)}
                className={`h-9 rounded-[10px] border-[0.5px] px-3 text-sm font-medium transition-colors ${
                  info.weightIncrement === inc
                    ? "border-[var(--teal)] bg-[var(--teal)]/10 text-[var(--teal)]"
                    : "border-[color:var(--hairline)] text-muted-foreground"
                }`}
              >
                {inc}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-5 h-11 w-full rounded-[12px] border-[0.5px] border-[color:var(--hairline)] text-sm font-medium text-foreground"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function StepperField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center rounded-[10px] border-[0.5px] border-[color:var(--hairline)]">
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        onClick={() => onChange(value - 1)}
        className="h-9 w-8 text-muted-foreground transition-colors hover:text-foreground"
      >
        −
      </button>
      <span className="w-6 text-center text-sm font-medium tabular-nums text-foreground">
        {value}
      </span>
      <button
        type="button"
        aria-label={`Increase ${label}`}
        onClick={() => onChange(value + 1)}
        className="h-9 w-8 text-muted-foreground transition-colors hover:text-foreground"
      >
        +
      </button>
    </div>
  );
}
