"use client";

import { Trophy } from "lucide-react";
import { formatSets, formatStep, formatWeight, titleCase } from "@/lib/format";
import type { RecommendAction } from "@/lib/engine/double-progression";

export type PastSession = {
  /** ISO string — Dates don't survive the server/client boundary as Dates. */
  finishedAt: string;
  /** Every prescribed set logged; only complete sessions count toward progression. */
  complete: boolean;
  sets: Array<{ weight: number; reps: number }>;
};

export type ExerciseInfo = {
  sets: number;
  repMin: number;
  repMax: number;
  notes?: string;
  equipment: string;
  restSeconds: number;
  action: RecommendAction | null;
  rationale: string | null;
  /** Finished sessions of this exercise, newest first. */
  sessions: PastSession[];
  personalRecord: { weight: number; reps: number } | null;
  incrementOverride: number | null;
  /** The step Settings gives this equipment, used when there's no override. */
  defaultIncrement: number;
  successSessions: number;
};

const STEPS = [1, 2.5, 5, 10];

function relativeDay(iso: string): string {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return `${Math.round(days / 7)} weeks ago`;
}

/** What the info icon opens: recent sessions, the PR, and this exercise's weight step. */
export function ExerciseInfoSheet({
  exerciseName,
  info,
  onClose,
  onIncrementChange,
}: {
  exerciseName: string;
  info: ExerciseInfo;
  onClose: () => void;
  onIncrementChange: (increment: number | null) => void;
}) {
  const step = info.incrementOverride ?? info.defaultIncrement;
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
          <h3 className="text-base font-semibold">{titleCase(exerciseName)}</h3>
          {info.personalRecord && (
            <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-[var(--teal)]">
              <Trophy className="size-3" />
              {formatWeight(info.personalRecord.weight, info.equipment)} × {info.personalRecord.reps}
            </span>
          )}
        </div>
        {info.notes && <p className="mt-0.5 text-xs text-muted-foreground">{info.notes}</p>}

        <p className="mt-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Recent</p>
        {info.sessions.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No history yet — today becomes the baseline.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {info.sessions.map((s) => (
              <li key={s.finishedAt} className="flex items-baseline justify-between gap-3 text-sm tabular-nums">
                <span className="text-xs text-muted-foreground">{relativeDay(s.finishedAt)}</span>
                <span className={s.complete ? "" : "text-muted-foreground"}>
                  {formatSets(s.sets, info.equipment)}
                  {!s.complete && <span className="ml-1 text-[10px]">(incomplete)</span>}
                </span>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Progression</p>
        <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
          Get every set to {info.repMax} reps{" "}
          {info.successSessions === 1 ? "once" : `${info.successSessions} sessions in a row`} and the weight goes up{" "}
          {formatStep(step, info.equipment)}, back to {info.repMin} reps. Sets and rep range are
          edited in Settings.
        </p>

        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-sm">
            Weight step{info.equipment === "dumbbell" && <span className="text-muted-foreground"> / dumbbell</span>}
          </span>
          <div className="flex gap-1.5">
            {STEPS.map((inc) => (
              <button
                key={inc}
                type="button"
                onClick={() => onIncrementChange(inc === info.defaultIncrement ? null : inc)}
                className={`h-9 rounded-[10px] border-[0.5px] px-2.5 text-sm font-medium ${
                  step === inc
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
          className="mt-5 h-11 w-full rounded-[12px] border-[0.5px] border-[color:var(--hairline)] text-sm font-medium"
        >
          Close
        </button>
      </div>
    </div>
  );
}
