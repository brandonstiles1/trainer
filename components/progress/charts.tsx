"use client";

import { useState } from "react";

export type ChartPoint = { label: string; value: number; detail?: string };

const W = 320;
const PAD = { top: 12, right: 12, bottom: 22, left: 36 };

function niceTicks(min: number, max: number, count = 3): number[] {
  if (min === max) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let t = Math.floor(min / step) * step; t <= max + 1e-9; t += step) ticks.push(Math.round(t * 100) / 100);
  return ticks;
}

/**
 * One series over time: 2px line, 8px markers, a crosshair + tooltip on
 * hover or tap. The series is named by the chart's title, so no legend.
 */
export function LineChart({
  points,
  height = 160,
  unit = "lb",
  ariaLabel,
}: {
  points: ChartPoint[];
  height?: number;
  unit?: string;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length === 0) return null;

  const values = points.map((p) => p.value);
  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const lo = Math.min(ticks[0], ...values);
  const hi = Math.max(ticks[ticks.length - 1], ...values);
  const span = hi - lo || 1;
  const innerW = W - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - ((v - lo) / span) * innerH;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.value)}`).join(" ");

  const pick = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setHover(best);
  };

  const h = hover !== null ? points[hover] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="w-full touch-pan-y select-none"
        role="img"
        aria-label={ariaLabel}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--hairline)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground text-[10px] tabular-nums">
              {t}
            </text>
          </g>
        ))}
        <text x={PAD.left} y={height - 6} className="fill-muted-foreground text-[10px]">{points[0].label}</text>
        {points.length > 1 && (
          <text x={W - PAD.right} y={height - 6} textAnchor="end" className="fill-muted-foreground text-[10px]">
            {points[points.length - 1].label}
          </text>
        )}
        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--muted-foreground)" strokeOpacity={0.4} strokeWidth={1} />
        )}
        <path d={path} fill="none" stroke="var(--teal)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(p.value)}
            r={hover === i ? 5 : 4}
            fill="var(--teal)"
            stroke="white"
            strokeWidth={2}
          />
        ))}
      </svg>
      {h && hover !== null && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-[8px] border-[0.5px] border-[color:var(--hairline)] bg-white px-2 py-1 text-[11px] shadow-sm whitespace-nowrap"
          style={{ left: `${Math.min(85, Math.max(15, (x(hover) / W) * 100))}%` }}
        >
          <span className="font-medium tabular-nums">{h.value} {unit}</span>
          <span className="text-muted-foreground"> · {h.label}</span>
          {h.detail && <div className="text-muted-foreground tabular-nums">{h.detail}</div>}
        </div>
      )}
    </div>
  );
}

/** Workouts per week. Bars anchored at the baseline, a target line for the plan. */
export function WeekBars({ weeks, target }: { weeks: Array<{ label: string; count: number }>; target: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(target, ...weeks.map((w) => w.count), 1);
  const H = 64;
  const gap = 2;
  const bw = (W - gap * (weeks.length - 1)) / weeks.length;
  const y = (v: number) => H - (v / max) * H;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Workouts per week, last 8 weeks">
        {weeks.map((w, i) => (
          <g key={w.label} onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} onPointerLeave={() => setHover(null)}>
            <rect x={i * (bw + gap)} y={0} width={bw} height={H} fill="transparent" />
            {w.count > 0 ? (
              <rect
                x={i * (bw + gap)}
                y={y(w.count)}
                width={bw}
                height={H - y(w.count)}
                rx={4}
                fill="var(--teal)"
                fillOpacity={hover === null || hover === i ? 1 : 0.5}
              />
            ) : (
              <rect x={i * (bw + gap)} y={H - 2} width={bw} height={2} rx={1} fill="var(--hairline)" />
            )}
          </g>
        ))}
        <line x1={0} x2={W} y1={y(target)} y2={y(target)} stroke="var(--muted-foreground)" strokeDasharray="3 3" strokeOpacity={0.5} />
      </svg>
      {hover !== null && (
        <p className="pointer-events-none absolute -top-6 left-0 text-[11px] text-muted-foreground tabular-nums">
          Week of {weeks[hover].label}: <span className="font-medium text-foreground">{weeks[hover].count}</span>
        </p>
      )}
    </div>
  );
}

/** Tiny trend line for list rows; decoration next to the number, no interaction. */
export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="inline-block w-16" />;
  const lo = Math.min(...values);
  const span = Math.max(...values) - lo || 1;
  const d = values
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i / (values.length - 1)) * 60 + 2},${20 - ((v - lo) / span) * 16}`)
    .join(" ");
  return (
    <svg viewBox="0 0 64 24" className="h-6 w-16" aria-hidden>
      <path d={d} fill="none" stroke="var(--teal)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
