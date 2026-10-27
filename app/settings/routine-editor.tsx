"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { titleCase } from "@/lib/format";
import { saveRoutine } from "@/lib/actions/settings";
import { metaFor, type ProgramExercise, type ProgramStructure } from "@/lib/program/structure";

const toKey = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/**
 * Edit sets, rep ranges and exercises per workout. Swapping an exercise only
 * changes what's prescribed from now on — the old exercise's history stays
 * under its own name, and the new one starts from its own.
 */
export function RoutineEditor({ program: initial, options }: { program: ProgramStructure; options: string[] }) {
  const [program, setProgram] = useState(initial);
  const [dayIdx, setDayIdx] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  const dirty = JSON.stringify(program) !== JSON.stringify(initial);
  const day = program.days[dayIdx];

  const updateDay = (fn: (exercises: ProgramExercise[]) => ProgramExercise[]) => {
    setSaved(false);
    setProgram((p) => ({
      ...p,
      days: p.days.map((d, i) =>
        i === dayIdx ? { ...d, exercises: fn(d.exercises).map((e, j) => ({ ...e, order: j + 1 })) } : d,
      ),
    }));
  };

  const patch = (i: number, change: Partial<ProgramExercise>) =>
    updateDay((list) => list.map((e, j) => (j === i ? { ...e, ...change } : e)));

  const move = (i: number, by: number) =>
    updateDay((list) => {
      const next = [...list];
      const [x] = next.splice(i, 1);
      next.splice(Math.max(0, Math.min(next.length, i + by)), 0, x);
      return next;
    });

  const substitute = (i: number, raw: string) => {
    const name = toKey(raw);
    if (!name || name === day.exercises[i].name) return;
    // A different exercise brings its own equipment; the slot keeps its sets and range.
    patch(i, { name, equipment: undefined, compound: undefined, lowerBody: undefined, notes: undefined });
  };

  const add = () => {
    const { repRange } = metaFor({ name: "dumbbell_curl" });
    updateDay((list) => [
      ...list,
      { name: "dumbbell_curl", order: list.length + 1, sets: 3, repMin: repRange.min, repMax: repRange.max },
    ]);
    setEditing(day.exercises.length);
  };

  const save = () =>
    start(async () => {
      setError(null);
      try {
        await saveRoutine(program);
        setSaved(true);
        setEditing(null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save the routine.");
      }
    });

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {program.days.map((d, i) => (
          <button
            key={d.day}
            type="button"
            onClick={() => {
              setDayIdx(i);
              setEditing(null);
            }}
            className={cn(
              "h-10 flex-1 rounded-[10px] border-[0.5px] text-sm font-medium",
              i === dayIdx
                ? "border-[var(--teal)] bg-[var(--teal)]/10 text-[var(--teal)]"
                : "border-[color:var(--hairline)] bg-white text-muted-foreground",
            )}
          >
            {d.day}
          </button>
        ))}
      </div>

      <div className="rounded-[13px] border-[0.5px] border-[color:var(--hairline)] bg-white">
        <input
          value={day.title}
          onChange={(e) => {
            setSaved(false);
            setProgram((p) => ({
              ...p,
              days: p.days.map((d, i) => (i === dayIdx ? { ...d, title: e.target.value } : d)),
            }));
          }}
          aria-label="Workout name"
          className="w-full rounded-t-[13px] px-4 pt-3 pb-2 text-[15px] font-medium outline-none"
        />
        <ul className="divide-y divide-[color:var(--hairline)] border-t border-[color:var(--hairline)]">
          {day.exercises.map((e, i) => (
            <li key={`${e.name}-${i}`} className="px-4 py-2.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(editing === i ? null : i)}
                  className="min-w-0 flex-1 text-left"
                  aria-expanded={editing === i}
                >
                  <p className="truncate text-sm font-medium">{titleCase(e.name)}</p>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {e.sets} × {e.repMin}–{e.repMax}
                    {e.notes ? ` · ${e.notes}` : ""}
                  </p>
                </button>
                <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="p-1 text-muted-foreground disabled:opacity-30">
                  <ChevronUp className="size-4" />
                </button>
                <button type="button" aria-label="Move down" disabled={i === day.exercises.length - 1} onClick={() => move(i, 1)} className="p-1 text-muted-foreground disabled:opacity-30">
                  <ChevronDown className="size-4" />
                </button>
              </div>

              {editing === i && (
                <div className="mt-3 space-y-3">
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Exercise</span>
                    <input
                      list="exercise-options"
                      defaultValue={titleCase(e.name)}
                      onBlur={(ev) => substitute(i, ev.target.value)}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter") (ev.target as HTMLInputElement).blur();
                      }}
                      className="mt-1 h-10 w-full rounded-[10px] border-[0.5px] border-[color:var(--hairline)] bg-[#fafaf9] px-3 text-sm outline-none focus:border-[var(--teal)]"
                    />
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <Num label="Sets" value={e.sets} min={1} max={10} onChange={(sets) => patch(i, { sets })} />
                    <Num label="Min reps" value={e.repMin} min={1} max={e.repMax} onChange={(repMin) => patch(i, { repMin })} />
                    <Num label="Max reps" value={e.repMax} min={e.repMin} max={50} onChange={(repMax) => patch(i, { repMax })} />
                  </div>
                  <button
                    type="button"
                    disabled={day.exercises.length === 1}
                    onClick={() => {
                      updateDay((list) => list.filter((_, j) => j !== i));
                      setEditing(null);
                    }}
                    className="flex items-center gap-1 text-xs font-medium text-[var(--danger-fg)] disabled:opacity-40"
                  >
                    <X className="size-3.5" /> Remove from workout {day.day}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={add}
          className="flex w-full items-center justify-center gap-1 border-t border-[color:var(--hairline)] py-2.5 text-xs font-medium text-muted-foreground hover:text-[var(--teal)]"
        >
          <Plus className="size-3.5" /> Add exercise
        </button>
      </div>

      <datalist id="exercise-options">
        {options.map((o) => (
          <option key={o} value={titleCase(o)} />
        ))}
      </datalist>

      {(dirty || saved) && (
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className="h-11 w-full rounded-[12px] bg-[var(--teal)] text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : dirty ? "Save routine" : "Saved"}
        </button>
      )}
      {error && <p className="px-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function Num({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="mt-1 flex items-center justify-between rounded-[10px] border-[0.5px] border-[color:var(--hairline)]">
        <button type="button" aria-label={`Fewer ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)} className="h-9 w-8 text-muted-foreground disabled:opacity-30">
          −
        </button>
        <span className="text-sm font-medium tabular-nums">{value}</span>
        <button type="button" aria-label={`More ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)} className="h-9 w-8 text-muted-foreground disabled:opacity-30">
          +
        </button>
      </div>
    </div>
  );
}
