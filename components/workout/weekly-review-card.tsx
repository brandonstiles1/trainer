import { Quote } from "lucide-react";

export type WeeklyReviewNote = {
  headline: string;
  observations: Array<{ exerciseName: string | null; note: string }>;
  createdAt: string;
};

const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const weekOf = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/**
 * The coach's note on the last week. Commentary — it never carries a target,
 * because targets come from the log book alone.
 */
export function WeeklyReviewCard({ review }: { review: WeeklyReviewNote }) {
  return (
    <section className="rounded-[13px] border-[0.5px] border-[color:var(--hairline)] bg-[var(--teal)]/[0.04] px-4 py-3.5">
      <div className="flex items-center gap-2">
        <Quote className="size-3.5 text-[var(--teal)]" />
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-[var(--teal)]">
          Week of {weekOf(review.createdAt)}
        </h2>
      </div>
      <p className="mt-2 text-sm font-medium leading-snug text-foreground">{review.headline}</p>
      {review.observations.length > 0 && (
        <ul className="mt-2.5 space-y-1.5">
          {review.observations.map((o, i) => (
            <li key={i} className="flex gap-2 text-xs leading-snug text-muted-foreground">
              <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-[var(--teal)]/50" />
              <span>
                {o.exerciseName && (
                  <span className="font-medium text-foreground">{titleCase(o.exerciseName)}: </span>
                )}
                {o.note}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
