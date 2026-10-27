import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { CATALOG_EXERCISES } from "@/lib/workouts/exercise-alternatives";
import { activeProgramFor, loggedExerciseNames } from "@/lib/workouts/log-book";
import { StartButton } from "../start-button";
import { CustomBuilder } from "./custom-builder";

/**
 * A fifth day: repeat a workout or build one. Either way it counts toward each
 * exercise's history and progression, but the A/B/C/D queue doesn't move.
 */
export default async function ExtraWorkoutPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { program } = await activeProgramFor(user.id);
  const logged = await loggedExerciseNames(user.id);
  const routine = [...new Set(program.days.flatMap((d) => d.exercises.map((e) => e.name)))];
  const others = [...new Set([...logged, ...CATALOG_EXERCISES])].filter((n) => !routine.includes(n)).sort();

  return (
    <main className="px-4 pt-6 pb-24 max-w-md mx-auto space-y-6">
      <header>
        <Link href="/today" className="-ml-1 inline-flex items-center text-sm text-muted-foreground">
          <ChevronLeft className="size-4" /> Workout
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Extra workout</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Counts toward progression. Your A/B/C/D rotation stays where it is.
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Repeat a workout</h2>
        {program.days.map((d) => (
          <StartButton
            key={d.day}
            variant="quiet"
            request={{ kind: "repeat", day: d.day }}
            label={`${d.day} · ${d.title}`}
          />
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Build a quick session</h2>
        <CustomBuilder routine={routine} others={others} />
      </section>
    </main>
  );
}
