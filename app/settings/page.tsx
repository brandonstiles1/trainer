import Link from "next/link";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground mb-1">Training</h2>
        <Link
          href="/plan"
          className="block rounded-[13px] border border-[color:var(--hairline)] bg-white px-4 py-3 text-sm font-medium"
        >
          Edit training plan →
        </Link>
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted-foreground mb-1">Account</h2>
        <p className="text-sm">{user?.email}</p>
      </section>

      <form action={signOut}>
        <Button type="submit" variant="outline" className="w-full">
          Sign out
        </Button>
      </form>
    </main>
  );
}
