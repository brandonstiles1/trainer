"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, MoreHorizontal, Check, Clock, Timer } from "lucide-react";
import { adaptChain, type Feeling } from "@/lib/adapt";
import {
  commitSet,
  editSet,
  completeWorkout,
  abandonWorkout,
  pinBaseline,
  skipSet,
  skipExercise,
  restartWorkout,
} from "./actions";
import { isBigJump } from "@/lib/workouts/pin-trigger";
import { formatDuration } from "@/lib/format";

export type SessionSet = {
  id: string;
  exerciseName: string;
  setNumber: number;
  prescribed: { reps: number; weight: number; targetReps: number; rationale?: string };
  completed: boolean;
  actual: { reps: number; weight: number; feeling: Feeling } | null;
};

type Actual = { reps: number; weight: number; feeling: Feeling };

// Feels like the app is "computing" the next set even though adaptChain is instant.
const CALCULATING_MS = 850;

const titleCase = (s: string) =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const formatVolume = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

const feelColor: Record<Feeling, string> = {
  red: "var(--feel-hard-fg)",
  yellow: "var(--feel-okay-fg)",
  green: "var(--teal)",
};

// Timestamp-based so it stays correct across re-renders, navigation and lock/unlock.
function useElapsed(startMs: number) {
  const [now, setNow] = useState(startMs);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, Math.floor((now - startMs) / 1000));
}

type RestState = { endsAt: number; durationMs: number };

/** Rest timer driven by an absolute end timestamp and persisted to
 *  localStorage. Survives re-render, navigation away/back, full reload and
 *  phone lock — on return we recompute remaining from the clock, not a counter. */
