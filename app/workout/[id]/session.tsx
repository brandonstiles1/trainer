"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Clock,
  Info,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Timer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration, formatSets, formatWeight, titleCase } from "@/lib/format";
import { setsToCarryWeight } from "@/lib/workouts/carry-weight";
import { alternativesFor } from "@/lib/workouts/exercise-alternatives";
import {
  abandonWorkout,
  addSet,
  commitSet,
  completeWorkout,
  removeSet,
  restartWorkout,
  setExerciseIncrement,
  skipExercise,
  swapExercise,
  uncommitSet,
} from "@/lib/actions/workouts";
import { ExerciseInfoSheet, type ExerciseInfo } from "./exercise-info-sheet";
import { usePausableClock, useRestTimer } from "./timers";

export type { ExerciseInfo };

export type SessionSet = {
  id: string;
  exerciseName: string;
  setNumber: number;
  targetWeight: number;
  targetReps: number;
  /** Logged or skipped. */
  completed: boolean;
  actual: { reps: number; weight: number } | null;
};

type Draft = { weight: string; reps: string };

/** Client mirror of the server rule: later unlogged sets follow the weight actually lifted. */
function carryWeight(sets: SessionSet[], logged: SessionSet, weight: number): SessionSet[] {
  const ids = new Set(
    setsToCarryWeight(
      sets.map((s) => ({
        id: s.id,
        exerciseName: s.exerciseName,
        setNumber: s.setNumber,
        resolved: s.completed || s.id === logged.id,
        targetWeight: s.targetWeight,
      })),
      { exerciseName: logged.exerciseName, setNumber: logged.setNumber, weight },
    ),
  );
  return sets.map((s) => (ids.has(s.id) ? { ...s, targetWeight: weight } : s));
}

const parseWeight = (v: string) => {
  const n = Number(v.replace("−", "-"));
  return Number.isFinite(n) ? n : NaN;
};

