"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { startWorkout, type StartRequest } from "@/lib/actions/workouts";

export function StartButton({
  request,
  label = "Start Workout",
  variant = "primary",
  disabled,
  className,
}: {
  request: StartRequest;
  label?: string;
  variant?: "primary" | "quiet";
  disabled?: boolean;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className={className}>
      <button
        type="button"
        disabled={pending || disabled}
        onClick={() =>
          start(async () => {
            setError(null);
            try {
              const { workoutId } = await startWorkout(request);
              router.push(`/workout/${workoutId}`);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Couldn't start the workout.");
            }
          })
        }
        className={cn(
          "w-full rounded-[12px] text-sm font-medium transition-opacity disabled:opacity-50 touch-manipulation",
          variant === "primary"
            ? "h-14 bg-[var(--teal)] text-base text-white active:opacity-90"
            : "h-11 border-[0.5px] border-[color:var(--hairline)] bg-white text-foreground active:bg-black/[0.03]",
        )}
      >
        {pending ? "Starting…" : label}
      </button>
      {error && <p className="mt-2 text-center text-xs text-destructive">{error}</p>}
    </div>
  );
}
