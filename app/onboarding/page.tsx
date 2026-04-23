import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { plans } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { OnboardingForm } from "./form";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // If a user already has an active plan, don't re-onboard them.
  const active = await db
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.userId, user.id), eq(plans.isActive, true)))
    .limit(1);
  if (active.length > 0) redirect("/today");

  return (
    <main className="px-6 py-8 max-w-md mx-auto">
      <h1 className="text-2xl font-bold mb-2">Let's get started</h1>
      <p className="text-muted-foreground mb-6">
        A few details so Claude can design your program.
      </p>
      <OnboardingForm />
    </main>
  );
}
