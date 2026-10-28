import { z } from "zod";
import type { ProgramStructure } from "./structure";

const name = z.string().min(1).max(60).regex(/^[a-z0-9_]+$/, "must be snake_case");

const exercise = z
  .object({
    name,
    order: z.number().int().min(1),
    sets: z.number().int().min(1).max(10),
    repMin: z.number().int().min(1).max(50),
    repMax: z.number().int().min(1).max(50),
    equipment: z.enum(["barbell", "dumbbell", "machine", "bodyweight"]).optional(),
    compound: z.boolean().optional(),
    lowerBody: z.boolean().optional(),
    notes: z.string().max(120).optional(),
  })
  .refine((e) => e.repMin <= e.repMax, "rep range min must not exceed max");

const day = z.object({
  day: z.string().min(1).max(3),
  category: name,
  title: z.string().min(1).max(60),
  exercises: z.array(exercise).min(1).max(12),
});

const program = z
  .object({
    version: z.literal(2),
    split: z.string().min(1),
    notes: z.string().optional(),
    days: z.array(day).min(1).max(7),
  })
  .refine((p) => new Set(p.days.map((d) => d.category)).size === p.days.length, "workout keys must be unique");

/** Validate an edited routine; throws with the first problem on failure. */
export function parseProgram(raw: unknown): ProgramStructure {
  const result = program.safeParse(raw);
  if (!result.success) throw new Error(result.error.issues[0]?.message ?? "invalid routine");
  const p = result.data;
  return {
    ...p,
    days: p.days.map((d) => ({
      ...d,
      exercises: d.exercises.map((e, i) => ({ ...e, order: i + 1 })),
    })),
  };
}
