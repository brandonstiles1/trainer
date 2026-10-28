import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { workouts, workoutSets, bodyWeights } from "@/lib/db/schema";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { formatWeight, titleCase } from "@/lib/format";
import { metaFor } from "@/lib/program/structure";
import { summarizeProgress, weeklyCounts } from "@/lib/progress/summarize";
import { summarizeWorkout } from "@/lib/workouts/summarize-workout";
import { activeProgramFor, allHistoryRows } from "@/lib/workouts/log-book";
import { Sparkline, WeekBars } from "@/components/progress/charts";
import { WorkoutHistory } from "./history";
import { BodyWeight } from "./body-weight";

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export default async function ProgressPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ program }, rows, finished, weights] = await Promise.all([
    activeProgramFor(user.id),
    allHistoryRows(user.id),
    db
      .select()
      .from(workouts)
      .where(and(eq(workouts.userId, user.id), ne(workouts.status, "in_progress")))
      .orderBy(desc(workouts.startedAt))
      .limit(60),
    db
      .select()
      .from(bodyWeights)
      .where(eq(bodyWeights.userId, user.id))
      .orderBy(asc(bodyWeights.recordedAt)),
  ]);

  const lifts = summarizeProgress(rows);
  const routine = new Map(program.days.flatMap((d) => d.exercises).map((e) => [e.name, e]));
  const equipment = (name: string) => metaFor(routine.get(name) ?? { name }).type;

  const completed = finished.filter((w) => w.status === "completed" && w.completedAt);
  const weeks = weeklyCounts(completed.map((w) => w.completedAt!), new Date()).map((w) => ({
    label: shortDate(w.week),
    count: w.count,
  }));
  const thisWeek = weeks[weeks.length - 1]?.count ?? 0;
  const target = program.days.length;

  const recent = finished.slice(0, 20);
  const recentSets = recent.length
    ? await db.select().from(workoutSets).where(inArray(workoutSets.workoutId, recent.map((w) => w.id)))
    : [];
  const dayTitle = (dayKey: string, isExtra: boolean) => {
    if (dayKey === "custom") return "Custom session";
    const d = program.days.find((x) => x.category === dayKey);
    return `${isExtra ? "Extra · " : ""}${d ? `${d.day} · ${d.title}` : titleCase(dayKey)}`;
  };
  const history = recent.map((w) => {
    const mine = recentSets
      .filter((r) => r.workoutId === w.id)
      .map((r) => ({
        exerciseName: r.exerciseName,
        setNumber: r.setNumber,
        actual: r.actual as { reps: number; weight: number } | null,
      }));
    return {
      id: w.id,
      title: dayTitle(w.dayKey, w.isExtra),
      status: w.status,
      startedAt: w.startedAt.toISOString(),
      setCount: mine.filter((r) => r.actual !== null).length,
      ...summarizeWorkout(mine),
    };
  });

  return (
    <main className="px-4 pt-8 pb-24 max-w-md mx-auto space-y-6">
      <h1 className="px-1 text-2xl font-semibold">Progress</h1>

      <section className="rounded-[13px] border-[0.5px] border-[color:var(--hairline)] bg-white p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium">Consistency</h2>
          <p className="text-sm tabular-nums">
            <span className="font-medium">{thisWeek}</span>
            <span className="text-muted-foreground">/{target} this week</span>
          </p>
        </div>
        <div className="mt-8">
          <WeekBars weeks={weeks} target={target} />
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">Last 8 weeks · dashed line = {target} per week</p>
      </section>

      <section>
        <h2 className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Lifts</h2>
        {lifts.length === 0 ? (
          <p className="mt-2 px-1 text-sm text-muted-foreground">Finish a workout and your lifts show up here.</p>
        ) : (
          <ul className="mt-2 rounded-[13px] border-[0.5px] border-[color:var(--hairline)] bg-white divide-y divide-[color:var(--hairline)]">
            {lifts.map((l) => {
              const eq = equipment(l.name);
              return (
                <li key={l.name}>
                  <Link href={`/progress/${l.name}`} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium">{titleCase(l.name)}</p>
                      <p className="text-xs tabular-nums text-muted-foreground">
                        {formatWeight(l.current, eq)}
                        {l.change !== 0 && (
                          <span className={l.change > 0 ? "text-[var(--teal)]" : ""}>
                            {" "}({l.change > 0 ? "+" : "−"}{Math.abs(l.change)})
                          </span>
                        )}
                        {l.pr && ` · PR ${l.pr.weight}×${l.pr.reps}`}
                      </p>
                    </div>
                    <Sparkline values={l.points.map((p) => p.weight)} />
                    <ChevronRight className="size-4 text-muted-foreground/60" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <BodyWeight
        entries={weights.map((w) => ({ id: w.id, weight: w.weightLbs, date: w.recordedAt.toISOString() }))}
      />

      <WorkoutHistory items={history} />
    </main>
  );
}
