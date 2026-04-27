"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export function RestTimer({
  seconds,
  onDone,
}: {
  seconds: number;
  onDone: () => void;
}) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (remaining <= 0) {
      onDone();
      return;
    }
    const t = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(t);
  }, [remaining, onDone]);

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;

  return (
    <div className="flex flex-col items-center gap-4 p-6 rounded-lg border bg-muted/30">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Rest</p>
      <p className="text-5xl font-mono tabular-nums">
        {mins}:{secs.toString().padStart(2, "0")}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => setRemaining((r) => r + 30)}>
          +30s
        </Button>
        <Button variant="outline" size="sm" onClick={onDone}>
          Skip
        </Button>
      </div>
    </div>
  );
}
