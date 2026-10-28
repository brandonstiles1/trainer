"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { plans, profiles, bodyWeights } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { parseSettings, type ProgressionSettings } from "@/lib/program/settings";
import { parseProgram } from "@/lib/program/validate";
import { DEFAULT_PROGRAM } from "@/lib/program/default-program";
import { activeProgramFor, installProgram, settingsFor } from "@/lib/workouts/log-book";

async function requireUser(): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");
  return user.id;
}

/** Merge a change into the stored settings; anything invalid falls back to its default. */
export async function saveSettings(patch: Partial<ProgressionSettings>): Promise<ProgressionSettings> {
  const userId = await requireUser();
  const next = parseSettings({ ...(await settingsFor(userId)), ...patch });
  await db
    .insert(profiles)
    .values({ userId, progression: next })
    .onConflictDoUpdate({ target: profiles.userId, set: { progression: next, updatedAt: new Date() } });
  revalidatePath("/today");
  return next;
}

/**
 * Save the edited routine onto the active plan. Exercise names are the keys
 * history is filed under, so substituting one never touches past sets — the
 * old exercise's log stays on the Progress screen.
 */
export async function saveRoutine(raw: unknown): Promise<void> {
  const userId = await requireUser();
  const program = parseProgram(raw);
  const { planId } = await activeProgramFor(userId);
  await db
    .update(plans)
    .set({ structure: program })
    .where(and(eq(plans.id, planId), eq(plans.userId, userId)));
  revalidatePath("/today");
  revalidatePath("/settings");
}

/** Switch to (or reset to) the built-in A/B/C/D program. The old plan is kept, inactive. */
export async function switchToDefaultProgram(): Promise<void> {
  const userId = await requireUser();
  await installProgram(userId, DEFAULT_PROGRAM);
  revalidatePath("/today");
  revalidatePath("/settings");
}

export async function logBodyWeight(weightLbs: number): Promise<void> {
  const userId = await requireUser();
  if (!(Number.isFinite(weightLbs) && weightLbs > 50 && weightLbs < 700)) throw new Error("invalid weight");
  await db.insert(bodyWeights).values({ userId, weightLbs: Math.round(weightLbs * 10) / 10 });
  revalidatePath("/progress");
}

export async function deleteBodyWeight(id: string): Promise<void> {
  const userId = await requireUser();
  await db.delete(bodyWeights).where(and(eq(bodyWeights.id, id), eq(bodyWeights.userId, userId)));
  revalidatePath("/progress");
}