function useRestTimer(workoutId: string) {
  const storageKey = `trainer:rest:${workoutId}`;
  const [rest, setRest] = useState<RestState | null>(null);
  const [now, setNow] = useState(0);

  const persist = useCallback(
    (r: RestState | null) => {
      try {
        if (r) localStorage.setItem(storageKey, JSON.stringify(r));
        else localStorage.removeItem(storageKey);
      } catch {
        /* storage unavailable — timer still works in-memory */
      }
    },
    [storageKey],
  );

  // Resume an in-flight rest after reload/navigation. Deferred to a timer
  // callback so the read happens post-mount (hydration-safe) without a
  // synchronous setState in the effect body.
  useEffect(() => {
    const resume = () => {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return;
        const r = JSON.parse(raw) as RestState;
        if (r && typeof r.endsAt === "number" && r.endsAt > Date.now()) setRest(r);
        else localStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
    };
    const id = setTimeout(resume, 0);
    return () => clearTimeout(id);
  }, [storageKey]);

  // Tick while active; clear when it elapses.
  useEffect(() => {
    if (!rest) return;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (t >= rest.endsAt) {
        setRest(null);
        persist(null);
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [rest, persist]);

  const remainingMs = rest ? Math.max(0, rest.endsAt - now) : 0;

  const start = useCallback(
    (seconds: number) => {
      const r = { endsAt: Date.now() + seconds * 1000, durationMs: seconds * 1000 };
      setRest(r);
      persist(r);
    },
    [persist],
  );

  const extend = useCallback(
    (seconds: number) => {
      setRest((prev) => {
        const base = prev ?? { endsAt: Date.now(), durationMs: 0 };
        const r = {
          endsAt: base.endsAt + seconds * 1000,
          durationMs: base.durationMs + seconds * 1000,
        };
        persist(r);
        return r;
      });
    },
    [persist],
  );

  const skip = useCallback(() => {
    setRest(null);
    persist(null);
  }, [persist]);

  return {
    active: !!rest,
    remainingMs,
    durationMs: rest?.durationMs ?? 0,
    start,
    extend,
    skip,
  };
}

function applyAdaptChain(
  sets: SessionSet[],
  exerciseName: string,
  baselineFloors: Record<string, number>,
): SessionSet[] {
  const exerciseSets = sets
    .filter((s) => s.exerciseName === exerciseName)
    .sort((a, b) => a.setNumber - b.setNumber);
  const adapted = adaptChain(
    exerciseSets.map((s) => ({ prescribed: s.prescribed, actual: s.actual })),
    baselineFloors[exerciseName] ?? 0,
  );
  return sets.map((s) => {
    const i = exerciseSets.findIndex((e) => e.id === s.id);
    return i === -1 ? s : { ...s, prescribed: adapted[i].prescribed };
  });
}

export function Session({
  workoutId,
  dayName,
  initialSets,
  restSeconds,
  startedAtMs,
  baselineFloors,
}: {
  workoutId: string;
  dayName: string;
  initialSets: SessionSet[];
  restSeconds: number;
  startedAtMs: number;
  baselineFloors: Record<string, number>;
}) {
  const router = useRouter();
  const [sets, setSets] = useState(initialSets);
  const [activeSetId, setActiveSetId] = useState<string | null>(
    () => initialSets.find((s) => !s.completed)?.id ?? null,
  );
  const [calculatingSetId, setCalculatingSetId] = useState<string | null>(null);
  const [openSetId, setOpenSetId] = useState<string | null>(null);
  const [pinPrompt, setPinPrompt] = useState<{ exerciseName: string; weight: number; reps: number } | null>(null);
  // Bottom sheet: workout menu (restart/quit) or a confirm step reached from it / from Finish.
  const [sheet, setSheet] = useState<"menu" | "restart" | "finish" | null>(null);
  // Manual collapse/expand, independent of which set is active. Start with the
  // current exercise open.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const name = initialSets.find((s) => !s.completed)?.exerciseName;
    return new Set(name ? [name] : []);
  });
  const [pending, startTransition] = useTransition();

  const elapsed = useElapsed(startedAtMs);
  const rest = useRestTimer(workoutId);

  const completedCount = sets.filter((s) => s.completed).length;
  const allDone = completedCount === sets.length;
  const volume = sets.reduce(
    (sum, s) => (s.actual ? sum + s.actual.reps * s.actual.weight : sum),
    0,
  );

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

  function toggleExpanded(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function handleCommit(setId: string, actual: Actual) {
    const idx = sets.findIndex((s) => s.id === setId);
    if (idx === -1) return;
    const current = sets[idx];

    const next = sets.find(
      (s, i) => i > idx && s.exerciseName === current.exerciseName && !s.completed,
    );

    let updated = sets.map((s) =>
      s.id === setId ? { ...s, completed: true, actual } : s,
    );

    // Rebuild this exercise's chain client-side for instant feedback (mirrors server).
    updated = applyAdaptChain(updated, current.exerciseName, baselineFloors);

    const nextActive = next ?? updated.find((s) => !s.completed && s.id !== setId) ?? null;

    if (isBigJump(current.prescribed.weight, actual.weight)) {
      setPinPrompt({ exerciseName: current.exerciseName, weight: actual.weight, reps: actual.reps });
    }

    const snapshot = sets;
    try {
      // Show the "calculating" beat: clear the active form, surface the loader.
      setSets(updated);
      setActiveSetId(null);
      setOpenSetId(null);
      setCalculatingSetId(setId);

      const minDelay = new Promise<void>((r) => setTimeout(r, CALCULATING_MS));
      await Promise.all([commitSet({ workoutId, setId, actual }), minDelay]);

      setCalculatingSetId(null);
      setActiveSetId(nextActive?.id ?? null);
      if (nextActive) {
        setExpanded((prev) =>
          prev.has(nextActive.exerciseName) ? prev : new Set(prev).add(nextActive.exerciseName),
        );
      }
      // Anytime "done" is tapped the rest clock starts — even on the workout's last set.
      rest.start(restSeconds);
    } catch {
      setSets(snapshot);
      setCalculatingSetId(null);
      setActiveSetId(setId);
      alert("Couldn't save that set — please try again.");
    }
  }

  async function handleEdit(setId: string, actual: Actual) {
    const snapshot = sets;
    // Logging any set (including one not yet reached) marks it complete and re-flows downstream.
    let updated = sets.map((s) => (s.id === setId ? { ...s, actual, completed: true } : s));
    const target = updated.find((s) => s.id === setId)!;
    updated = applyAdaptChain(updated, target.exerciseName, baselineFloors);
    setSets(updated);
    setOpenSetId(null);
    try {
      await editSet({ workoutId, setId, actual });
    } catch {
      setSets(snapshot);
      alert("Couldn't save your edit — please try again.");
    }
  }

  async function handlePin() {
    const p = pinPrompt;
    setPinPrompt(null);
    try {
      await pinBaseline({ exerciseName: p!.exerciseName, weightLbs: p!.weight, reps: p!.reps });
    } catch {
      alert("Couldn't pin that baseline.");
    }
  }

  async function handleSkipSet(setId: string) {
    const idx = sets.findIndex((s) => s.id === setId);
    if (idx === -1) return;
    const current = sets[idx];

    const updated = sets.map((s) =>
      s.id === setId ? { ...s, completed: true, actual: null } : s,
    );
    const nextActive =
      updated.find(
        (s, i) => i > idx && s.exerciseName === current.exerciseName && !s.completed,
      ) ?? updated.find((s) => !s.completed) ?? null;

    const snapshot = sets;
    setSets(updated);
    setActiveSetId(nextActive?.id ?? null);
    setOpenSetId(null);
    if (nextActive) {
      setExpanded((prev) =>
        prev.has(nextActive.exerciseName) ? prev : new Set(prev).add(nextActive.exerciseName),
      );
    }
    rest.start(restSeconds);
    try {
      await skipSet({ workoutId, setId });
    } catch {
      setSets(snapshot);
      setActiveSetId(setId);
      alert("Couldn't skip that set — please try again.");
    }
  }

  async function handleSkipExercise(exerciseName: string) {
    const updated = sets.map((s) =>
      s.exerciseName === exerciseName && !s.completed
        ? { ...s, completed: true, actual: null }
        : s,
    );
    const nextActive = updated.find((s) => !s.completed) ?? null;

    const snapshot = sets;
    const snapshotActive = activeSetId;
    setSets(updated);
    setActiveSetId(nextActive?.id ?? null);
    setOpenSetId(null);
    setExpanded((prev) => {
      const next = new Set(prev);
      next.delete(exerciseName);
      if (nextActive) next.add(nextActive.exerciseName);
      return next;
    });
    try {
      await skipExercise({ workoutId, exerciseName });
    } catch {
      setSets(snapshot);
      setActiveSetId(snapshotActive);
      alert("Couldn't skip that exercise — please try again.");
    }
  }

  async function handleRestart() {
    setSheet(null);
    rest.skip();
    try {
      await restartWorkout(workoutId);
      // startedAt changed → the page remounts this component with fresh props.
      startTransition(() => router.refresh());
    } catch {
      alert("Couldn't restart the workout — please try again.");
    }
  }

  async function handleFinish() {
    setSheet(null);
    rest.skip();
    await completeWorkout(workoutId);
    startTransition(() => router.refresh());
  }

  async function handleAbandon() {
    setSheet(null);
    rest.skip();
    await abandonWorkout(workoutId);
    router.push("/today");
  }

  return (
    <div className="min-h-dvh bg-[var(--surface)]">
      <div className="max-w-md mx-auto">
        {/* ── Compact sticky deep-teal header ── */}
        <header className="sticky top-0 z-30 bg-[var(--teal)] text-white px-5 pt-3 pb-3 rounded-b-[18px]">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-xs font-medium uppercase tracking-[0.12em] text-white/70">
              {titleCase(dayName)} day
            </p>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-sm font-medium tabular-nums text-white">
                <Clock className="size-3.5 text-white/55" />
                {formatDuration(elapsed)}
              </span>
              <button
                type="button"
                onClick={() => setSheet("menu")}
                aria-label="Workout options"
                className="-mr-1 p-1 text-white/60 hover:text-white transition-colors"
              >
                <MoreHorizontal className="size-5" />
              </button>
            </div>
          </div>

          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums text-white">{formatVolume(volume)}</span>
            <span className="text-[11px] uppercase tracking-wide text-white/60">lbs lifted</span>
          </div>

          {rest.active ? (
            <NavRestTimer
              remainingMs={rest.remainingMs}
              durationMs={rest.durationMs}
              onExtend={() => rest.extend(30)}
              onSkip={rest.skip}
            />
          ) : (
            <div className="mt-2.5 flex items-center gap-3.5">
              <Stat label="Exercises" value={String(byExercise.length)} />
              <span className="h-3 w-px bg-white/20" />
              <Stat label="Sets" value={`${completedCount}/${sets.length}`} />
            </div>
          )}
        </header>

        {/* ── Exercise cards ── */}
        <main className="px-4 py-4 space-y-3 pb-28">
          {pinPrompt && (
            <div className="mx-4 mb-3 rounded-[12px] border-[0.5px] border-[var(--teal)]/40 bg-[var(--teal)]/5 p-3">
              <p className="text-sm font-medium text-[var(--teal)]">Big jump — pin {pinPrompt.weight} lbs?</p>
              <p className="mt-1 text-[11px] text-[var(--teal)]/80">
                Future {titleCase(pinPrompt.exerciseName)} workouts will start from here.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={handlePin}
                  className="h-9 flex-1 rounded-[10px] bg-[var(--teal)] text-xs font-medium text-white"
                >Pin baseline</button>
                <button
                  type="button"
                  onClick={() => setPinPrompt(null)}
                  className="h-9 flex-1 rounded-[10px] border-[0.5px] border-[color:var(--hairline)] text-xs font-medium text-muted-foreground"
                >Not now</button>
              </div>
            </div>
          )}

          {byExercise.map(([exerciseName, exerciseSets]) => {
            const done = exerciseSets.filter((s) => s.completed).length;
            const total = exerciseSets.length;
            const isExpanded = expanded.has(exerciseName);
            const isActive = exerciseSets.some((s) => s.id === activeSetId);
            const lead = exerciseSets.find((s) => !s.completed) ?? exerciseSets[0];

            return (
              <section
                key={exerciseName}
                className="rounded-[12px] bg-white border-[0.5px] border-[color:var(--hairline)] overflow-hidden"
              >
                <ExerciseHeader
                  name={exerciseName}
                  done={done}
                  total={total}
                  lead={lead}
                  expanded={isExpanded}
                  isActive={isActive}
                  onTap={() => toggleExpanded(exerciseName)}
                />

                {isExpanded && (
                  <div className="border-t border-[color:var(--hairline)]">
                    {exerciseSets.map((s, i) => {
                      const last = i === exerciseSets.length - 1;
                      if (s.id === activeSetId) {
                        return (
                          <ActiveSet
                            key={s.id}
                            set={s}
                            onCommit={(a) => handleCommit(s.id, a)}
                            onSkip={() => handleSkipSet(s.id)}
                          />
                        );
                      }
                      if (s.id === calculatingSetId) {
                        return <CalculatingNext key={s.id} />;
                      }
                      if (s.id === openSetId)
                        return <ActiveSet key={s.id} set={s} editing onCommit={(a) => handleEdit(s.id, a)} />;
                      return <CompactSetRow key={s.id} set={s} divider={!last} onTap={() => setOpenSetId(s.id)} />;
                    })}
                    {done < total && (
                      <button
                        type="button"
                        onClick={() => handleSkipExercise(exerciseName)}
                        className="w-full border-t border-[color:var(--hairline)] px-4 py-2.5 text-center text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Skip rest of exercise
                      </button>
                    )}
                  </div>
                )}
              </section>
            );
          })}

          <button
            type="button"
            disabled={completedCount === 0 || pending}
            onClick={() => (allDone ? handleFinish() : setSheet("finish"))}
            className="mt-4 h-12 w-full rounded-[12px] bg-[var(--teal)] text-white text-sm font-medium transition-opacity disabled:opacity-40"
          >
            {pending
              ? "Saving…"
              : allDone
                ? "Finish workout"
                : `Finish early (${completedCount}/${sets.length} sets)`}
          </button>
        </main>
      </div>

      {sheet && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-8 animate-in fade-in"
          onClick={() => setSheet(null)}
        >
          <div
            className="w-full max-w-sm rounded-[18px] bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {sheet === "menu" && (
              <>
                <h3 className="text-base font-semibold text-foreground">Workout options</h3>
                <div className="mt-4 space-y-2">
                  <button
                    type="button"
                    onClick={() => setSheet("restart")}
                    className="h-11 w-full rounded-[12px] border-[0.5px] border-[color:var(--hairline)] text-sm font-medium text-foreground"
                  >
                    Restart workout
                  </button>
                  <button
                    type="button"
                    onClick={handleAbandon}
                    className="h-11 w-full rounded-[12px] bg-[var(--feel-hard-bg)] text-sm font-medium text-[var(--feel-hard-fg)]"
                  >
                    Quit workout
                  </button>
                  <button
                    type="button"
                    onClick={() => setSheet(null)}
                    className="h-11 w-full rounded-[12px] text-sm font-medium text-muted-foreground"
                  >
                    Keep going
                  </button>
                </div>
              </>
            )}

            {sheet === "restart" && (
              <>
                <h3 className="text-base font-semibold text-foreground">Restart this workout?</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  All logged sets will be cleared and the clock starts over.
                </p>
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSheet(null)}
                    className="h-11 flex-1 rounded-[12px] border-[0.5px] border-[color:var(--hairline)] text-sm font-medium text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleRestart}
                    className="h-11 flex-1 rounded-[12px] bg-[var(--feel-hard-bg)] text-sm font-medium text-[var(--feel-hard-fg)]"
                  >
                    Restart
                  </button>
                </div>
              </>
            )}

            {sheet === "finish" && (
              <>
                <h3 className="text-base font-semibold text-foreground">Finish early?</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {sets.length - completedCount} set{sets.length - completedCount === 1 ? "" : "s"} left
                  — they&apos;ll show as skipped in your summary.
                </p>
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSheet(null)}
                    className="h-11 flex-1 rounded-[12px] border-[0.5px] border-[color:var(--hairline)] text-sm font-medium text-foreground"
                  >
                    Keep going
                  </button>
                  <button
                    type="button"
                    onClick={handleFinish}
                    className="h-11 flex-1 rounded-[12px] bg-[var(--teal)] text-sm font-medium text-white"
                  >
                    Finish workout
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-base font-medium tabular-nums text-white">{value}</span>
      <span className="text-[11px] uppercase tracking-wide text-white/55">{label}</span>
    </div>
  );
}

