import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { plans, workouts } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { StartWorkoutButton } from "./start-workout-button";
import { ImpromptuBox } from "./impromptu-box";

// Server actions on this page (startWorkout / startImpromptuWorkout) call Claude
// to design the workout, which can take well over the default 10s function limit.
// Page-level maxDuration sets the timeout for all Server Actions used on the page.
export const maxDuration = 60;

type PlanStructure = {
  split: string;
  days: Array<{
    day: string;
    category: string;
    exercises: Array<{ name: string; order: number; notes?: string }>;
  }>;
};

const weekdayForToday = (): string => {
  const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return names[new Date().getDay()];
};

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

  // If already mid-workout, bounce straight to the session
  const [inProgress] = await db
    .select({ id: workouts.id })
    .from(workouts)
    .where(and(eq(workouts.userId, user.id), eq(workouts.status, "in_progress")))
    .limit(1);
  if (inProgress) redirect(`/workout/${inProgress.id}`);

  const structure = active.structure as PlanStructure;
  const today = weekdayForToday();
  const planDay = structure.days.find((d) => d.day === today);

  return (
    <main className="px-6 py-8 max-w-md mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Today</h1>
        <p className="text-sm text-muted-foreground capitalize">{today}</p>
      </div>

      {planDay ? (
        <section className="space-y-4">
          <div className="rounded-lg border p-4 bg-muted/30">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              {planDay.category}
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {planDay.exercises
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((e) => (
                  <li key={e.name}>{e.name.replace(/_/g, " ")}</li>
                ))}
            </ul>
          </div>
          <StartWorkoutButton />
        </section>
      ) : (
        <section className="rounded-lg border p-4 bg-muted/30">
          <p className="text-sm font-medium">Rest day.</p>
          <p className="text-muted-foreground text-sm mt-1">
            No exercises planned for {today}. Eat, sleep, grow.
          </p>
        </section>
      )}

      <ImpromptuBox days={structure.days} />
    </main>
  );
}