export function Session({
  workoutId,
  title,
  initialSets,
  restTimer,
  startedAtMs,
  exerciseInfo,
}: {
  workoutId: string;
  title: string;
  initialSets: SessionSet[];
  restTimer: boolean;
  startedAtMs: number;
  exerciseInfo: Record<string, ExerciseInfo>;
}) {
  const router = useRouter();
  const [sets, setSets] = useState(initialSets);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [info, setInfo] = useState(exerciseInfo);
  const [infoFor, setInfoFor] = useState<string | null>(null);
  const [swapFor, setSwapFor] = useState<string | null>(null);
  const [swapping, setSwapping] = useState(false);
  const [sheet, setSheet] = useState<"menu" | "restart" | "discard" | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const { elapsed, paused, toggle: togglePause } = usePausableClock(startedAtMs, workoutId);
  const rest = useRestTimer(workoutId);

  const loggedCount = sets.filter((s) => s.actual).length;
  const openCount = sets.filter((s) => !s.completed).length;

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

  // The first exercise with an open set gets the "current" marker.
  const current = byExercise.find(([, list]) => list.some((s) => !s.completed))?.[0] ?? null;

  const fail = (msg: string) => {
    setError(msg);
    setTimeout(() => setError((e) => (e === msg ? null : e)), 4000);
  };

  const draftOf = (s: SessionSet): Draft =>
    drafts[s.id] ?? {
      weight: String(s.actual?.weight ?? s.targetWeight),
      reps: String(s.actual?.reps ?? s.targetReps),
    };

  function setDraft(id: string, patch: Partial<Draft>, base: Draft) {
    setDrafts((prev) => ({ ...prev, [id]: { ...base, ...prev[id], ...patch } }));
  }

  async function handleLog(set: SessionSet) {
    const d = draftOf(set);
    const actual = { weight: parseWeight(d.weight), reps: Math.round(Number(d.reps)) };
    if (!Number.isFinite(actual.weight) || !Number.isFinite(actual.reps) || d.reps === "") {
      fail("Enter a weight and reps first.");
      return;
    }
    const wasLogged = set.actual !== null;
    const snapshot = sets;
    const updated = carryWeight(
      sets.map((s) => (s.id === set.id ? { ...s, completed: true, actual } : s)),
      set,
      actual.weight,
    );
    setSets(updated);
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[set.id];
      return next;
    });

    // Re-saving an edit shouldn't restart your rest.
    if (!wasLogged && restTimer) rest.start(info[set.exerciseName]?.restSeconds ?? 90);

    // Exercise finished? Fold it away so the next one is in view.
    const left = updated.filter((s) => s.exerciseName === set.exerciseName && !s.completed);
    if (left.length === 0 && !wasLogged) {
      setCollapsed((prev) => new Set(prev).add(set.exerciseName));
    }

    try {
      await commitSet({ workoutId, setId: set.id, actual });
    } catch {
      setSets(snapshot);
      if (!wasLogged) rest.skip();
      fail("Couldn't save that set — try again.");
    }
  }

  async function handleUnlog(set: SessionSet) {
    const snapshot = sets;
    setSets(sets.map((s) => (s.id === set.id ? { ...s, completed: false, actual: null } : s)));
    setDrafts((prev) => ({
      ...prev,
      [set.id]: { weight: String(set.actual?.weight ?? set.targetWeight), reps: String(set.actual?.reps ?? set.targetReps) },
    }));
    try {
      await uncommitSet({ workoutId, setId: set.id });
    } catch {
      setSets(snapshot);
      fail("Couldn't undo that set — try again.");
    }
  }

  async function handleSkipExercise(exerciseName: string) {
    const snapshot = sets;
    setSets(sets.map((s) => (s.exerciseName === exerciseName && !s.completed ? { ...s, completed: true } : s)));
    setCollapsed((prev) => new Set(prev).add(exerciseName));
    try {
      await skipExercise({ workoutId, exerciseName });
    } catch {
      setSets(snapshot);
      fail("Couldn't skip that exercise — try again.");
    }
  }

  async function handleAddSet(exerciseName: string) {
    try {
      const created = await addSet({ workoutId, exerciseName });
      const added: SessionSet = {
        id: created.id,
        exerciseName,
        setNumber: created.setNumber,
        targetWeight: created.prescribed.weight,
        targetReps: created.prescribed.targetReps,
        completed: false,
        actual: null,
      };
      const lastIdx = sets.findLastIndex((s) => s.exerciseName === exerciseName);
      setSets([...sets.slice(0, lastIdx + 1), added, ...sets.slice(lastIdx + 1)]);
    } catch {
      fail("Couldn't add a set — try again.");
    }
  }

  async function handleRemoveSet(exerciseName: string) {
    const target = sets.findLast((s) => s.exerciseName === exerciseName && !s.completed);
    if (!target) return;
    const snapshot = sets;
    setSets(sets.filter((s) => s.id !== target.id));
    try {
      await removeSet({ workoutId, setId: target.id });
    } catch {
      setSets(snapshot);
      fail("Couldn't remove that set — try again.");
    }
  }

  function handleIncrementChange(exerciseName: string, increment: number | null) {
    setInfo((prev) => ({ ...prev, [exerciseName]: { ...prev[exerciseName], incrementOverride: increment } }));
    setExerciseIncrement({ exerciseName, increment }).catch(() => fail("Couldn't save that weight step."));
  }

  async function handleSwap(toExercise: string) {
    const fromExercise = swapFor;
    if (!fromExercise) return;
    setSwapping(true);
    try {
      await swapExercise({ workoutId, fromExercise, toExercise });
      // The page keys this component on the exercise list — refresh remounts it.
      startTransition(() => router.refresh());
      setSwapFor(null);
    } catch {
      fail("Couldn't swap that exercise — try again.");
    } finally {
      setSwapping(false);
    }
  }

  async function handleRestart() {
    setSheet(null);
    rest.skip();
    try {
      await restartWorkout(workoutId);
      startTransition(() => router.refresh());
    } catch {
      fail("Couldn't restart the workout — try again.");
    }
  }

  async function handleFinish() {
    rest.skip();
    try {
      await completeWorkout(workoutId);
      startTransition(() => router.refresh());
    } catch {
      fail("Couldn't finish the workout — try again.");
    }
  }

  async function handleDiscard() {
    setSheet(null);
    rest.skip();
    await abandonWorkout(workoutId);
    router.push("/today");
  }

  const toggle = (name: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div className="min-h-dvh bg-[var(--surface)]">
      <div className="max-w-md mx-auto">
        <header className="sticky top-0 z-30 bg-[var(--teal)] text-white px-5 pt-3 pb-3 rounded-b-[18px]">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-sm font-medium">{title}</p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={togglePause}
                aria-label={paused ? "Resume workout" : "Pause workout"}
                className="flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-medium text-white"
              >
                {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
                {paused ? "Resume" : "Pause"}
              </button>
              <button
                type="button"
                onClick={() => setSheet("menu")}
                aria-label="Workout options"
                className="-mr-1 p-1 text-white/60 hover:text-white"
              >
                <MoreHorizontal className="size-5" />
              </button>
            </div>
          </div>

          {rest.active ? (
            <RestBar
              remainingMs={rest.remainingMs}
              durationMs={rest.durationMs}
              onExtend={() => rest.extend(30)}
              onSkip={rest.skip}
            />
          ) : (
            <div className="mt-2 flex items-center justify-between text-sm tabular-nums">
              <span>
                <span className="font-medium">{loggedCount}</span>
                <span className="text-white/60">/{sets.length} sets</span>
              </span>
              <span className={cn("flex items-center gap-1.5 font-medium", paused && "text-white/50")}>
                <Clock className="size-3.5 text-white/55" />
                {formatDuration(elapsed)}
                {paused && <span className="text-[10px] uppercase tracking-wide text-white/60">paused</span>}
              </span>
            </div>
          )}
        </header>

        {error && (
          <p role="alert" className="mx-4 mt-3 rounded-[10px] bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger-fg)]">
            {error}
          </p>
        )}

        <main className="px-4 py-4 space-y-3 pb-28">
          {byExercise.map(([name, list]) => {
            const ex = info[name];
            const done = list.filter((s) => s.completed).length;
            const open = !collapsed.has(name);
            const moved = ex?.action === "increase" || ex?.action === "decrease" || ex?.action === "ease_back";
            const last = ex?.sessions[0];
            return (
              <section
                key={name}
                className="rounded-[12px] bg-white border-[0.5px] border-[color:var(--hairline)] overflow-hidden"
              >
                <div className="flex items-start gap-2 px-4 pt-3 pb-2">
                  <button
                    type="button"
                    onClick={() => toggle(name)}
                    aria-expanded={open}
                    className="min-w-0 flex-1 text-left"
                  >
                    <h2 className="flex items-center gap-2 text-base font-medium">
                      {name === current && (
                        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--teal)]" />
                      )}
                      <span className="truncate">{titleCase(name)}</span>
                    </h2>
                    <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                      {ex ? `${ex.sets} × ${ex.repMin}–${ex.repMax}${ex.notes === "per leg" ? " / leg" : ""}` : ""}
                      {last ? ` · Last ${formatSets(last.sets, ex.equipment)}` : " · First time"}
                      {!open && ` · ${done}/${list.length} done`}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setInfoFor(name)}
                    aria-label={`History and settings for ${titleCase(name)}`}
                    className="p-1 text-muted-foreground hover:text-[var(--teal)]"
                  >
                    <Info className="size-4" />
                  </button>
                  {done < list.length && (
                    <button
                      type="button"
                      onClick={() => setSwapFor(name)}
                      aria-label={`Swap ${titleCase(name)}`}
                      className="p-1 text-muted-foreground hover:text-[var(--teal)]"
                    >
                      <RefreshCw className="size-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => toggle(name)}
                    aria-label={open ? "Collapse" : "Expand"}
                    className="p-1 text-muted-foreground"
                  >
                    <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
                  </button>
                </div>

                {open && (
                  <>
                    {ex?.rationale && (
                      <p
                        className={cn(
                          "mx-4 mb-2 flex items-start gap-1 text-[11px] leading-snug",
                          moved ? "text-[var(--teal)]" : "text-muted-foreground",
                        )}
                      >
                        {ex.action === "increase" && <ArrowUp className="mt-px size-3 shrink-0" />}
                        {(ex.action === "decrease" || ex.action === "ease_back") && (
                          <ArrowDown className="mt-px size-3 shrink-0" />
                        )}
                        <span>{ex.rationale}</span>
                      </p>
                    )}
                    <div className="border-t border-[color:var(--hairline)]">
                      {list.map((s) => (
                        <SetRow
                          key={s.id}
                          set={s}
                          draft={draftOf(s)}
                          equipment={ex?.equipment}
                          onChange={(patch) => setDraft(s.id, patch, draftOf(s))}
                          dirty={!!drafts[s.id] && !!s.actual}
                          onLog={() => handleLog(s)}
                          onUnlog={() => handleUnlog(s)}
                        />
                      ))}
                    </div>
                    <div className="flex border-t border-[color:var(--hairline)] text-xs font-medium text-muted-foreground">
                      <button type="button" onClick={() => handleAddSet(name)} className="flex flex-1 items-center justify-center gap-1 py-2.5 hover:text-[var(--teal)]">
                        <Plus className="size-3.5" /> Set
                      </button>
                      {list.some((s) => !s.completed) && list.length > 1 && (
                        <button type="button" onClick={() => handleRemoveSet(name)} className="flex-1 border-l border-[color:var(--hairline)] py-2.5 hover:text-foreground">
                          − Set
                        </button>
                      )}
                      {done < list.length && (
                        <button type="button" onClick={() => handleSkipExercise(name)} className="flex-1 border-l border-[color:var(--hairline)] py-2.5 hover:text-foreground">
                          Skip
                        </button>
                      )}
                    </div>
                  </>
                )}
              </section>
            );
          })}

          <button
            type="button"
            disabled={loggedCount === 0 || pending}
            onClick={handleFinish}
            className="mt-4 h-12 w-full rounded-[12px] bg-[var(--teal)] text-white text-sm font-medium disabled:opacity-40"
          >
            {pending ? "Saving…" : openCount === 0 ? "Finish workout" : `Finish (${openCount} set${openCount === 1 ? "" : "s"} left)`}
          </button>
          {openCount > 0 && loggedCount > 0 && (
            <p className="text-center text-[11px] text-muted-foreground">
              Exercises with unlogged sets won&apos;t count toward progression this time.
            </p>
          )}
        </main>
      </div>

      {swapFor && (
        <BottomSheet onClose={() => !swapping && setSwapFor(null)}>
          <h3 className="text-base font-semibold">Swap {titleCase(swapFor)}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Same sets and rep range, starting from the new exercise&apos;s own history.
          </p>
          <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">
            {alternativesFor(swapFor, sets.map((s) => s.exerciseName)).map((alt) => (
              <button
                key={alt}
                type="button"
                disabled={swapping}
                onClick={() => handleSwap(alt)}
                className="h-11 w-full rounded-[12px] border-[0.5px] border-[color:var(--hairline)] text-sm font-medium hover:border-[var(--teal)] disabled:opacity-60"
              >
                {titleCase(alt)}
              </button>
            ))}
            {alternativesFor(swapFor, sets.map((s) => s.exerciseName)).length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">No similar exercises to suggest.</p>
            )}
          </div>
          <SheetButton onClick={() => setSwapFor(null)} disabled={swapping}>
            {swapping ? "Swapping…" : "Keep it"}
          </SheetButton>
        </BottomSheet>
      )}

      {infoFor && info[infoFor] && (
        <ExerciseInfoSheet
          exerciseName={infoFor}
          info={info[infoFor]}
          onClose={() => setInfoFor(null)}
          onIncrementChange={(inc) => handleIncrementChange(infoFor, inc)}
        />
      )}

      {sheet && (
        <BottomSheet onClose={() => setSheet(null)}>
          {sheet === "menu" && (
            <div className="space-y-2">
              <SheetButton outline onClick={() => setSheet("restart")}>Restart workout</SheetButton>
              <SheetButton danger onClick={() => setSheet("discard")}>Discard workout</SheetButton>
              <SheetButton onClick={() => setSheet(null)}>Keep going</SheetButton>
            </div>
          )}
          {sheet === "restart" && (
            <>
              <h3 className="text-base font-semibold">Restart this workout?</h3>
              <p className="mt-1 text-sm text-muted-foreground">Logged sets are cleared and the clock starts over.</p>
              <div className="mt-4 flex gap-2">
                <SheetButton outline onClick={() => setSheet(null)}>Cancel</SheetButton>
                <SheetButton danger onClick={handleRestart}>Restart</SheetButton>
              </div>
            </>
          )}
          {sheet === "discard" && (
            <>
              <h3 className="text-base font-semibold">Discard this workout?</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Nothing from it counts toward progress, and your rotation stays where it was.
              </p>
              <div className="mt-4 flex gap-2">
                <SheetButton outline onClick={() => setSheet(null)}>Cancel</SheetButton>
                <SheetButton danger onClick={handleDiscard}>Discard</SheetButton>
              </div>
            </>
          )}
        </BottomSheet>
      )}
    </div>
  );
}

