"use server";

import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { workouts, workoutSets } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function deleteWorkout(workoutId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");
  const [w] = await db.select({ userId: workouts.userId }).from(workouts)
    .where(eq(workouts.id, workoutId)).limit(1);
  if (!w || w.userId !== user.id) throw new Error("workout not found");
  await db.transaction(async (tx) => {
    await tx.delete(workoutSets).where(eq(workoutSets.workoutId, workoutId));
    await tx.delete(workouts).where(eq(workouts.id, workoutId));
  });
}
