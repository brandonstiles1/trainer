import { createClient } from "@/lib/supabase/server";

export default async function TodayPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-4">Today</h1>
      <p className="text-muted-foreground">
        Signed in as {user?.email}. Workout flow comes in Plan 3.
      </p>
    </main>
  );
}
