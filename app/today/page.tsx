import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { plans } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export default async function TodayPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [active] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.userId, user.id), eq(plans.isActive, true)))
    .limit(1);

  if (!active) redirect("/onboarding");

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-4">Today</h1>
      <p className="text-muted-foreground mb-4">
        Signed in as {user.email}.
      </p>
      <section className="rounded-lg border p-4 bg-muted/30">
        <h2 className="text-sm font-medium text-muted-foreground mb-2">Active Plan</h2>
        <p className="text-sm">
          Split: <strong>{(active.structure as { split: string }).split}</strong> · {(active.structure as { days: unknown[] }).days.length} training days
        </p>
        <p className="text-muted-foreground mt-3 text-sm">
          Workout flow comes in Plan 3.
        </p>
      </section>
    </main>
  );
}