function NavRestTimer({
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
  const btn =
    "rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-white/25";
  return (
    <div className="mt-2.5 rounded-[12px] border-[0.5px] border-white/15 bg-white/10 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Timer className="size-3.5 text-white/60" />
          <span className="text-[11px] font-medium uppercase tracking-wide text-white/65">Rest</span>
          <span className="text-base font-medium tabular-nums text-white">
            {formatDuration(Math.ceil(remainingMs / 1000))}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={onExtend} className={btn}>
            +30s
          </button>
          <button type="button" onClick={onSkip} className={btn}>
            Skip
          </button>
        </div>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/15">
        <div
          className="h-full rounded-full bg-white transition-[width] duration-300 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ExerciseHeader({
  name,
  done,
  total,
  lead,
  expanded,
  isActive,
  onTap,
}: {
  name: string;
  done: number;
  total: number;
  lead: SessionSet;
  expanded: boolean;
  isActive: boolean;
  onTap: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      aria-expanded={expanded}
      className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
    >
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-base font-medium text-foreground">
          {isActive && (
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--teal)]" />
          )}
          <span className="truncate">{titleCase(name)}</span>
        </h2>
        <p className="mt-0.5 text-xs font-normal text-muted-foreground tabular-nums">
          {done} of {total} sets · {lead.prescribed.reps} × {lead.prescribed.weight} lbs
        </p>
      </div>
      <ChevronDown
        className={`size-5 shrink-0 text-muted-foreground transition-transform ${
          expanded ? "rotate-180" : ""
        }`}
      />
    </button>
  );
}

