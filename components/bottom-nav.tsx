"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { ChartLine, Dumbbell, Settings, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = { href: string; label: string; Icon: LucideIcon };

const TABS: Tab[] = [
  { href: "/today", label: "Workout", Icon: Dumbbell },
  { href: "/progress", label: "Progress", Icon: ChartLine },
  { href: "/settings", label: "Settings", Icon: Settings },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 border-t border-[color:var(--hairline)] bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70 z-50">
      <ul className="grid grid-cols-3 h-16 max-w-md mx-auto">
        {TABS.map((tab) => (
          <li key={tab.href}>
            <Link
              href={tab.href}
              // touch-manipulation kills the tap delay; active: gives instant press feedback.
              className="group flex h-full flex-col items-center justify-center gap-1 text-[11px] touch-manipulation transition-colors active:bg-[var(--teal)]/10"
            >
              <TabContents tab={tab} active={pathname.startsWith(tab.href)} />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// Descendant of <Link> so it can read useLinkStatus() — lights up the tab the
// instant it's tapped, before the (dynamic) destination finishes loading.
function TabContents({ tab, active }: { tab: Tab; active: boolean }) {
  const { pending } = useLinkStatus();
  const { Icon, label } = tab;
  const on = active || pending;
  return (
    <>
      <Icon
        className={cn(
          "size-5 transition-transform group-active:scale-90",
          on ? "text-[var(--teal)]" : "text-muted-foreground group-hover:text-foreground",
          pending && "animate-pulse",
        )}
        strokeWidth={on ? 2 : 1.75}
      />
      <span className={cn(on ? "font-medium text-[var(--teal)]" : "font-normal text-muted-foreground")}>
        {label}
      </span>
    </>
  );
}
