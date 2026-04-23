"use server";

import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { goals } from "@/lib/db/schema";
import { createSignedUploadUrl } from "@/lib/storage";
import type { PhotoKind } from "@/lib/storage";

export type CreateGoalInput = {
  heightIn: number;
  weightLbs: number;
  maxDaysPerWeek: number;
  maxMinutesSession: number;
  goalDescription: string | null;
  beforePhotoPath: string | null;
  goalPhotoPath: string | null;
};

export async function createGoal(input: CreateGoalInput): Promise<{ goalId: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");

  const [row] = await db
    .insert(goals)
    .values({
      userId: user.id,
      beforePhotoPath: input.beforePhotoPath,
      goalPhotoPath: input.goalPhotoPath,
      goalDescription: input.goalDescription,
      maxDaysPerWeek: input.maxDaysPerWeek,
      maxMinutesSession: input.maxMinutesSession,
      chatTranscript: [],
    } as typeof goals.$inferInsert)
    .returning({ id: goals.id });

  // Also persist height + weight on profiles.
  await supabase
    .from("profiles")
    .update({ height_in: input.heightIn, weight_lbs: input.weightLbs })
    .eq("user_id", user.id);

  return { goalId: row.id };
}

/** Invoked from the client to get a signed upload URL. */
export async function getUploadUrl(kind: PhotoKind, ext: "jpg" | "jpeg" | "png" | "webp" | "heic") {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");
  return createSignedUploadUrl({ userId: user.id, kind, ext });
}
