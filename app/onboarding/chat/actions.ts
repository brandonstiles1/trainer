"use server";

// Turbopack doesn't allow bare re-exports in "use server" files — wrap as a forwarding
// async function so the export is a proper server action.
import { acceptPlan as acceptPlanImpl, type AcceptPlanInput } from "@/lib/actions/plans";

export async function acceptPlan(input: AcceptPlanInput) {
  return acceptPlanImpl(input);
}