function SetRow({
  set,
  draft,
  equipment,
  dirty,
  onChange,
  onLog,
  onUnlog,
}: {
  set: SessionSet;
  draft: Draft;
  equipment?: string;
  /** Logged, then edited — the check saves the edit. */
  dirty: boolean;
  onChange: (patch: Partial<Draft>) => void;
  onLog: () => void;
  onUnlog: () => void;
}) {
  const logged = set.actual !== null;
  const skipped = set.completed && !logged;
  const field =
    "h-11 w-full rounded-[10px] border-[0.5px] border-[color:var(--hairline)] bg-[#fafaf9] text-center text-lg font-medium tabular-nums outline-none focus:border-[var(--teal)] focus:ring-2 focus:ring-[var(--teal)]/15";

  if (skipped) {
    return (
      <div className="flex items-center justify-between px-4 py-2.5 text-sm text-muted-foreground border-b border-[color:var(--hairline)] last:border-0">
        <span>Set {set.setNumber}</span>
        <span>Skipped</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid grid-cols-[2rem_1fr_auto_1fr_3rem] items-center gap-2 px-4 py-2 border-b border-[color:var(--hairline)] last:border-0",
        logged && !dirty && "bg-[var(--teal)]/[0.04]",
      )}
    >
      <span className="text-sm tabular-nums text-muted-foreground">{set.setNumber}</span>
      <label className="block">
        <span className="sr-only">Set {set.setNumber} weight</span>
        <input
          type="text"
          inputMode="decimal"
          value={draft.weight}
          onChange={(e) => onChange({ weight: e.target.value.replace(/[^\d.\-−]/g, "").slice(0, 6) })}
          onFocus={(e) => e.target.select()}
          className={field}
        />
      </label>
      <span className="text-xs text-muted-foreground">
        {equipment === "bodyweight" ? "+lb ×" : equipment === "dumbbell" ? "lb ea ×" : "lb ×"}
      </span>
      <label className="block">
        <span className="sr-only">Set {set.setNumber} reps</span>
        <input
          type="text"
          inputMode="numeric"
          value={draft.reps}
          placeholder={String(set.targetReps)}
          onChange={(e) => onChange({ reps: e.target.value.replace(/[^\d]/g, "").slice(0, 2) })}
          onFocus={(e) => e.target.select()}
          className={field}
        />
      </label>
      <button
        type="button"
        onClick={logged && !dirty ? onUnlog : onLog}
        aria-label={logged && !dirty ? `Undo set ${set.setNumber}` : `Log set ${set.setNumber}`}
        aria-pressed={logged && !dirty}
        className={cn(
          "flex h-11 w-12 items-center justify-center rounded-[10px] border-[0.5px] transition-colors touch-manipulation",
          logged && !dirty
            ? "border-[var(--teal)] bg-[var(--teal)] text-white"
            : "border-[color:var(--hairline)] text-muted-foreground active:bg-[var(--teal)]/10",
        )}
      >
        <Check className="size-5" strokeWidth={2.5} />
      </button>
      {!logged && set.targetWeight !== Number(draft.weight) && (
        <span className="col-span-5 -mt-1 text-[10px] text-muted-foreground">
          Recommended {formatWeight(set.targetWeight, equipment)}
        </span>
      )}
    </div>
  );
}

