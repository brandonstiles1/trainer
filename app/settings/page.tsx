import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { CATALOG_EXERCISES } from "@/lib/workouts/exercise-alternatives";
import { activeProgramFor, loggedExerciseNames, settingsFor } from "@/lib/workouts/log-book";
import { signOut } from "./actions";
import { RoutineEditor } from "./routine-editor";
import { ProgressionForm } from "./progression-form";
import { ProgramButton } from "@/app/today/program-button";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ program, legacy }, settings, logged] = await Promise.all([
    activeProgramFor(user.id),
    settingsFor(user.id),
    loggedExerciseNames(user.id),
  ]);
  const options = [
    ...new Set([...program.days.flatMap((d) => d.exercises.map((e) => e.name)), ...logged, ...CATALOG_EXERCISES]),
  ].sort();

  return (
    <main className="px-4 pt-8 pb-24 max-w-md mx-auto space-y-8">
      <h1 className="px-1 text-2xl font-semibold">Settings</h1>

      <section className="space-y-2">
        <h2 className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Routine</h2>
        <RoutineEditor program={program} options={options} />
      </section>

      <section className="space-y-2">
        <h2 className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Progression</h2>
        <ProgressionForm settings={settings} />
      </section>

      <section className="space-y-2">
        <h2 className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Program</h2>
        <div className="rounded-[13px] border-[0.5px] border-[color:var(--hairline)] bg-white p-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            {legacy
              ? "You're on an old weekday plan. Switch to the 4-day A/B/C/D program — history is kept."
              : "Reset the routine to the original A/B/C/D program. Logged history is kept."}
          </p>
          <ProgramButton label={legacy ? "Use the A/B/C/D program" : "Reset to default program"} />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Account</h2>
        <p className="px-1 text-sm">{user.email}</p>
        <form action={signOut}>
          <Button type="submit" variant="outline" className="w-full h-11">
            Sign out
          </Button>
        </form>
      </section>
    </main>
  );
}