function CalculatingNext() {
  return (
    <div className="flex items-center justify-center gap-2.5 px-4 py-6 text-sm font-normal text-muted-foreground">
      <span
        aria-hidden
        className="size-4 animate-spin rounded-full border-2 border-[var(--teal)]/25 border-t-[var(--teal)]"
      />
      Calculating next set…
    </div>
  );
}

function CompactSetRow({ set, divider, onTap }: { set: SessionSet; divider: boolean; onTap?: () => void }) {
  const done = set.completed && set.actual;
  const skipped = set.completed && !set.actual;
  const inner = (
    <>
      <span className="flex items-center gap-2 font-normal text-muted-foreground">
        {done && <Check className="size-3.5" style={{ color: "var(--teal)" }} />}
        Set {set.setNumber}
      </span>
      <span className="flex items-center gap-2 tabular-nums text-muted-foreground">
        {done
          ? `${set.actual!.reps} × ${set.actual!.weight} lbs`
          : skipped
            ? "Skipped"
            : `${set.prescribed.reps} × ${set.prescribed.weight} lbs`}
        {done && (
          <span
            aria-hidden
            className="size-1.5 rounded-full"
            style={{ backgroundColor: feelColor[set.actual!.feeling] }}
          />
        )}
        {onTap && <ChevronRight className="size-3.5 text-muted-foreground/50" />}
      </span>
    </>
  );

  if (onTap) {
    return (
      <button
        type="button"
        onClick={onTap}
        className={`w-full flex items-center justify-between px-4 py-3 text-sm text-left ${
          divider ? "border-b border-[color:var(--hairline)]" : ""
        }`}
      >
        {inner}
      </button>
    );
  }

  return (
    <div
      className={`w-full flex items-center justify-between px-4 py-3 text-sm ${
        divider ? "border-b border-[color:var(--hairline)]" : ""
      }`}
    >
      {inner}
    </div>
  );
}

