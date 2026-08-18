import { z } from "zod";

/**
 * The weekly review is commentary and nothing else. It reads the week and says
 * something useful about it; it does not set, suggest, or nudge a number. Every
 * target the app shows comes from the log book via `lib/engine/progression`,
 * and this tool has no way to reach it — deliberately.
 */
export const reviewResponseSchema = z.object({
  headline: z.string().min(1).max(200),
  observations: z
    .array(
      z.object({
        /** The exercise it's about, or null for the week as a whole. */
        exercise_name: z.string().regex(/^[a-z0-9_]+$/).nullable(),
        note: z.string().min(1).max(300),
      }),
    )
    .max(6),
});
export type ReviewResponse = z.infer<typeof reviewResponseSchema>;

export const submitReviewTool = {
  name: "submit_review",
  description:
    "Submit your written review of the past week. Commentary only — never prescribe weights, reps, or sets. Call exactly once.",
  input_schema: {
    type: "object",
    properties: {
      headline: {
        type: "string",
        maxLength: 200,
        description: "One sentence on how the week went.",
      },
      observations: {
        type: "array",
        maxItems: 6,
        items: {
          type: "object",
          required: ["exercise_name", "note"],
          properties: {
            exercise_name: {
              type: ["string", "null"],
              pattern: "^[a-z0-9_]+$",
              description: "The exercise this is about, or null for the week as a whole.",
            },
            note: { type: "string", maxLength: 300 },
          },
        },
      },
    },
    required: ["headline", "observations"],
  },
} as const;
