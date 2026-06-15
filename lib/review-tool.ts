import { z } from "zod";

export const reviewResponseSchema = z.object({
  updates: z.array(z.object({
    exercise_name: z.string().regex(/^[a-z0-9_]+$/),
    weight_lbs: z.number().nonnegative(),
    reps: z.number().int().min(1),
    reason: z.string().min(1).max(200),
  })),
});
export type ReviewResponse = z.infer<typeof reviewResponseSchema>;

export const submitReviewTool = {
  name: "submit_review",
  description: "Submit baseline updates after reviewing the week. Call exactly once.",
  input_schema: {
    type: "object",
    properties: {
      updates: {
        type: "array",
        items: {
          type: "object",
          required: ["exercise_name", "weight_lbs", "reps", "reason"],
          properties: {
            exercise_name: { type: "string", pattern: "^[a-z0-9_]+$" },
            weight_lbs: { type: "number", minimum: 0 },
            reps: { type: "integer", minimum: 1 },
            reason: { type: "string" },
          },
        },
      },
    },
    required: ["updates"],
  },
} as const;
