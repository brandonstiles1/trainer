"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { switchToDefaultProgram } from "@/lib/actions/settings";

export function ProgramButton({ label }: { label: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await switchToDefaultProgram();
          router.refresh();
        })
      }
      className="h-10 w-full rounded-[10px] bg-[var(--teal)] text-sm font-medium text-white disabled:opacity-50"
    >
      {pending ? "Switching…" : label}
    </button>
  );
}
