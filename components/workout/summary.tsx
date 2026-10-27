import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatSets, formatWeight, titleCase } from "@/lib/format";
import type { RecommendAction } from "@/lib/engine/double-progression";

export type SummaryExercise = {
  name: string;
  equipment: string;
  /** In set order; null = skipped. */
  sets: Array<{ reps: number; weight: number } | null>;
  next: { action: RecommendAction; weight: number; reason: string };
};

/** After the workout: what you did, and what each exercise is set to next time. */
export function Summary({
  title,
  status,
  exercises,
}: {
  title: string;
  status: string;
  exercises: SummaryExercise[];
}) {
  return (
    <main className="px-4 pt-8 pb-24 max-w-md mx-auto space-y-5">
      <header>
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {status === "completed" ? "Done" : "Discarded"}
        </p>
        <h1 className="mt-1 text-2xl font-semibold">{title}</h1>
      </header>

      <ul className="rounded-[13px] border-[0.5px] border-[color:var(--hairline)] bg-white divide-y divide-[color:var(--hairline)]">
        {exercises.map((ex) => {
          const logged = ex.sets.filter((s): s is { reps: number; weight: number } => s !== null);
          const up = ex.next.action === "increase";
          const down = ex.next.action === "decrease" || ex.next.action === "ease_back";
          return (
            <li key={ex.name} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[15px] font-medium">{titleCase(ex.name)}</span>
                {status === "completed" && (
                  <span
                    className={cn(
                      "flex shrink-0 items-center gap-0.5 text-xs font-medium tabular-nums",
                      up ? "text-[var(--teal)]" : "text-muted-foreground",
                    )}
                  >
                    {up && <ArrowUp className="size-3" />}
                    {down && <ArrowDown className="size-3" />}
                    Next {formatWeight(ex.next.weight, ex.equipment)}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                {logged.length > 0 ? formatSets(logged, ex.equipment) : "Skipped"}
                {logged.length > 0 && logged.length < ex.sets.length && ` · ${ex.sets.length - logged.length} skipped`}
              </p>
              {status === "completed" && up && (
                <p className="mt-1 text-[11px] leading-snug text-[var(--teal)]">{ex.next.reason}</p>
              )}
            </li>
          );
        })}
      </ul>

      <Link
        href="/today"
        className="flex h-12 w-full items-center justify-center rounded-[12px] bg-[var(--teal)] text-sm font-medium text-white"
      >
        Done
      </Link>
    </main>
  );
}
