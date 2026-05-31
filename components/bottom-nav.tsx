"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Flame, LineChart, CalendarDays, Settings, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS: { href: string; label: string; Icon: LucideIcon }[] = [
  { href: "/today", label: "Today", Icon: Flame },
  { href: "/progress", label: "Progress", Icon: LineChart },
  { href: "/plan", label: "Plan", Icon: CalendarDays },
  { href: "/settings", label: "Settings", Icon: Settings },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 border-t border-[color:var(--hairline)] bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70 z-50">
      <ul className="grid grid-cols-4 h-16 max-w-md mx-auto">
        {TABS.map(({ href, label, Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                className={cn(
                  "flex h-full flex-col items-center justify-center gap-1 text-[11px] transition-colors",
                  active
                    ? "text-[var(--teal)] font-medium"
                    : "text-muted-foreground font-normal hover:text-foreground",
                )}
              >
                <Icon className="size-5" strokeWidth={active ? 2 : 1.75} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
