"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { deleteWorkout } from "@/lib/actions/workout-history";

type Item = {
  id: string; dayKey: string; status: string; startedAt: string;
  setCount: number; volume: number; exercises: { name: string; sets: string[] }[];
};
const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function WorkoutsList({ items }: { items: Item[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(items[0]?.id ?? null);
  const [menu, setMenu] = useState<string | null>(null);

  async function onDelete(id: string) {
    if (!confirm("Delete this workout? This can't be undone.")) return;
    await deleteWorkout(id);
    router.refresh();
  }

  return (
    <main className="px-4 py-6 max-w-md mx-auto pb-24">
      <h1 className="px-1 text-2xl font-bold">Workouts</h1>
      <div className="mt-4 space-y-3">
        {items.map((w) => {
          const isOpen = open === w.id;
          return (
            <section key={w.id} className="rounded-[13px] bg-white border-[0.5px] border-[color:var(--hairline)] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3">
                <button className="min-w-0 text-left" onClick={() => setOpen(isOpen ? null : w.id)}>
                  <h2 className="text-[15px] font-semibold capitalize">{w.dayKey}
                    <span className="ml-2 rounded-full bg-[var(--teal)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--teal)]">{w.status}</span>
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {new Date(w.startedAt).toLocaleDateString()} · {w.setCount} sets · {w.volume.toLocaleString()} lbs
                  </p>
                </button>
                <div className="flex items-center gap-1">
                  <button aria-label="Options" onClick={() => setMenu(menu === w.id ? null : w.id)} className="p-1 text-muted-foreground">
                    <MoreHorizontal className="size-5" />
                  </button>
                  <ChevronDown className={`size-5 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </div>
              </div>
              {menu === w.id && (
                <div className="border-t border-[color:var(--hairline)] px-4 py-2">
                  <button onClick={() => onDelete(w.id)} className="text-sm font-medium text-red-600">Delete workout</button>
                </div>
              )}
              {isOpen && (
                <div className="border-t border-[color:var(--hairline)]">
                  {w.exercises.map((ex) => (
                    <div key={ex.name} className="px-4 py-2.5 border-b border-[color:var(--hairline)] last:border-0">
                      <p className="text-xs font-semibold capitalize text-foreground">{titleCase(ex.name)}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">{ex.sets.join(" · ")}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
        {items.length === 0 && <p className="px-1 text-sm text-muted-foreground">No workouts yet.</p>}
      </div>
    </main>
  );
}
