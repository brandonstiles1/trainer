import { describe, it, expect } from "vitest";
import { isReviewDue } from "@/lib/workouts/review-due";

describe("isReviewDue", () => {
  const now = new Date("2026-06-13T12:00:00Z");
  it("due when never reviewed", () => {
    expect(isReviewDue(null, now)).toBe(true);
  });
  it("due when >=7 days since last review", () => {
    expect(isReviewDue(new Date("2026-06-06T11:00:00Z"), now)).toBe(true);
  });
  it("not due within 7 days", () => {
    expect(isReviewDue(new Date("2026-06-10T12:00:00Z"), now)).toBe(false);
  });
});
