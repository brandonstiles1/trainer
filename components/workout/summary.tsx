"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export type SummarySet = {
  exerciseName: string;
  setNumber: number;
  prescribed: { reps: number; weight: number };
  actual: { reps: number; weight: number; feeling: string } | null;
};

export function Summary({ sets }: { sets: SummarySet[] }) {
  const router = useRouter();
  const grouped = new Map<string, SummarySet[]>();
  for (const s of sets) {
    if (!grouped.has(s.exerciseName)) grouped.set(s.exerciseName, []);
    grouped.get(s.exerciseName)!.push(s);
  }

  return (
    <main className="px-6 py-8 max-w-md mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Workout complete 💪</h1>
        <p className="text-muted-foreground text-sm mt-1">Here's what you did.</p>
      </div>

      <div className="space-y-4">
        {[...grouped.entries()].map(([ex, rows]) => (
          <section key={ex} className="rounded-lg border p-4 bg-muted/30">
            <h2 className="font-semibold capitalize">{ex.replace(/_/g, " ")}</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {rows.map((r) => (
                <li key={r.setNumber} className="flex justify-between">
                  <span>Set {r.setNumber}</span>
                  <span>
                    {r.actual
                      ? `${r.actual.reps} × ${r.actual.weight} lbs (${r.actual.feeling})`
                      : "skipped"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <Button className="w-full" size="lg" onClick={() => router.push("/today")}>
        Done
      </Button>
    </main>
  );
}
