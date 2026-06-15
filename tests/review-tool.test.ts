import { describe, it, expect } from "vitest";
import { reviewResponseSchema } from "@/lib/review-tool";

describe("review tool schema", () => {
  it("accepts baseline updates with reason", () => {
    const ok = { updates: [{ exercise_name: "close_grip_bench", weight_lbs: 160, reps: 5, reason: "derived from pinned bench" }] };
    expect(reviewResponseSchema.safeParse(ok).success).toBe(true);
  });
  it("allows an empty update list", () => {
    expect(reviewResponseSchema.safeParse({ updates: [] }).success).toBe(true);
  });
});
