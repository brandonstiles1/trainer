import { z } from "zod";

// ────────── Response shape (zod, for validating Claude's output) ──────────

const setEntry = z.object({
  set_number: z.number().int().min(1),
  target_reps: z.number().int().min(1),
  weight: z.number().nonnegative(),
});

const exerciseEntry = z.object({
  name: z.string().min(1).regex(/^[a-z0-9_]+$/, "snake_case"),
  rationale: z.string().min(1).max(200),
  sets: z.array(setEntry).min(1).max(8),
});

export const workoutResponseSchema = z.object({
  exercises: z.array(exerciseEntry).min(1),
});

export type WorkoutResponse = z.infer<typeof workoutResponseSchema>;

// ────────── Tool definition passed to Anthropic (raw JSON Schema) ──────────

export const submitWorkoutTool = {
  name: "submit_workout",
  description:
    "Submit the structured workout for today. Call this exactly once with the complete workout.",
  input_schema: {
    type: "object",
    properties: {
      exercises: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["name", "rationale", "sets"],
          properties: {
            name: { type: "string", pattern: "^[a-z0-9_]+$" },
            rationale: {
              type: "string",
              description:
                "<=160 chars. Explain the SET 1 weight, e.g. how it derives from a related max.",
            },
            sets: {
              type: "array",
              minItems: 1,
              maxItems: 8,
              items: {
                type: "object",
                required: ["set_number", "target_reps", "weight"],
                properties: {
                  set_number: { type: "integer", minimum: 1 },
                  target_reps: { type: "integer", minimum: 1 },
                  weight: { type: "number", minimum: 0 },
                },
              },
            },
          },
        },
      },
    },
    required: ["exercises"],
  },
} as const;
