"use client";

import { useState } from "react";
import { saveSettings } from "@/lib/actions/settings";
import type { ProgressionSettings } from "@/lib/program/settings";

type NumKey = { [K in keyof ProgressionSettings]: ProgressionSettings[K] extends number ? K : never }[keyof ProgressionSettings];

const ROWS: Array<{ key: NumKey; label: string; hint?: string; step: number; suffix: string }> = [
  { key: "dumbbellStep", label: "Dumbbells", hint: "per dumbbell", step: 0.5, suffix: "lb" },
  { key: "barbellUpperStep", label: "Barbell, upper body", step: 2.5, suffix: "lb" },
  { key: "barbellLowerStep", label: "Barbell, lower body", step: 2.5, suffix: "lb" },
  { key: "machineUpperStep", label: "Cable / machine, upper", hint: "isolation lifts use this too", step: 0.5, suffix: "lb" },
  { key: "machineLowerStep", label: "Cable / machine, lower", step: 0.5, suffix: "lb" },
  { key: "bodyweightStep", label: "Bodyweight", hint: "added load or assistance", step: 2.5, suffix: "lb" },
];

const RULES: Array<{ key: NumKey; label: string; hint: string; step: number; suffix: string }> = [
  { key: "successSessions", label: "Sessions at the top to move up", hint: "every set at the top of the range", step: 1, suffix: "" },
  { key: "missSessions", label: "Missed sessions before a step down", hint: "below the bottom of the range", step: 1, suffix: "" },
  { key: "breakDays", label: "Ease back in after", hint: "suggests ~10% lighter", step: 1, suffix: "days" },
  { key: "restCompoundSeconds", label: "Rest, compound lifts", hint: "", step: 15, suffix: "s" },
  { key: "restIsolationSeconds", label: "Rest, isolation lifts", hint: "", step: 15, suffix: "s" },
];

/** Every change saves immediately — no Save button to forget. */
export function ProgressionForm({ settings: initial }: { settings: ProgressionSettings }) {
  const [settings, setSettings] = useState(initial);
  const [error, setError] = useState(false);

  const update = (patch: Partial<ProgressionSettings>) => {
    const optimistic = { ...settings, ...patch };
    setSettings(optimistic);
    setError(false);
    saveSettings(patch)
      .then(setSettings)
      .catch(() => {
        setSettings(settings);
        setError(true);
      });
  };

  return (
    <div className="space-y-3">
      <Card title="Weight steps">
        {ROWS.map((r) => (
          <Stepper key={r.key} label={r.label} hint={r.hint} step={r.step} suffix={r.suffix} value={settings[r.key]} onChange={(v) => update({ [r.key]: v })} />
        ))}
      </Card>
      <Card title="Rules">
        {RULES.map((r) => (
          <Stepper key={r.key} label={r.label} hint={r.hint} step={r.step} suffix={r.suffix} value={settings[r.key]} onChange={(v) => update({ [r.key]: v })} />
        ))}
        <label className="flex items-center justify-between px-4 py-3">
          <span className="text-sm">Rest timer after each set</span>
          <input
            type="checkbox"
            checked={settings.restTimer}
            onChange={(e) => update({ restTimer: e.target.checked })}
            className="size-5 accent-[var(--teal)]"
          />
        </label>
      </Card>
      {error && <p className="px-1 text-xs text-destructive">Couldn&apos;t save — try again.</p>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[13px] border-[0.5px] border-[color:var(--hairline)] bg-white">
      <p className="px-4 pt-3 text-sm font-medium">{title}</p>
      <div className="divide-y divide-[color:var(--hairline)]">{children}</div>
    </div>
  );
}

function Stepper({
  label,
  hint,
  value,
  step,
  suffix,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  step: number;
  suffix: string;
  onChange: (v: number) => void;
}) {
  const btn = "h-9 w-9 text-lg text-muted-foreground active:text-foreground";
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex shrink-0 items-center rounded-[10px] border-[0.5px] border-[color:var(--hairline)]">
        <button type="button" aria-label={`Decrease ${label}`} className={btn} onClick={() => onChange(+(value - step).toFixed(2))}>
          −
        </button>
        <span className="min-w-12 text-center text-sm font-medium tabular-nums">
          {value}
          {suffix && <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">{suffix}</span>}
        </span>
        <button type="button" aria-label={`Increase ${label}`} className={btn} onClick={() => onChange(+(value + step).toFixed(2))}>
          +
        </button>
      </div>
    </div>
  );
}
