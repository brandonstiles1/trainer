"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dumbbell, ChevronDown, MoreHorizontal, Check } from "lucide-react";
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

type Actual = { reps: number; weight: number; feeling: Feeling };

const titleCase = (s: string) =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const formatVolume = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

const feelColor: Record<Feeling, string> = {
  red: "var(--feel-hard-fg)",
  yellow: "var(--feel-okay-fg)",
  green: "var(--teal)",
};

export function Session({
  workoutId,
  dayName,
  initialSets,
  restSeconds,
}: {
  workoutId: string;
  dayName: string;
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
    if (next) {
      const adjusted = applyBranch(actual, current.prescribed.branches);
      updated = updated.map((s) =>
        s.id === next.id
          ? { ...s, prescribed: { ...s.prescribed, reps: adjusted.reps, weight: adjusted.weight } }
          : s,
      );
    }
    setSets(updated);
    setRestingSetId(setId);

    const nextActive = next ?? updated.find((s) => !s.completed && s.id !== setId) ?? null;
    setActiveSetId(nextActive?.id ?? null);

    await commitSet({ workoutId, setId, actual });
  }

  function activateExercise(exerciseSets: SessionSet[]) {
    const target = exerciseSets.find((s) => !s.completed) ?? exerciseSets[0];
    setRestingSetId(null);
    setActiveSetId(target.id);
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
    <div className="min-h-dvh bg-[var(--surface)]">
      <div className="max-w-md mx-auto">
        {/* ── Sticky deep-teal header ── */}
        <header className="sticky top-0 z-30 bg-[var(--teal)] text-white px-5 pt-5 pb-4 rounded-b-[20px]">
          <div className="flex items-start justify-between">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-white/70">
              {titleCase(dayName)} day
            </p>
            <button
              type="button"
              onClick={handleAbandon}
              aria-label="Workout options"
              className="-mt-1 -mr-1 p-1 text-white/60 hover:text-white transition-colors"
            >
              <MoreHorizontal className="size-5" />
            </button>
          </div>
          <h1 className="mt-1 text-2xl font-medium tracking-tight">Today&apos;s workout</h1>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <StatTile label="Exercises" value={String(byExercise.length)} />
            <StatTile label="Sets" value={`${completedCount}/${sets.length}`} />
            <StatTile label="Volume" value={formatVolume(volume)} />
          </div>
        </header>

        {/* ── Exercise cards ── */}
        <main className="px-4 py-4 space-y-3 pb-28">
          {byExercise.map(([exerciseName, exerciseSets]) => {
            const done = exerciseSets.filter((s) => s.completed).length;
            const total = exerciseSets.length;
            const expanded = exerciseSets.some(
              (s) => s.id === activeSetId || s.id === restingSetId,
            );
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
                  expanded={expanded}
                  onTap={expanded ? undefined : () => activateExercise(exerciseSets)}
                />

                {expanded && (
                  <div className="border-t border-[color:var(--hairline)]">
                    {exerciseSets.map((s, i) => {
                      const last = i === exerciseSets.length - 1;
                      if (s.id === activeSetId) {
                        return (
                          <ActiveSet
                            key={s.id}
                            set={s}
                            onCommit={(a) => handleCommit(s.id, a)}
                          />
                        );
                      }
                      if (s.id === restingSetId) {
                        return (
                          <div key={s.id} className="px-4 py-4">
                            <RestTimer seconds={restSeconds} onDone={() => setRestingSetId(null)} />
                          </div>
                        );
                      }
                      return (
                        <CompactSetRow
                          key={s.id}
                          set={s}
                          divider={!last}
                          onTap={() => {
                            setRestingSetId(null);
                            setActiveSetId(s.id);
                          }}
                        />
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}

          <button
            type="button"
            disabled={!allDone || pending}
            onClick={handleFinish}
            className="mt-4 h-12 w-full rounded-[12px] bg-[var(--teal)] text-white text-sm font-medium transition-opacity disabled:opacity-40"
          >
            {pending
              ? "Saving…"
              : allDone
                ? "Finish workout"
                : `Finish (${completedCount}/${sets.length} sets)`}
          </button>
        </main>
      </div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] border-[0.5px] border-white/15 bg-white/10 px-3 py-2.5">
      <p className="text-[11px] font-normal uppercase tracking-wide text-white/55">{label}</p>
      <p className="mt-0.5 text-xl font-medium tabular-nums text-white">{value}</p>
    </div>
  );
}

function ExerciseHeader({
  name,
  done,
  total,
  lead,
  expanded,
  onTap,
}: {
  name: string;
  done: number;
  total: number;
  lead: SessionSet;
  expanded: boolean;
  onTap?: () => void;
}) {
  const inner = (
    <>
      <div>
        <h2 className="text-base font-medium text-foreground">{titleCase(name)}</h2>
        <p className="mt-0.5 text-xs font-normal text-muted-foreground tabular-nums">
          {done} of {total} sets · {lead.prescribed.reps} × {lead.prescribed.weight} lbs
        </p>
      </div>
      {expanded ? (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--teal)]/10 text-[var(--teal)]">
          <Dumbbell className="size-4" />
        </span>
      ) : (
        <ChevronDown className="size-5 shrink-0 text-muted-foreground" />
      )}
    </>
  );

  const cls = "w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left";
  return onTap ? (
    <button type="button" onClick={onTap} className={cls}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

function CompactSetRow({
  set,
  divider,
  onTap,
}: {
  set: SessionSet;
  divider: boolean;
  onTap: () => void;
}) {
  const done = set.completed && set.actual;
  return (
    <button
      type="button"
      onClick={onTap}
      title={set.completed ? "Tap to re-edit" : "Tap to make active"}
      className={`w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-black/[0.02] ${
        divider ? "border-b border-[color:var(--hairline)]" : ""
      }`}
    >
      <span className="flex items-center gap-2 font-normal text-muted-foreground">
        {done && <Check className="size-3.5" style={{ color: "var(--teal)" }} />}
        Set {set.setNumber}
      </span>
      <span className="flex items-center gap-2 tabular-nums text-muted-foreground">
        {done
          ? `${set.actual!.reps} × ${set.actual!.weight} lbs`
          : `${set.prescribed.reps} × ${set.prescribed.weight} lbs`}
        {done && (
          <span
            aria-hidden
            className="size-1.5 rounded-full"
            style={{ backgroundColor: feelColor[set.actual!.feeling] }}
          />
        )}
      </span>
    </button>
  );
}

function ActiveSet({
  set,
  onCommit,
}: {
  set: SessionSet;
  onCommit: (actual: Actual) => Promise<void>;
}) {
  const [reps, setReps] = useState(set.prescribed.reps);
  const [weight, setWeight] = useState(set.prescribed.weight);
  const [submitting, setSubmitting] = useState<Feeling | null>(null);

  const commit = async (feeling: Feeling) => {
    setSubmitting(feeling);
    try {
      await onCommit({ reps, weight, feeling });
    } finally {
      setSubmitting(null);
    }
  };

  const numberField =
    "w-full h-16 rounded-[12px] border-[0.5px] border-[color:var(--hairline)] bg-[#fafaf9] text-center text-3xl font-medium text-foreground outline-none transition-colors focus:border-[var(--teal)] focus:ring-2 focus:ring-[var(--teal)]/15 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

  return (
    <div className="px-4 py-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-normal uppercase tracking-wide text-muted-foreground">
          Set {set.setNumber} · prescribed {set.prescribed.reps} × {set.prescribed.weight}
        </p>
        <span className="rounded-full bg-[var(--teal)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--teal)]">
          active
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-center text-[11px] font-normal uppercase tracking-wide text-muted-foreground">
            Reps
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={99}
            value={reps}
            onChange={(e) => setReps(Number(e.target.value))}
            className={`mt-1.5 ${numberField}`}
          />
        </label>
        <label className="block">
          <span className="block text-center text-[11px] font-normal uppercase tracking-wide text-muted-foreground">
            Weight (lbs)
          </span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={2.5}
            value={weight}
            onChange={(e) => setWeight(Number(e.target.value))}
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
