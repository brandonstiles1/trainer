import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { plans } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { PlanDesignChat } from "@/components/chat/plan-design-chat";

export default async function PlanChatPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode: rawMode } = await searchParams;
  const mode = rawMode === "new" ? "new" : "edit";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [active] = await db
    .select({ goalId: plans.goalId })
    .from(plans)
    .where(and(eq(plans.userId, user.id), eq(plans.isActive, true)))
    .limit(1);
  if (!active) redirect("/onboarding");

  return (
    <main className="flex flex-col h-dvh">
      <header className="px-6 py-4 border-b">
        <h1 className="text-xl font-semibold">
          {mode === "new" ? "Design a fresh plan" : "Edit your plan"}
        </h1>
        <p className="text-xs text-muted-foreground">
          {mode === "new"
            ? "Chat with Claude, then Accept when you like the plan."
            : "Tell Claude what to change, then Accept the revised plan."}
        </p>
      </header>
      <PlanDesignChat
        goalId={active.goalId}
        mode={mode}
        autoSendFirst={mode === "new"}
        redirectTo="/plan"
      />
    </main>
  );
}
