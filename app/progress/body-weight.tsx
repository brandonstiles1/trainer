"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { logBodyWeight } from "@/lib/actions/settings";
import { LineChart } from "@/components/progress/charts";

/** Optional: log a weigh-in now and then. Nothing else depends on it. */
export function BodyWeight({ entries }: { entries: Array<{ id: string; weight: number; date: string }> }) {
  const [value, setValue] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const latest = entries[entries.length - 1];

  const save = () =>
    start(async () => {
      const n = Number(value);
      if (!Number.isFinite(n)) return;
      await logBodyWeight(n);
      setValue("");
      router.refresh();
    });

  return (
    <section className="rounded-[13px] border-[0.5px] border-[color:var(--hairline)] bg-white p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium">Body weight</h2>
        {latest && <p className="text-sm font-medium tabular-nums">{latest.weight} lb</p>}
      </div>
      {entries.length > 1 && (
        <div className="mt-3">
          <LineChart
            ariaLabel="Body weight over time"
            height={120}
            points={entries.map((e) => ({
              label: new Date(e.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
              value: e.weight,
            }))}
          />
        </div>
      )}
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input
          type="text"
          inputMode="decimal"
          placeholder={latest ? String(latest.weight) : "lb"}
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, "").slice(0, 5))}
          aria-label="Body weight in pounds"
          className="h-10 min-w-0 flex-1 rounded-[10px] border-[0.5px] border-[color:var(--hairline)] bg-[#fafaf9] px-3 text-sm tabular-nums outline-none focus:border-[var(--teal)]"
        />
        <button
          type="submit"
          disabled={pending || value === ""}
          className="h-10 rounded-[10px] bg-[var(--teal)] px-4 text-sm font-medium text-white disabled:opacity-40"
        >
          Log
        </button>
      </form>
    </section>
  );
}
