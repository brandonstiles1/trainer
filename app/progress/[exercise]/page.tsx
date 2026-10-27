import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, Trophy } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatSets, formatWeight, titleCase } from "@/lib/format";
import { metaFor } from "@/lib/program/structure";
import { summarizeProgress } from "@/lib/progress/summarize";
import { activeProgramFor, allHistoryRows } from "@/lib/workouts/log-book";
import { LineChart } from "@/components/progress/charts";

export default async function ExerciseProgressPage({ params }: { params: Promise<{ exercise: string }> }) {
  const { exercise } = await params;
  if (!/^[a-z0-9_]+$/.test(exercise)) notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ program }, rows] = await Promise.all([activeProgramFor(user.id), allHistoryRows(user.id)]);
  const [lift] = summarizeProgress(rows.filter((r) => r.exerciseName === exercise));
  if (!lift) notFound();

  const entry = program.days.flatMap((d) => d.exercises).find((e) => e.name === exercise);
  const eq = metaFor(entry ?? { name: exercise }).type;
  const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <main className="px-4 pt-6 pb-24 max-w-md mx-auto space-y-5">
      <header>
        <Link href="/progress" className="-ml-1 inline-flex items-center text-sm text-muted-foreground">
          <ChevronLeft className="size-4" /> Progress
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{titleCase(exercise)}</h1>
        <p className="mt-0.5 flex items-center gap-3 text-sm tabular-nums text-muted-foreground">
          <span>Working weight {formatWeight(lift.current, eq)}</span>
          {lift.pr && (
            <span className="flex items-center gap-1 text-[var(--teal)]">
              <Trophy className="size-3.5" /> {lift.pr.weight}×{lift.pr.reps}
            </span>
          )}
        </p>
      </header>

      <section className="rounded-[13px] border-[0.5px] border-[color:var(--hairline)] bg-white p-4">
        <h2 className="text-sm font-medium">Working weight{eq === "dumbbell" ? " (per dumbbell)" : ""}</h2>
        <div className="mt-3">
          <LineChart
            ariaLabel={`${titleCase(exercise)} working weight over time`}
            points={lift.points.map((p) => ({
              label: date(p.date),
              value: p.weight,
              detail: `${p.sets.map((x) => x.reps).join(", ")} reps${p.complete ? "" : " · incomplete"}`,
            }))}
          />
        </div>
      </section>

      <section>
        <h2 className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Sessions</h2>
        <table className="mt-2 w-full overflow-hidden rounded-[13px] border-[0.5px] border-[color:var(--hairline)] bg-white text-sm">
          <tbody className="divide-y divide-[color:var(--hairline)]">
            {[...lift.points].reverse().map((p) => (
              <tr key={p.date}>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{date(p.date)}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums ${p.complete ? "" : "text-muted-foreground"}`}>
                  {formatSets(p.sets, eq)}
                  {!p.complete && <span className="ml-1 text-[10px]">incomplete</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
