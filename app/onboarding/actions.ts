"use server";

import { redirect } from "next/navigation";
import { createGoal, getUploadUrl as _getUploadUrl, type CreateGoalInput } from "@/lib/actions/goals";
import type { PhotoKind } from "@/lib/storage";

export async function submitOnboarding(input: CreateGoalInput) {
  const { goalId } = await createGoal(input);
  redirect(`/onboarding/chat?goalId=${goalId}`);
}

// Turbopack requires all exports in "use server" files to be async functions —
// bare re-exports are not allowed, so we wrap the underlying action.
export async function getUploadUrl(kind: PhotoKind, ext: "jpg" | "jpeg" | "png" | "webp" | "heic") {
  return _getUploadUrl(kind, ext);
}
