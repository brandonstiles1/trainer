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
  const [open, setOpen] = useState<Set<string>>(() => new Set(items[0] ? [items[0].id] : []));
  const [menu, setMenu] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  function toggle(id: string) {
    setMenu(null);
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onDelete(id: string) {
    setConfirmDelete(null);
    await deleteWorkout(id);
    router.refresh();
  }

  return (
    <main className="px-4 py-6 max-w-md mx-auto pb-24">
      <h1 className="px-1 text-2xl font-bold">Workouts</h1>
      <div className="mt-4 space-y-3">
        {items.map((w) => {
          const isOpen = open.has(w.id);
          return (
            <section key={w.id} className="rounded-[13px] bg-white border-[0.5px] border-[color:var(--hairline)] overflow-hidden">
              <div className="flex items-stretch">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => toggle(w.id)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3 text-left transition-colors active:bg-black/[0.03]"
                >
                  <div className="min-w-0">
                    <h2 className="text-[15px] font-semibold capitalize">{w.dayKey}
                      <span className="ml-2 rounded-full bg-[var(--teal)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--teal)]">{w.status}</span>
                    </h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {new Date(w.startedAt).toLocaleDateString()} · {w.setCount} sets · {w.volume.toLocaleString()} lbs
                    </p>
                  </div>
                  <ChevronDown className={`size-5 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>
                <button
                  type="button"
                  aria-label="Options"
                  onClick={() => setMenu(menu === w.id ? null : w.id)}
                  className="px-3 text-muted-foreground transition-colors active:bg-black/[0.03]"
                >
                  <MoreHorizontal className="size-5" />
                </button>
              </div>
              {menu === w.id && (
                <div className="border-t border-[color:var(--hairline)] px-4 py-2">
                  <button onClick={() => { setMenu(null); setConfirmDelete(w.id); }} className="text-sm font-medium text-red-600">Delete workout</button>
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

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-8"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="w-full max-w-sm rounded-[18px] bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-foreground">Delete this workout?</h3>
            <p className="mt-1 text-sm text-muted-foreground">This permanently removes the session and its logged sets.</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="h-11 flex-1 rounded-[12px] border-[0.5px] border-[color:var(--hairline)] text-sm font-medium text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => onDelete(confirmDelete)}
                className="h-11 flex-1 rounded-[12px] bg-[var(--feel-hard-bg)] text-sm font-medium text-[var(--feel-hard-fg)]"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
