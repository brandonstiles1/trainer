import { z } from "zod";

// ────────── Response shape ──────────
// Matches the input_schema we'll pass to Claude. Shared here so we can both
// send it as tool schema AND validate Claude's output with zod.

const nextSet = z.object({
  reps: z.number().int().min(1),
  weight: z.number().nonnegative(),
});

const branches = z.object({
  under: z.object({
    threshold_reps: z.number().int().min(1),
    next_set: nextSet,
  }),
  on: z.object({
    next_set: nextSet,
  }),
  over: z.object({
    threshold_reps: z.number().int().min(1),
    next_set: nextSet,
  }),
});

const setEntry = z.object({
  set_number: z.number().int().min(1),
  prescribed: z.object({
    reps: z.number().int().min(1),
    weight: z.number().nonnegative(),
  }),
  branches,
});

const exerciseEntry = z.object({
  name: z.string().min(1).regex(/^[a-z0-9_]+$/, "snake_case"),
  sets: z.array(setEntry).min(1).max(8),
});

export const workoutResponseSchema = z.object({
  exercises: z.array(exerciseEntry).min(1),
});

export type WorkoutResponse = z.infer<typeof workoutResponseSchema>;

// ────────── Tool definition passed to Anthropic ──────────
// JSON Schema (Draft 7) — NOT a zod schema, because Claude's tool-use takes raw JSON Schema.

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
          required: ["name", "sets"],
          properties: {
            name: { type: "string", pattern: "^[a-z0-9_]+$" },
            sets: {
              type: "array",
              minItems: 1,
              maxItems: 8,
              items: {
                type: "object",
                required: ["set_number", "prescribed", "branches"],
                properties: {
                  set_number: { type: "integer", minimum: 1 },
                  prescribed: {
                    type: "object",
                    required: ["reps", "weight"],
                    properties: {
                      reps: { type: "integer", minimum: 1 },
                      weight: { type: "number", minimum: 0 },
                    },
                  },
                  branches: {
                    type: "object",
                    required: ["under", "on", "over"],
                    properties: {
                      under: {
                        type: "object",
                        required: ["threshold_reps", "next_set"],
                        properties: {
                          threshold_reps: { type: "integer", minimum: 1 },
                          next_set: {
                            type: "object",
                            required: ["reps", "weight"],
                            properties: {
                              reps: { type: "integer", minimum: 1 },
                              weight: { type: "number", minimum: 0 },
                            },
                          },
                        },
                      },
                      on: {
                        type: "object",
                        required: ["next_set"],
                        properties: {
                          next_set: {
                            type: "object",
                            required: ["reps", "weight"],
                            properties: {
                              reps: { type: "integer", minimum: 1 },
                              weight: { type: "number", minimum: 0 },
                            },
                          },
                        },
                      },
                      over: {
                        type: "object",
                        required: ["threshold_reps", "next_set"],
                        properties: {
                          threshold_reps: { type: "integer", minimum: 1 },
                          next_set: {
                            type: "object",
                            required: ["reps", "weight"],
                            properties: {
                              reps: { type: "integer", minimum: 1 },
                              weight: { type: "number", minimum: 0 },
                            },
                          },
                        },
                      },
                    },
                  },
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
