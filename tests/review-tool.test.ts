import { describe, it, expect } from "vitest";
import { reviewResponseSchema, submitReviewTool } from "@/lib/review-tool";
import { WEEKLY_REVIEW_SYSTEM } from "@/lib/prompts/weekly-review";

describe("review tool schema", () => {
  it("accepts a headline with per-exercise observations", () => {
    const ok = {
      headline: "Three solid sessions; pressing moved, pulling didn't.",
      observations: [
        { exercise_name: "barbell_curl", note: "Cleared every set two weeks running." },
        { exercise_name: null, note: "Back work skipped twice." },
      ],
    };
    expect(reviewResponseSchema.safeParse(ok).success).toBe(true);
  });

  it("allows an empty observation list", () => {
    expect(
      reviewResponseSchema.safeParse({ headline: "Quiet week.", observations: [] }).success,
    ).toBe(true);
  });

  it("requires a headline", () => {
    expect(reviewResponseSchema.safeParse({ observations: [] }).success).toBe(false);
    expect(reviewResponseSchema.safeParse({ headline: "", observations: [] }).success).toBe(false);
  });

  it("gives the model no way to submit a number", () => {
    // The point of the rewrite: commentary cannot reach the progression path.
    const properties = submitReviewTool.input_schema.properties;
    expect(Object.keys(properties)).toEqual(["headline", "observations"]);
    const fields = Object.keys(properties.observations.items.properties);
    expect(fields).toEqual(["exercise_name", "note"]);

    const withNumbers = {
      headline: "Good week.",
      observations: [{ exercise_name: "bench_press", note: "up", weight_lbs: 185, reps: 5 }],
    };
    const parsed = reviewResponseSchema.parse(withNumbers);
    expect(parsed.observations[0]).toEqual({ exercise_name: "bench_press", note: "up" });
  });

  it("caps observations so the note stays short", () => {
    const many = {
      headline: "Busy week.",
      observations: Array.from({ length: 7 }, () => ({ exercise_name: null, note: "filler" })),
    };
    expect(reviewResponseSchema.safeParse(many).success).toBe(false);
  });
});

describe("review prompt", () => {
  it("tells the coach it does not set the numbers", () => {
    expect(WEEKLY_REVIEW_SYSTEM).toMatch(/never prescribe|Never prescribe/);
    expect(WEEKLY_REVIEW_SYSTEM).toContain("commentary only");
  });

  it("no longer talks about baselines or pins", () => {
    expect(WEEKLY_REVIEW_SYSTEM).not.toMatch(/baseline|pinned|1RM/i);
  });
});