function RestBar({
  remainingMs,
  durationMs,
  onExtend,
  onSkip,
}: {
  remainingMs: number;
  durationMs: number;
  onExtend: () => void;
  onSkip: () => void;
}) {
  const pct = durationMs > 0 ? Math.min(100, (remainingMs / durationMs) * 100) : 0;
  const btn = "rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-medium text-white";
  return (
    <div className="mt-2 rounded-[12px] bg-white/10 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Timer className="size-3.5 text-white/60" />
          <span className="text-[11px] uppercase tracking-wide text-white/65">Rest</span>
          <span className="text-base font-medium tabular-nums">{formatDuration(Math.ceil(remainingMs / 1000))}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={onExtend} className={btn}>+30s</button>
          <button type="button" onClick={onSkip} className={btn}>Skip</button>
        </div>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/15">
        <div className="h-full rounded-full bg-white transition-[width] duration-300 ease-linear" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function BottomSheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-8 animate-in fade-in"
      onClick={onClose}
    >
      <div className="w-full max-w-sm rounded-[18px] bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function SheetButton({
  onClick,
  disabled,
  outline,
  danger,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  outline?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "h-11 w-full flex-1 rounded-[12px] text-sm font-medium disabled:opacity-60",
        outline && "border-[0.5px] border-[color:var(--hairline)]",
        danger && "bg-[var(--danger-bg)] text-[var(--danger-fg)]",
        !outline && !danger && "mt-3 text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}
