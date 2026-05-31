import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { plans } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { buttonVariants } from "@/components/ui/button";

type PlanStructure = {
  split: string;
  notes?: string;
  days: Array<{
    day: string;
    category: string;
    exercises: Array<{ name: string; order: number; notes?: string }>;
  }>;
};

const WEEKDAY_ORDER = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
];

export default async function PlanPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [active] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.userId, user.id), eq(plans.isActive, true)))
    .limit(1);
  if (!active) redirect("/onboarding");

  const structure = active.structure as PlanStructure;
  const days = structure.days
    .slice()
    .sort((a, b) => WEEKDAY_ORDER.indexOf(a.day) - WEEKDAY_ORDER.indexOf(b.day));

  return (
    <main className="px-6 py-8 max-w-md mx-auto space-y-6 pb-24">
      <div>
        <h1 className="text-2xl font-bold">Plan</h1>
        <p className="text-sm text-muted-foreground capitalize">
          {structure.split.replace(/_/g, " ")}
        </p>
        {structure.notes && (
          <p className="text-sm text-muted-foreground mt-2">{structure.notes}</p>
        )}
      </div>

      <section className="space-y-3">
        {days.map((d) => (
          <div key={d.day} className="rounded-lg border p-4 bg-muted/30">
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-medium capitalize">{d.day}</p>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">
                {d.category.replace(/_/g, " ")}
              </p>
            </div>
            <ul className="mt-2 space-y-1 text-sm">
              {d.exercises
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((e) => (
                  <li key={e.name}>{e.name.replace(/_/g, " ")}</li>
                ))}
            </ul>
          </div>
        ))}
      </section>

      <div className="space-y-2">
        <Link href="/plan/chat?mode=edit" className={buttonVariants({ variant: "default" }) + " w-full"}>
          Edit with Claude
        </Link>
        <Link href="/plan/chat?mode=new" className={buttonVariants({ variant: "outline" }) + " w-full"}>
          Start a fresh plan
        </Link>
      </div>
    </main>
  );
}
