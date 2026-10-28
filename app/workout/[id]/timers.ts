import { useCallback, useEffect, useState } from "react";

type PauseState = { pausedAtMs: number | null; totalPausedMs: number };

/** Timestamp-based count-up clock with pause/resume, persisted to localStorage
 *  so it stays correct across re-renders, navigation, reload and lock/unlock. */
export function usePausableClock(startMs: number, workoutId: string) {
  const storageKey = `trainer:pause:${workoutId}:${startMs}`;
  const [pause, setPause] = useState<PauseState>({ pausedAtMs: null, totalPausedMs: 0 });
  const [now, setNow] = useState(startMs);

  // Resume persisted pause state post-mount (hydration-safe, like useRestTimer).
  useEffect(() => {
    const resume = () => {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) setPause(JSON.parse(raw) as PauseState);
      } catch {
        /* ignore */
      }
    };
    const id = setTimeout(resume, 0);
    return () => clearTimeout(id);
  }, [storageKey]);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const toggle = useCallback(() => {
    setPause((prev) => {
      const next: PauseState =
        prev.pausedAtMs !== null
          ? { pausedAtMs: null, totalPausedMs: prev.totalPausedMs + (Date.now() - prev.pausedAtMs) }
          : { pausedAtMs: Date.now(), totalPausedMs: prev.totalPausedMs };
      try {
        if (next.pausedAtMs === null && next.totalPausedMs === 0)
          localStorage.removeItem(storageKey);
        else localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* storage unavailable — pause still works in-memory */
      }
      return next;
    });
  }, [storageKey]);

  const paused = pause.pausedAtMs !== null;
  const frozenNow = paused ? pause.pausedAtMs! : now;
  const elapsed = Math.max(0, Math.floor((frozenNow - startMs - pause.totalPausedMs) / 1000));
  return { elapsed, paused, toggle };
}

type RestState = { endsAt: number; durationMs: number };

/** Rest timer driven by an absolute end timestamp and persisted to
 *  localStorage. Survives re-render, navigation away/back, full reload and
 *  phone lock — on return we recompute remaining from the clock, not a counter. */
export function useRestTimer(workoutId: string) {
  const storageKey = `trainer:rest:${workoutId}`;
  const [rest, setRest] = useState<RestState | null>(null);
  const [now, setNow] = useState(0);

  const persist = useCallback(
    (r: RestState | null) => {
      try {
        if (r) localStorage.setItem(storageKey, JSON.stringify(r));
        else localStorage.removeItem(storageKey);
      } catch {
        /* storage unavailable — timer still works in-memory */
      }
    },
    [storageKey],
  );

  // Resume an in-flight rest after reload/navigation. Deferred to a timer
  // callback so the read happens post-mount (hydration-safe) without a
  // synchronous setState in the effect body.
  useEffect(() => {
    const resume = () => {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return;
        const r = JSON.parse(raw) as RestState;
        if (r && typeof r.endsAt === "number" && r.endsAt > Date.now()) setRest(r);
        else localStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
    };
    const id = setTimeout(resume, 0);
    return () => clearTimeout(id);
  }, [storageKey]);

  // Tick while active; clear when it elapses.
  useEffect(() => {
    if (!rest) return;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (t >= rest.endsAt) {
        setRest(null);
        persist(null);
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [rest, persist]);

  const remainingMs = rest ? Math.max(0, rest.endsAt - now) : 0;

  const start = useCallback(
    (seconds: number) => {
      const r = { endsAt: Date.now() + seconds * 1000, durationMs: seconds * 1000 };
      setRest(r);
      persist(r);
    },
    [persist],
  );

  const extend = useCallback(
    (seconds: number) => {
      setRest((prev) => {
        const base = prev ?? { endsAt: Date.now(), durationMs: 0 };
        const r = {
          endsAt: base.endsAt + seconds * 1000,
          durationMs: base.durationMs + seconds * 1000,
        };
        persist(r);
        return r;
      });
    },
    [persist],
  );

  const skip = useCallback(() => {
    setRest(null);
    persist(null);
  }, [persist]);

  return {
    active: !!rest,
    remainingMs,
    durationMs: rest?.durationMs ?? 0,
    start,
    extend,
    skip,
  };
}
