import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { workouts } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { cn } from "@/lib/utils";
import { formatSets, formatWeight, titleCase } from "@/lib/format";
import { estimateMinutes } from "@/lib/program/structure";
import {
  activeProgramFor,
  nextDayFor,
  prescribeSlots,
  settingsFor,
} from "@/lib/workouts/log-book";
import type { Prescription } from "@/lib/workouts/prescribe";
import { StartButton } from "./start-button";
import { ProgramButton } from "./program-button";

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Mid-workout? Go straight back to it.
  const [inProgress] = await db
    .select({ id: workouts.id })
    .from(workouts)
    .where(and(eq(workouts.userId, user.id), eq(workouts.status, "in_progress")))
    .limit(1);
  if (inProgress) redirect(`/workout/${inProgress.id}`);

  const { program, legacy } = await activeProgramFor(user.id);
  const [queued, settings] = await Promise.all([nextDayFor(user.id, program), settingsFor(user.id)]);
  const picked = (await searchParams).day;
  const day = program.days.find((d) => d.day === picked) ?? queued;

  if (!day) {
    return (
      <main className="px-4 py-8 max-w-md mx-auto">
        <p className="text-sm text-muted-foreground">Your routine is empty — add exercises in Settings.</p>
      </main>
    );
  }

  const prescriptions = await prescribeSlots(user.id, day.exercises);
  const isQueued = day.category === queued?.category;

  return (
    <main className="px-4 pt-8 pb-24 max-w-md mx-auto space-y-5">
      {legacy && (
        <section className="rounded-[13px] border-[0.5px] border-[color:var(--hairline)] bg-white p-4 space-y-3">
          <p className="text-sm">
            Your plan is from the old weekday setup. Switch to the 4-day A/B/C/D program? Your history
            stays.
          </p>
          <ProgramButton label="Use the A/B/C/D program" />
        </section>
      )}

      <header>
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {isQueued ? "Next up" : "Picked"}
        </p>
        <h1 className="mt-1 text-2xl font-semibold">
          <span className="text-[var(--teal)]">{day.day}</span> · {day.title}
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          ~{estimateMinutes(day.exercises, settings)} min · {day.exercises.length} exercises
        </p>
      </header>

      <ol className="rounded-[13px] border-[0.5px] border-[color:var(--hairline)] bg-white divide-y divide-[color:var(--hairline)]">
        {prescriptions.map((p) => (
          <ExerciseRow key={p.spec.name} p={p} />
        ))}
      </ol>

      <StartButton
        request={{ kind: "rotation", day: isQueued ? undefined : day.day }}
        label={isQueued ? "Start Workout" : `Start Workout ${day.day}`}
      />

      <nav aria-label="Choose a workout" className="flex items-center gap-2">
        {program.days.map((d) => (
          <Link
            key={d.day}
            href={d.category === queued?.category ? "/today" : `/today?day=${d.day}`}
            aria-current={d.category === day.category ? "true" : undefined}
            className={cn(
              "flex h-10 flex-1 items-center justify-center rounded-[10px] border-[0.5px] text-sm font-medium",
              d.category === day.category
                ? "border-[var(--teal)] bg-[var(--teal)]/10 text-[var(--teal)]"
                : "border-[color:var(--hairline)] bg-white text-muted-foreground",
            )}
          >
            {d.day}
          </Link>
        ))}
        <Link
          href="/today/extra"
          className="flex h-10 flex-[1.6] items-center justify-center gap-1 rounded-[10px] border-[0.5px] border-[color:var(--hairline)] bg-white text-sm font-medium text-muted-foreground"
        >
          <Plus className="size-3.5" /> Extra
        </Link>
      </nav>
    </main>
  );
}

function ExerciseRow({ p }: { p: Prescription }) {
  const { spec, recommendation: rec, meta, last } = p;
  const moved = rec.action === "increase" || rec.action === "decrease" || rec.action === "ease_back";
  return (
    <li className="px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[15px] font-medium">{titleCase(spec.name)}</span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {spec.sets} × {spec.repMin}–{spec.repMax}
          {spec.notes === "per leg" ? " / leg" : ""}
        </span>
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-3 text-xs tabular-nums">
        <span className="truncate text-muted-foreground">
          {last ? `Last ${formatSets(last.allSets, meta.type)}` : "No history yet"}
        </span>
        <span
          className={cn(
            "flex shrink-0 items-center gap-0.5 font-medium",
            rec.action === "increase" ? "text-[var(--teal)]" : "text-foreground",
          )}
        >
          {rec.action === "increase" && <ArrowUp className="size-3" />}
          {(rec.action === "decrease" || rec.action === "ease_back") && <ArrowDown className="size-3" />}
          {rec.action === "start" && rec.weight === 0 ? "Set weight" : formatWeight(rec.weight, meta.type)}
        </span>
      </div>
      {moved && <p className="mt-1 text-[11px] leading-snug text-[var(--teal)]">{rec.reason}</p>}
    </li>
  );
}
