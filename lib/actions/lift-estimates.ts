"use server";

import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { liftEstimates } from "@/lib/db/schema";

export async function pinBaseline(input: {
  exerciseName: string;
  weightLbs: number;
  reps: number;
}): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");
  await db.insert(liftEstimates).values({
    userId: user.id,
    exerciseName: input.exerciseName,
    weightLbs: Math.round(input.weightLbs),
    reps: input.reps,
    source: "user_pinned",
  });
}
