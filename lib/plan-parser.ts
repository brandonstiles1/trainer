import { z } from "zod";

const dayOfWeek = z.enum([
  "monday", "tuesday", "wednesday",
  "thursday", "friday", "saturday", "sunday",
]);

const exercise = z.object({
  name: z.string().min(1).regex(/^[a-z0-9_]+$/, "must be snake_case"),
  order: z.number().int().min(1),
  notes: z.string().optional(),
});

const planDay = z.object({
  day: dayOfWeek,
  category: z.string().min(1).regex(/^[a-z0-9_]+$/),
  exercises: z.array(exercise),
});

export const planSchema = z.object({
  split: z.string().min(1),
  notes: z.string(),
  days: z.array(planDay).min(1),
});

export type Plan = z.infer<typeof planSchema>;

/**
 * Extract the last <plan>...</plan> block from a string and validate it.
 * Returns null on any failure (no block, malformed JSON, schema mismatch).
 */
export function extractPlan(text: string): Plan | null {
  const matches = [...text.matchAll(/<plan>([\s\S]*?)<\/plan>/gi)];
  if (matches.length === 0) return null;

  const lastMatch = matches[matches.length - 1][1].trim();
  let raw: unknown;
  try {
    raw = JSON.parse(lastMatch);
  } catch {
    return null;
  }

  const parsed = planSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
