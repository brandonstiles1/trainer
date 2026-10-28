import { inferExerciseMeta } from "@/lib/engine/infer-meta";
import type { ExerciseMeta, ExerciseType, RepRange } from "@/lib/engine/exercise-meta";
import { restFor, type ProgressionSettings } from "./settings";

/**
 * The routine as stored in `plans.structure`. Version 2 is an A/B/C/D rotation
 * with sets and rep ranges on every exercise; older plans (weekday-keyed, no
 * sets or ranges) are read through `normalizeProgram` so they keep working.
 */
export type ProgramExercise = {
  /** snake_case; the key every logged set and preference is filed under. */
  name: string;
  order: number;
  sets: number;
  repMin: number;
  repMax: number;
  /** Overrides what the name implies — e.g. Bulgarian split squats done with dumbbells. */
  equipment?: ExerciseType;
  compound?: boolean;
  lowerBody?: boolean;
  /** "per leg", "or leg press" — shown under the name. */
  notes?: string;
};

export type ProgramDay = {
  /** Rotation slot: "A", "B", … */
  day: string;
  /** Stored as `workouts.day_key`; how a finished workout is matched back to its slot. */
  category: string;
  title: string;
  exercises: ProgramExercise[];
};

export type ProgramStructure = {
  version: 2;
  split: string;
  notes?: string;
  days: ProgramDay[];
};

type LegacyStructure = {
  split?: string;
  notes?: string;
  days?: Array<{
    day?: string;
    category?: string;
    title?: string;
    exercises?: Array<Partial<ProgramExercise> & { name: string; order?: number }>;
  }>;
};

const LETTERS = "ABCDEFGHIJ";
const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function isRotationProgram(raw: unknown): boolean {
  return !!raw && typeof raw === "object" && (raw as { version?: unknown }).version === 2;
}

/** Read any stored plan as a rotation, filling sets and rep ranges from defaults. */
export function normalizeProgram(raw: unknown): ProgramStructure {
  const src = (raw ?? {}) as LegacyStructure;
  const v2 = isRotationProgram(raw);
  const days = (src.days ?? []).map((d, i): ProgramDay => {
    const category = d.category ?? `day_${i + 1}`;
    return {
      day: v2 && d.day ? d.day : LETTERS[i] ?? String(i + 1),
      category,
      title: d.title ?? titleCase(category),
      exercises: (d.exercises ?? [])
        .slice()
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((e, j) => {
          const meta = inferExerciseMeta(e.name);
          return {
            ...e,
            name: e.name,
            order: j + 1,
            sets: e.sets ?? 3,
            repMin: e.repMin ?? meta.repRange.min,
            repMax: e.repMax ?? meta.repRange.max,
          };
        }),
    };
  });
  return { version: 2, split: src.split ?? "rotation", notes: src.notes, days };
}

/** The exercise's meta with the routine's explicit equipment/compound/lower overrides applied. */
export function metaFor(exercise: Pick<ProgramExercise, "name"> & Partial<ProgramExercise>): ExerciseMeta {
  const inferred = inferExerciseMeta(exercise.name);
  return {
    ...inferred,
    type: exercise.equipment ?? inferred.type,
    isCompound: exercise.compound ?? inferred.isCompound,
    isLowerBody: exercise.lowerBody ?? inferred.isLowerBody,
    repRange:
      exercise.repMin && exercise.repMax
        ? { min: exercise.repMin, max: exercise.repMax }
        : inferred.repRange,
  };
}

/**
 * Which slot is up next: the one after the last *finished rotation* workout.
 * Extra workouts and abandoned ones don't move the queue, and a missed day
 * just leaves the same workout waiting.
 */
export function nextRotationDay(
  program: ProgramStructure,
  lastRotationCategory: string | null,
): ProgramDay | null {
  if (program.days.length === 0) return null;
  const i = program.days.findIndex((d) => d.category === lastRotationCategory);
  return program.days[i === -1 ? 0 : (i + 1) % program.days.length];
}

const WORK_SECONDS_PER_SET = 40;
const TRANSITION_SECONDS = 30;
const WARMUP_SECONDS = 5 * 60;

/** Rough session length, warm-up included, rounded to 5 minutes. */
export function estimateMinutes(
  exercises: Array<Pick<ProgramExercise, "name" | "sets"> & Partial<ProgramExercise>>,
  settings: ProgressionSettings,
): number {
  const seconds = exercises.reduce((sum, e) => {
    const rest = restFor(metaFor(e), settings);
    return sum + e.sets * (WORK_SECONDS_PER_SET + rest) + TRANSITION_SECONDS;
  }, WARMUP_SECONDS);
  return Math.max(5, Math.round(seconds / 60 / 5) * 5);
}

export function repRangeOf(e: Pick<ProgramExercise, "repMin" | "repMax">): RepRange {
  return { min: e.repMin, max: e.repMax };
}
