import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { goals } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ChatClient } from "./chat-client";

export default async function PlanChatPage({
  searchParams,
}: {
  searchParams: Promise<{ goalId?: string }>;
}) {
  const { goalId } = await searchParams;
  if (!goalId) redirect("/onboarding");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [goal] = await db.select().from(goals).where(eq(goals.id, goalId)).limit(1);
  if (!goal || goal.userId !== user.id) redirect("/onboarding");

  return (
    <main className="flex flex-col h-dvh">
      <header className="px-6 py-4 border-b">
        <h1 className="text-xl font-semibold">Design your plan</h1>
        <p className="text-xs text-muted-foreground">Chat with Claude, then Accept when you like the plan.</p>
      </header>
      <ChatClient goalId={goalId} />
    </main>
  );
}
