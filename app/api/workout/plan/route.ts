import { createClient } from "@/lib/supabase/server";
import { anthropic, model } from "@/lib/anthropic";
import { WORKOUT_DESIGN_SYSTEM } from "@/lib/prompts/workout-design";
import { submitWorkoutTool, workoutResponseSchema } from "@/lib/workout-tool";
import { db } from "@/lib/db";
import { workoutSets, workouts, liftEstimates } from "@/lib/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  dayKey: string;         // e.g. "push"
  exercises: string[];    // snake_case names
};

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const body = (await req.json()) as Body;

  // Pull recent sets for these exercises to give Claude history.
  const history = await db
    .select({
      exerciseName: workoutSets.exerciseName,
      prescribed: workoutSets.prescribed,
      actual: workoutSets.actual,
      completedAt: workoutSets.completedAt,
    })
    .from(workoutSets)
    .innerJoin(workouts, eq(workouts.id, workoutSets.workoutId))
    .where(
      and(
        eq(workouts.userId, user.id),
        inArray(workoutSets.exerciseName, body.exercises),
      ),
    )
    .orderBy(desc(workoutSets.completedAt))
    .limit(40);

  // Lift estimates for these exercises (latest per exercise).
  const estimates = await db
    .select()
    .from(liftEstimates)
    .where(
      and(
        eq(liftEstimates.userId, user.id),
        inArray(liftEstimates.exerciseName, body.exercises),
      ),
    )
    .orderBy(desc(liftEstimates.recordedAt));

  const userContext =
    `Today is ${body.dayKey} day. Exercises in order: ${body.exercises.join(", ")}.\n\n` +
    (estimates.length
      ? `Self-reported maxes:\n${estimates
          .map((e) => `- ${e.exerciseName}: ${e.weightLbs} lbs x ${e.reps} reps`)
          .join("\n")}\n\n`
      : "No self-reported maxes.\n\n") +
    (history.length
      ? `Recent sets (newest first):\n${history
          .slice(0, 20)
          .map((h) => {
            const p = h.prescribed as { reps: number; weight: number };
            const a = h.actual as { reps: number; weight: number; feeling: string } | null;
            return `- ${h.exerciseName}: prescribed ${p.reps}x${p.weight}${a ? `, actual ${a.reps}x${a.weight} (${a.feeling})` : ", (skipped)"}`;
          })
          .join("\n")}`
      : "No prior sessions for these exercises.");

  try {
    const res = await anthropic().messages.create({
      model: model(),
      max_tokens: 4096,
      system: [{ type: "text", text: WORKOUT_DESIGN_SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: [submitWorkoutTool] as any,
      tool_choice: { type: "tool", name: "submit_workout" },
      messages: [{ role: "user", content: userContext }],
    });

    const toolUse = res.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return new Response("no tool call in response", { status: 502 });
    }

    const parsed = workoutResponseSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "tool output failed schema", issues: parsed.error.issues }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }

    return Response.json(parsed.data);
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