function ActiveSet({
  set,
  editing,
  onCommit,
  onSkip,
}: {
  set: SessionSet;
  editing?: boolean;
  onCommit: (actual: Actual) => Promise<void>;
  onSkip?: () => void;
}) {
  // String-backed so typing is intuitive: no forced leading zeros, can be
  // briefly empty, and focusing selects the whole value to overwrite.
  const [reps, setReps] = useState(String((editing ? set.actual?.reps : undefined) ?? set.prescribed.reps));
  const [weight, setWeight] = useState(String((editing ? set.actual?.weight : undefined) ?? set.prescribed.weight));
  const [submitting, setSubmitting] = useState<Feeling | null>(null);
  const [showWhy, setShowWhy] = useState(false);

  const onRepsChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setReps(e.target.value.replace(/[^\d]/g, "").slice(0, 2));

  const onWeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let v = e.target.value.replace(/[^\d.]/g, "");
    const dot = v.indexOf(".");
    if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, "");
    setWeight(v.slice(0, 6));
  };

  const commit = async (feeling: Feeling) => {
    const repsNum = Math.max(0, Math.round(Number(reps) || 0));
    const weightNum = Math.max(0, Number(weight) || 0);
    setSubmitting(feeling);
    try {
      await onCommit({ reps: repsNum, weight: weightNum, feeling });
    } finally {
      setSubmitting(null);
    }
  };

  const numberField =
    "w-full h-16 rounded-[12px] border-[0.5px] border-[color:var(--hairline)] bg-[#fafaf9] text-center text-3xl font-medium text-foreground outline-none transition-colors focus:border-[var(--teal)] focus:ring-2 focus:ring-[var(--teal)]/15";

  return (
    <div className="px-4 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <p className="text-[11px] font-normal uppercase tracking-wide text-muted-foreground">
            Set {set.setNumber} · prescribed {set.prescribed.reps} × {set.prescribed.weight}
          </p>
          {set.prescribed.rationale && (
            <button
              type="button"
              onClick={() => setShowWhy((v) => !v)}
              aria-label="Why this number?"
              className="ml-1.5 inline-flex size-4 items-center justify-center rounded-full border border-[var(--teal)] text-[10px] font-bold text-[var(--teal)]"
            >i</button>
          )}
        </div>
        <span className="rounded-full bg-[var(--teal)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--teal)]">
          {editing ? "editing" : "active"}
        </span>
      </div>
      {showWhy && set.prescribed.rationale && (
        <p className="mt-2 rounded-[8px] border-[0.5px] border-[var(--teal)]/30 bg-[var(--teal)]/5 px-2.5 py-2 text-[11px] leading-snug text-[var(--teal)]">
          {set.prescribed.rationale}
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-center text-[11px] font-normal uppercase tracking-wide text-muted-foreground">
            Reps
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={reps}
            onChange={onRepsChange}
            onFocus={(e) => e.target.select()}
            className={`mt-1.5 ${numberField}`}
          />
        </label>
        <label className="block">
          <span className="block text-center text-[11px] font-normal uppercase tracking-wide text-muted-foreground">
            Weight (lbs)
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={weight}
            onChange={onWeightChange}
            onFocus={(e) => e.target.select()}
            className={`mt-1.5 ${numberField}`}
          />
        </label>
      </div>

      <p className="mt-4 mb-2 text-[11px] font-normal uppercase tracking-wide text-muted-foreground">
        How did it feel?
      </p>
      <div className="grid grid-cols-3 gap-2">
        <FeelChip label="Hard" feeling="red" submitting={submitting} onPick={commit} />
        <FeelChip label="Okay" feeling="yellow" submitting={submitting} onPick={commit} />
        <FeelChip label="Easy" feeling="green" submitting={submitting} onPick={commit} />
      </div>

      {onSkip && !editing && (
        <button
          type="button"
          disabled={submitting !== null}
          onClick={onSkip}
          className="mt-3 w-full text-center text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
        >
          Skip this set
        </button>
      )}
    </div>
  );
}

function FeelChip({
  label,
  feeling,
  submitting,
  onPick,
}: {
  label: string;
  feeling: Feeling;
  submitting: Feeling | null;
  onPick: (feeling: Feeling) => void;
}) {
  const palette: Record<Feeling, string> = {
    red: "bg-[var(--feel-hard-bg)] text-[var(--feel-hard-fg)] border-[color:var(--feel-hard-border)]",
    yellow: "bg-[var(--feel-okay-bg)] text-[var(--feel-okay-fg)] border-[color:var(--feel-okay-border)]",
    green: "bg-[var(--teal)] text-white border-[color:var(--teal)]",
  };
  return (
    <button
      type="button"
      disabled={submitting !== null}
      onClick={() => onPick(feeling)}
      aria-label={label}
      className={`h-12 rounded-[12px] border-[0.5px] text-sm font-medium transition-opacity disabled:opacity-60 ${palette[feeling]} ${
        submitting === feeling ? "opacity-70" : ""
      }`}
    >
      {label}
    </button>
  );
}
