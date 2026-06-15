"use client";
import { useState } from "react";
import { ChevronDown } from "lucide-react";

type Ex = { name: string; order: number; notes?: string };
const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function PlanPreview({ category, exercises }: { category: string; exercises: Ex[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const sorted = [...exercises].sort((a, b) => a.order - b.order);
  return (
    <section className="space-y-3">
      <p className="px-1 text-xs uppercase tracking-wide text-muted-foreground">{category}</p>
      {sorted.map((e) => {
        const isOpen = open === e.name;
        return (
          <div key={e.name} className="rounded-[13px] bg-white border-[0.5px] border-[color:var(--hairline)] overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-4 py-3 text-left"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : e.name)}
            >
              <span className="text-[15px] font-medium capitalize">{titleCase(e.name)}</span>
              <ChevronDown className={`size-5 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </button>
            {isOpen && e.notes && (
              <p className="border-t border-[color:var(--hairline)] px-4 py-2.5 text-xs text-muted-foreground">{e.notes}</p>
            )}
          </div>
        );
      })}
    </section>
  );
}
