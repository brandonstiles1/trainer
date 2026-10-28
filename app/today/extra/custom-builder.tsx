"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StartButton } from "../start-button";

export function CustomBuilder({ routine, others }: { routine: string[]; others: string[] }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);

  const toggle = (name: string) =>
    setPicked((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));

  const list = showAll ? [...routine, ...others] : routine;

  return (
    <div className="space-y-3">
      <ul className="rounded-[13px] border-[0.5px] border-[color:var(--hairline)] bg-white divide-y divide-[color:var(--hairline)]">
        {list.map((name) => {
          const on = picked.includes(name);
          return (
            <li key={name}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => toggle(name)}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm"
              >
                <span className={on ? "font-medium" : ""}>{titleCase(name)}</span>
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full border",
                    on ? "border-[var(--teal)] bg-[var(--teal)] text-white" : "border-[color:var(--hairline)]",
                  )}
                >
                  {on && <Check className="size-3" />}
                  {on && <span className="sr-only">#{picked.indexOf(name) + 1}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {!showAll && others.length > 0 && (
        <button type="button" onClick={() => setShowAll(true)} className="px-1 text-xs font-medium text-[var(--teal)]">
          Show more exercises
        </button>
      )}
      <StartButton
        request={{ kind: "custom", exercises: picked }}
        disabled={picked.length === 0}
        label={picked.length === 0 ? "Pick exercises" : `Start (${picked.length} exercise${picked.length === 1 ? "" : "s"})`}
      />
    </div>
  );
}
