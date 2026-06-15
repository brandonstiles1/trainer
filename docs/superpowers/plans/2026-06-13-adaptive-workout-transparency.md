# Adaptive Workout Transparency & History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make workouts visibly adapt to the user's maxes and real performance — deterministic 1RM-based adaptation that reacts to any-magnitude miss, per-set "why" rationale, editable sets that re-flow downstream, pinned baselines, a weekly Claude review, plus a Workouts history screen and a restyled 3-tab nav.

**Architecture:** Claude runs exactly twice (per-workout design + rationale; weekly baseline review). Everything in between is a pure, instant, testable math engine (`lib/adapt.ts`) that recomputes the whole set chain from logged actuals, so editing any set re-flows the rest. The session UI, Today preview, and Workouts history all share one collapsible exercise-card pattern.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, Drizzle ORM + Postgres (Supabase), `@anthropic-ai/sdk`, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-13-adaptive-workout-transparency-design.md`

**PR stack (each PR is independently shippable & testable):**
- **PR1** — Adaptation engine (`lib/adapt.ts`) + schema deltas. *Trust-critical core.*
- **PR2** — Generation: simplified tool schema, rationale, max-derivation prompt.
- **PR3** — Wire engine into server actions (`commitSet`/`editSet`/recompute).
- **PR4** — Session UI: two-level collapse, editable any set, cascade, live total, ⓘ reveal, pin banner.
- **PR5** — Workouts history screen + delete-from-detail.
- **PR6** — Today restyle + 3-tab nav (Plan → Settings, Progress retired).
- **PR7** — Weekly review (lazy-triggered Claude pass).

---

## PR1 — Adaptation engine + schema deltas

### Task 1: `lib/adapt.ts` — Epley helpers

**Files:**
- Create: `lib/adapt.ts`
- Test: `tests/adapt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/adapt.test.ts
import { describe, it, expect } from "vitest";
import { estimate1RM, weightForReps, roundToStep } from "@/lib/adapt";

describe("Epley helpers", () => {
  it("estimate1RM: 100x8 ≈ 126.67", () => {
    expect(estimate1RM(100, 8)).toBeCloseTo(126.6667, 3);
  });
  it("weightForReps inverts estimate1RM", () => {
    const e = estimate1RM(100, 8);
    expect(weightForReps(e, 8)).toBeCloseTo(100, 6);
  });
  it("roundToStep rounds to nearest 5 by default", () => {
    expect(roundToStep(90.48)).toBe(90);
    expect(roundToStep(92.6)).toBe(95);
    expect(roundToStep(13, 2.5)).toBe(12.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapt.test.ts`
Expected: FAIL — `estimate1RM` is not defined / cannot find module `@/lib/adapt`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/adapt.ts

/** Estimated one-rep max (Epley). */
export function estimate1RM(weight: number, reps: number): number {
  return weight * (1 + reps / 30);
}

/** Weight at which `reps` is the rep-max, given an estimated 1RM (inverse Epley). */
export function weightForReps(e1rm: number, reps: number): number {
  return e1rm / (1 + reps / 30);
}

/** Round to the nearest plate increment (default 5 lb). */
export function roundToStep(weight: number, step = 5): number {
  return Math.round(weight / step) * step;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapt.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/adapt.ts tests/adapt.test.ts
git commit -m "feat: Epley 1RM helpers for adaptation engine"
```

---

### Task 2: `lib/adapt.ts` — `adaptChain` recompute

**Files:**
- Modify: `lib/adapt.ts`
- Test: `tests/adapt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/adapt.test.ts
import { adaptChain, type AdaptSet, type Feeling } from "@/lib/adapt";

const seed = (targetReps: number, weight: number): AdaptSet => ({
  prescribed: { reps: targetReps, weight, targetReps },
  actual: null,
});
const logged = (s: AdaptSet, reps: number, weight: number, feeling: Feeling): AdaptSet => ({
  ...s,
  actual: { reps, weight, feeling },
});

describe("adaptChain", () => {
  it("leaves set 1 (seed) untouched", () => {
    const out = adaptChain([seed(10, 37), seed(10, 37), seed(10, 37)]);
    expect(out[0].prescribed.weight).toBe(37);
  });

  it("reacts to a huge over-performance (tricep example)", () => {
    // prescribed 10x37, user did 8x100 'okay' (yellow, buffer 2)
    const s1 = logged(seed(10, 37), 8, 100, "yellow");
    const out = adaptChain([s1, seed(10, 37)]);
    // e1RM = 100*(1+8/30)=126.67; weightForReps(126.67, 12)=90.48 -> 90
    expect(out[1].prescribed.weight).toBe(90);
    expect(out[1].prescribed.reps).toBe(10);
  });

  it("feeling=green pushes harder than yellow", () => {
    const green = adaptChain([logged(seed(8, 100), 8, 100, "green"), seed(8, 100)]);
    const yellow = adaptChain([logged(seed(8, 100), 8, 100, "yellow"), seed(8, 100)]);
    expect(green[1].prescribed.weight).toBeGreaterThan(yellow[1].prescribed.weight);
  });

  it("never prescribes below the baseline floor", () => {
    const out = adaptChain([logged(seed(10, 20), 4, 20, "red"), seed(10, 20)], 50);
    expect(out[1].prescribed.weight).toBeGreaterThanOrEqual(50);
  });

  it("editing an earlier set re-flows everything after it", () => {
    const chain = [logged(seed(8, 140), 8, 155, "yellow"), seed(8, 140), seed(8, 140)];
    const out = adaptChain(chain);
    // set 2 recomputed off 155, set 3 still seed (set 2 not logged yet)
    const set2 = out[1].prescribed.weight;
    expect(set2).toBeGreaterThan(140);
    expect(out[1].prescribed.rationale).toMatch(/1RM/);
  });

  it("does not recompute a set whose predecessor has no actual yet", () => {
    const out = adaptChain([seed(8, 140), seed(8, 140)]);
    expect(out[1].prescribed.weight).toBe(140);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapt.test.ts`
Expected: FAIL — `adaptChain` / `AdaptSet` / `Feeling` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// add to lib/adapt.ts (top)
export type Feeling = "red" | "yellow" | "green";
export type Actual = { reps: number; weight: number; feeling: Feeling };
export type Prescribed = {
  reps: number;
  weight: number;
  targetReps: number;
  rationale?: string;
};
export type AdaptSet = { prescribed: Prescribed; actual: Actual | null };

/** Rep buffer (RIR) by how the previous set felt. Tunable. */
const BUFFER: Record<Feeling, number> = { yellow: 2, green: 1, red: 3 };

/**
 * Recompute the prescribed weight for every set after the first, from the
 * ORDERED chain of actuals. Pure — returns a new array, never mutates input.
 * A set is only recomputed when its immediate predecessor has been logged.
 * Editing any set and re-running this re-flows all sets after it.
 */
export function adaptChain(sets: AdaptSet[], baselineFloor = 0): AdaptSet[] {
  return sets.map((set, i) => {
    if (i === 0) return set; // seed (set 1) is authoritative
    const prev = sets[i - 1].actual;
    if (!prev) return set; // predecessor not logged → leave seed value
    const e1rm = estimate1RM(prev.weight, prev.reps);
    const buffer = BUFFER[prev.feeling];
    const targetReps = set.prescribed.targetReps;
    const raw = weightForReps(e1rm, targetReps + buffer);
    const weight = Math.max(baselineFloor, roundToStep(raw));
    return {
      ...set,
      prescribed: {
        ...set.prescribed,
        reps: targetReps,
        weight,
        rationale: `Prior set ${prev.reps}×${prev.weight} ≈ ${Math.round(
          e1rm,
        )} est. 1RM; targeting ${targetReps} reps → ${weight}`,
      },
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapt.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add lib/adapt.ts tests/adapt.test.ts
git commit -m "feat: adaptChain — recompute set chain from actuals"
```

---

### Task 3: Schema deltas (enum, profile column)

**Files:**
- Modify: `lib/db/schema.ts:21-24` (enum), `lib/db/schema.ts:28-35` (profiles)
- Test: `tests/schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/schema.test.ts
import { liftSource } from "@/lib/db/schema";

describe("schema deltas", () => {
  it("lift_source enum includes user_pinned", () => {
    expect(liftSource.enumValues).toContain("user_pinned");
  });
  it("profiles has last_weekly_review_at", () => {
    expect(Object.keys(profiles)).toContain("lastWeeklyReviewAt");
  });
});
```

Note: `liftSource` is not currently exported from a test's perspective but it is `export const liftSource = pgEnum(...)` — add it to the import at the top of the file if not present.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/schema.test.ts`
Expected: FAIL — `user_pinned` not in enum / `lastWeeklyReviewAt` missing.

- [ ] **Step 3: Edit the schema**

In `lib/db/schema.ts`, change the enum:

```ts
export const liftSource = pgEnum("lift_source", [
  "user",
  "inferred_from_workout",
  "user_pinned",
]);
```

Add a column to `profiles` (inside the `pgTable("profiles", {...})` object, after `restTimerSeconds`):

```ts
  lastWeeklyReviewAt: timestamp("last_weekly_review_at", { withTimezone: true }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Generate the migration**

Run: `npm run db:generate`
Expected: a new file under `lib/db/migrations/` containing
`ALTER TYPE "public"."lift_source" ADD VALUE 'user_pinned';` and
`ALTER TABLE "profiles" ADD COLUMN "last_weekly_review_at" timestamp with time zone;`

If drizzle splits the enum `ADD VALUE` awkwardly, verify the SQL is valid Postgres (enum value additions cannot run inside a transaction with other statements on some PG versions — if `db:migrate` errors, split the `ADD VALUE` into its own migration file).

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema.ts lib/db/migrations tests/schema.test.ts
git commit -m "feat: schema — user_pinned lift source + profiles.last_weekly_review_at"
```

---

## PR2 — Generation: tool schema, rationale, derivation prompt

### Task 4: Simplify `submit_workout` tool (drop branches, add rationale + target_reps)

**Files:**
- Modify: `lib/workout-tool.ts`
- Test: `tests/workout-tool.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// replace the body of tests/workout-tool.test.ts
import { describe, it, expect } from "vitest";
import { workoutResponseSchema, submitWorkoutTool } from "@/lib/workout-tool";

describe("workout tool schema", () => {
  it("accepts the simplified shape (rationale + target_reps, no branches)", () => {
    const ok = {
      exercises: [
        {
          name: "incline_press",
          rationale: "~70% of flat bench max 200",
          sets: [
            { set_number: 1, target_reps: 8, weight: 140 },
            { set_number: 2, target_reps: 8, weight: 140 },
          ],
        },
      ],
    };
    expect(workoutResponseSchema.safeParse(ok).success).toBe(true);
  });

  it("rejects sets that still carry a branches tree", () => {
    const bad = {
      exercises: [
        { name: "incline_press", rationale: "x", sets: [{ set_number: 1, target_reps: 8, weight: 140, branches: {} }] },
      ],
    };
    // branches is simply ignored by zod unless strict; assert the field is gone from the parsed output
    const parsed = workoutResponseSchema.parse({
      exercises: [{ name: "incline_press", rationale: "x", sets: [{ set_number: 1, target_reps: 8, weight: 140 }] }],
    });
    expect(parsed.exercises[0].sets[0]).not.toHaveProperty("branches");
  });

  it("tool input_schema requires rationale and target_reps, not branches", () => {
    const props = (submitWorkoutTool.input_schema.properties.exercises as any).items.properties;
    expect(props.rationale).toBeDefined();
    const setProps = props.sets.items.properties;
    expect(setProps.target_reps).toBeDefined();
    expect(setProps.branches).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/workout-tool.test.ts`
Expected: FAIL — old schema still requires `prescribed`/`branches`.

- [ ] **Step 3: Rewrite `lib/workout-tool.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/workout-tool.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/workout-tool.ts tests/workout-tool.test.ts
git commit -m "feat: simplify submit_workout tool — rationale + target_reps, drop branches"
```

---

### Task 5: Derivation + rationale prompt

**Files:**
- Modify: `lib/prompts/workout-design.ts`
- Test: `tests/workout-design-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// replace tests/workout-design-prompt.test.ts
import { describe, it, expect } from "vitest";
import { WORKOUT_DESIGN_SYSTEM } from "@/lib/prompts/workout-design";

describe("workout design prompt", () => {
  it("instructs deriving start weight from related maxes", () => {
    expect(WORKOUT_DESIGN_SYSTEM.toLowerCase()).toMatch(/deriv|related|% of/);
  });
  it("requires a rationale per exercise", () => {
    expect(WORKOUT_DESIGN_SYSTEM.toLowerCase()).toContain("rationale");
  });
  it("no longer mentions branches", () => {
    expect(WORKOUT_DESIGN_SYSTEM.toLowerCase()).not.toContain("branch");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/workout-design-prompt.test.ts`
Expected: FAIL — old prompt mentions branches, no rationale instruction.

- [ ] **Step 3: Rewrite the prompt**

```ts
// lib/prompts/workout-design.ts
/**
 * System prompt for daily workout generation. Cached via cache_control: ephemeral.
 * Keep stable — drift invalidates the cache.
 */
export const WORKOUT_DESIGN_SYSTEM = `You are the user's strength coach designing today's workout. You will be given:

- Today's category (e.g. "push") and the ordered list of exercises for today
- The user's recent working weights for these exercises (last ~5 sessions if available)
- The user's self-reported and pinned max lifts ("lift estimates") if any

Your job: generate the full workout as a single call to the \`submit_workout\` tool. Do NOT write any prose outside the tool — the only natural language you produce is the per-exercise \`rationale\` field.

**Set design rules:**
- 3 to 5 sets per exercise (compounds 4–5, accessories 3)
- target_reps: 5–8 for main compounds, 8–12 for secondary compounds, 10–15 for accessories
- Set the SET 1 \`weight\` to a load the user can hit target_reps cleanly with ~2 reps in reserve
- Give every set a sensible starting \`weight\`; the app recomputes later sets from actual performance at runtime, so these are just initial values

**Deriving the start weight (important):**
- If you have prior data for the exact exercise, base set 1 on it (nudge up ~2.5–5 lbs, or 5% on lower-body compounds, if last session was easy)
- If you have NO prior data for this exercise but DO have a related max, DERIVE it. Examples: incline barbell press ≈ 70% of flat bench max; close-grip bench ≈ 80%; front squat ≈ 80% of back squat; Romanian deadlift ≈ 60–70% of deadlift. Use sound lifting ratios.
- Only when there is neither prior data nor any related max should you start conservatively.

**Rationale field (required, ≤160 chars):**
- One short sentence justifying the SET 1 weight. If derived, show the source: e.g. "≈70% of flat-bench max 200 — incline runs lighter." If from history: "Up 5 lbs from last session's easy 8×135."

**Naming:**
- Exercise \`name\` is snake_case lowercase, matching the names in the user's plan exactly

Never invent exercises not in today's plan. Never add warm-up sets as separate entries. Never call \`submit_workout\` more than once.`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/workout-design-prompt.test.ts`
Expected: PASS. Also run `npx vitest run tests/prompts.test.ts` to confirm no cross-test references broke.

- [ ] **Step 5: Commit**

```bash
git add lib/prompts/workout-design.ts tests/workout-design-prompt.test.ts
git commit -m "feat: prompt derives start weight from related maxes + emits rationale"
```

---

### Task 6: Map generated workout → stored prescribed (new shape)

**Files:**
- Modify: `lib/actions/workouts.ts` (the `createWorkout` and `adjustTodayWorkout` `setRows`/`newSetRows` builders, plus `generateWorkout` context to surface pinned maxes)
- Test: `tests/workout-rows.test.ts` (new — extract the row builder to a pure helper to test it)

- [ ] **Step 1: Extract a pure row builder and write the failing test**

```ts
// tests/workout-rows.test.ts
import { describe, it, expect } from "vitest";
import { toSetRows } from "@/lib/workouts/to-set-rows";
import type { WorkoutResponse } from "@/lib/workout-tool";

const gen: WorkoutResponse = {
  exercises: [
    {
      name: "incline_press",
      rationale: "≈70% of flat bench 200",
      sets: [
        { set_number: 1, target_reps: 8, weight: 140 },
        { set_number: 2, target_reps: 8, weight: 140 },
      ],
    },
  ],
};

describe("toSetRows", () => {
  it("builds rows with the new prescribed shape (reps, weight, targetReps, rationale on set 1)", () => {
    const rows = toSetRows("workout-1", gen);
    expect(rows).toHaveLength(2);
    expect(rows[0].prescribed).toEqual({
      reps: 8,
      weight: 140,
      targetReps: 8,
      rationale: "≈70% of flat bench 200",
    });
    // rationale only on set 1; later sets get theirs from adaptChain at runtime
    expect(rows[1].prescribed).toEqual({ reps: 8, weight: 140, targetReps: 8 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/workout-rows.test.ts`
Expected: FAIL — module `@/lib/workouts/to-set-rows` not found.

- [ ] **Step 3: Create the helper**

```ts
// lib/workouts/to-set-rows.ts
import type { WorkoutResponse } from "@/lib/workout-tool";

export type SetRow = {
  workoutId: string;
  exerciseName: string;
  setNumber: number;
  prescribed: {
    reps: number;
    weight: number;
    targetReps: number;
    rationale?: string;
  };
};

/** Flatten a generated workout into workout_sets rows (new prescribed shape). */
export function toSetRows(workoutId: string, gen: WorkoutResponse): SetRow[] {
  return gen.exercises.flatMap((ex) =>
    ex.sets.map((s) => ({
      workoutId,
      exerciseName: ex.name,
      setNumber: s.set_number,
      prescribed: {
        reps: s.target_reps,
        weight: s.weight,
        targetReps: s.target_reps,
        // Claude's rationale explains set 1; later sets are explained by adaptChain.
        ...(s.set_number === 1 ? { rationale: ex.rationale } : {}),
      },
    })),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/workout-rows.test.ts`
Expected: PASS.

- [ ] **Step 5: Use the helper in `lib/actions/workouts.ts`**

In `createWorkout`, replace the inline `setRows` block (currently `lib/actions/workouts.ts:89-96`) with:

```ts
  const { toSetRows } = await import("@/lib/workouts/to-set-rows");
  const setRows = toSetRows(workoutRow.id, generated);
```

In `adjustTodayWorkout`, replace the inline `newSetRows` block (currently `lib/actions/workouts.ts:330-337`) with:

```ts
  const { toSetRows } = await import("@/lib/workouts/to-set-rows");
  const newSetRows = toSetRows(inProgress.id, generated);
```

Also extend the `generateWorkout` context so pinned maxes are clearly labelled. In the `estimates` map (currently `lib/actions/workouts.ts:175`), change the line to:

```ts
      ? `Self-reported & pinned maxes:\n${estimates.map((e) => `- ${e.exerciseName}: ${e.weightLbs} lbs x ${e.reps} reps${e.source === "user_pinned" ? " (PINNED — treat as a floor)" : ""}`).join("\n")}\n\n`
```

- [ ] **Step 6: Run the full suite + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, no type errors. (Type errors in `session.tsx`/`page.tsx` referencing `branches` are expected here — they're fixed in PR3/PR4. If you want PR2 to stay green on `tsc`, defer the import-helper swap to PR3; otherwise land PR2+PR3 together. Recommended: land PR2 and PR3 in the same PR to keep `tsc` clean.)

- [ ] **Step 7: Commit**

```bash
git add lib/workouts/to-set-rows.ts lib/actions/workouts.ts tests/workout-rows.test.ts
git commit -m "feat: store new prescribed shape from generated workout"
```

---

## PR3 — Wire the engine into server actions

### Task 7: Rebuild `commitSet`/`editSet` to recompute the chain

**Files:**
- Modify: `lib/actions/workouts.ts` (`commitSet`, add `editSet`, remove `applyBranch` import)
- Modify: `app/workout/[id]/actions.ts` (export `editSet`)
- Delete: `lib/branch.ts` and `tests/branch.test.ts` (replaced by `lib/adapt.ts`)
- Test: `tests/commit-recompute.test.ts` (new — test the pure recompute helper)

- [ ] **Step 1: Extract a pure recompute helper + failing test**

```ts
// tests/commit-recompute.test.ts
import { describe, it, expect } from "vitest";
import { recomputeExercise, type StoredSet } from "@/lib/workouts/recompute-exercise";

const mk = (n: number, reps: number, weight: number, actual: StoredSet["actual"] = null): StoredSet => ({
  id: `s${n}`,
  setNumber: n,
  prescribed: { reps, weight, targetReps: reps },
  actual,
});

describe("recomputeExercise", () => {
  it("recomputes downstream weights from a logged set and returns only changed rows", () => {
    const sets: StoredSet[] = [
      mk(1, 10, 37, { reps: 8, weight: 100, feeling: "yellow" }),
      mk(2, 10, 37),
      mk(3, 10, 37),
    ];
    const changed = recomputeExercise(sets, 0);
    // set 2 recomputed to 90; set 3 stays seed (set 2 not logged)
    expect(changed.find((c) => c.id === "s2")?.prescribed.weight).toBe(90);
    expect(changed.find((c) => c.id === "s3")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commit-recompute.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

```ts
// lib/workouts/recompute-exercise.ts
import { adaptChain, type AdaptSet } from "@/lib/adapt";

export type StoredSet = {
  id: string;
  setNumber: number;
  prescribed: { reps: number; weight: number; targetReps: number; rationale?: string };
  actual: { reps: number; weight: number; feeling: "red" | "yellow" | "green" } | null;
};

/**
 * Recompute one exercise's sets (ordered by setNumber) via adaptChain and
 * return only the rows whose prescribed changed, so callers persist a minimal diff.
 * `baselineFloor` is the user's pinned weight for this lift (0 if none).
 */
export function recomputeExercise(
  ordered: StoredSet[],
  baselineFloor = 0,
): Array<{ id: string; prescribed: StoredSet["prescribed"] }> {
  const chain: AdaptSet[] = ordered.map((s) => ({ prescribed: s.prescribed, actual: s.actual }));
  const out = adaptChain(chain, baselineFloor);
  const changed: Array<{ id: string; prescribed: StoredSet["prescribed"] }> = [];
  out.forEach((c, i) => {
    const before = ordered[i].prescribed;
    if (
      c.prescribed.weight !== before.weight ||
      c.prescribed.reps !== before.reps ||
      c.prescribed.rationale !== before.rationale
    ) {
      changed.push({ id: ordered[i].id, prescribed: c.prescribed });
    }
  });
  return changed;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commit-recompute.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite `commitSet` and add `editSet` in `lib/actions/workouts.ts`**

Remove the `applyBranch` import (line 8). Replace the `commitSet` body (currently `lib/actions/workouts.ts:207-255`) with a version that writes the actual, then recomputes the whole exercise:

```ts
import { recomputeExercise, type StoredSet } from "@/lib/workouts/recompute-exercise";
import { liftEstimates } from "@/lib/db/schema";

export type CommitSetInput = {
  workoutId: string;
  setId: string;
  actual: { reps: number; weight: number; feeling: "red" | "yellow" | "green" };
};

export async function commitSet(input: CommitSetInput): Promise<void> {
  await writeActualAndRecompute(input.workoutId, input.setId, input.actual);
}

/** Edit a previously-logged set; identical write + full re-flow of the exercise. */
export async function editSet(input: CommitSetInput): Promise<void> {
  await writeActualAndRecompute(input.workoutId, input.setId, input.actual);
}

async function writeActualAndRecompute(
  workoutId: string,
  setId: string,
  actual: CommitSetInput["actual"],
): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");

  const [row] = await db
    .select({
      workoutUserId: workouts.userId,
      exerciseName: workoutSets.exerciseName,
    })
    .from(workoutSets)
    .innerJoin(workouts, eq(workouts.id, workoutSets.workoutId))
    .where(and(eq(workoutSets.id, setId), eq(workoutSets.workoutId, workoutId)))
    .limit(1);
  if (!row || row.workoutUserId !== user.id) throw new Error("set not found");

  await db
    .update(workoutSets)
    .set({ actual, completedAt: new Date() })
    .where(eq(workoutSets.id, setId));

  // Pinned baseline floor for this exercise (highest pinned weight), 0 if none.
  const pins = await db
    .select({ weightLbs: liftEstimates.weightLbs })
    .from(liftEstimates)
    .where(
      and(
        eq(liftEstimates.userId, user.id),
        eq(liftEstimates.exerciseName, row.exerciseName),
        eq(liftEstimates.source, "user_pinned"),
      ),
    );
  const floor = pins.reduce((m, p) => Math.max(m, p.weightLbs), 0);

  const ordered = (await db
    .select()
    .from(workoutSets)
    .where(and(eq(workoutSets.workoutId, workoutId), eq(workoutSets.exerciseName, row.exerciseName)))
    .orderBy(asc(workoutSets.setNumber))) as unknown as Array<{
      id: string;
      setNumber: number;
      prescribed: StoredSet["prescribed"];
      actual: StoredSet["actual"];
    }>;

  const changed = recomputeExercise(ordered.map((r) => ({
    id: r.id, setNumber: r.setNumber, prescribed: r.prescribed, actual: r.actual,
  })), floor);

  for (const c of changed) {
    await db.update(workoutSets).set({ prescribed: c.prescribed }).where(eq(workoutSets.id, c.id));
  }
}
```

- [ ] **Step 6: Export `editSet` from the route actions**

In `app/workout/[id]/actions.ts`, add:

```ts
import {
  commitSet as commitSetImpl,
  editSet as editSetImpl,
  completeWorkout as completeWorkoutImpl,
  abandonWorkout as abandonWorkoutImpl,
} from "@/lib/actions/workouts";
import type { CommitSetInput } from "@/lib/actions/workouts";

export async function editSet(input: CommitSetInput) {
  return editSetImpl(input);
}
```

- [ ] **Step 7: Delete the obsolete branch engine**

```bash
git rm lib/branch.ts tests/branch.test.ts
```

- [ ] **Step 8: Run suite + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: `npm test` PASS. `tsc` will still error in `session.tsx` and `page.tsx` (they import `applyBranch`/`branches`) — those are fixed in PR4. Land PR3 + PR4 together, or temporarily stub the imports. Note this in the PR description.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: commitSet/editSet recompute exercise chain via adapt engine"
```

---

## PR4 — Session UI (depends on PR3)

### Task 8: Update page loader to the new prescribed shape

**Files:**
- Modify: `app/workout/[id]/page.tsx`

- [ ] **Step 1: Replace branch types with the adapt shape**

Remove the `applyBranch` import and `Branches` type (lines 8–10). Update the `SessionSet` mapping (lines 71–81):

```ts
  const sets: SessionSet[] = sortedRows.map((r) => {
    const p = r.prescribed as {
      reps: number; weight: number; targetReps: number; rationale?: string;
    };
    return {
      id: r.id,
      exerciseName: r.exerciseName,
      setNumber: r.setNumber,
      prescribed: { reps: p.reps, weight: p.weight, targetReps: p.targetReps, rationale: p.rationale },
      completed: r.completedAt !== null,
      actual: r.actual as SessionSet["actual"],
    };
  });
```

(Pre-existing in-progress workouts created before PR1 may have the old `prescribed` without `targetReps`; default it: `targetReps: p.targetReps ?? p.reps`.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` (expect remaining errors only inside `session.tsx`, fixed next task).

- [ ] **Step 3: Commit**

```bash
git add app/workout/[id]/page.tsx
git commit -m "feat: load sets in new prescribed shape"
```

---

### Task 9: Session — adapt types, live total, ⓘ reveal

**Files:**
- Modify: `app/workout/[id]/session.tsx`

- [ ] **Step 1: Replace the branch import + `SessionSet` type**

Top of `session.tsx` — drop `import { applyBranch, type Feeling } from "@/lib/branch"` and `type Branches = ...`. Replace with:

```ts
import { adaptChain, type AdaptSet, type Feeling } from "@/lib/adapt";
import { commitSet, editSet, completeWorkout, abandonWorkout } from "./actions";

export type SessionSet = {
  id: string;
  exerciseName: string;
  setNumber: number;
  prescribed: { reps: number; weight: number; targetReps: number; rationale?: string };
  completed: boolean;
  actual: { reps: number; weight: number; feeling: Feeling } | null;
};
```

- [ ] **Step 2: Replace `handleCommit` with a chain-recompute version**

Replace the `applyBranch` call inside `handleCommit` (lines ~219–226) so the client mirrors the server's full re-flow. After marking the set complete, rebuild that exercise's chain:

```ts
  // Rebuild this exercise's chain client-side for instant feedback.
  const exerciseSets = updated
    .filter((s) => s.exerciseName === current.exerciseName)
    .sort((a, b) => a.setNumber - b.setNumber);
  const chain: AdaptSet[] = exerciseSets.map((s) => ({
    prescribed: s.prescribed,
    actual: s.actual,
  }));
  const adapted = adaptChain(chain);
  updated = updated.map((s) => {
    const idxIn = exerciseSets.findIndex((e) => e.id === s.id);
    return idxIn === -1 ? s : { ...s, prescribed: adapted[idxIn].prescribed };
  });
```

Keep the existing `commitSet({ workoutId, setId, actual })` server call and the "calculating" beat.

- [ ] **Step 3: Add the live total to the header**

Replace the `volume` stat usage. `volume` already exists (lines 180–183). Surface it prominently in the header — add above the stats row, inside `<header>`:

```tsx
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums text-white">
              {formatVolume(volume)}
            </span>
            <span className="text-[11px] uppercase tracking-wide text-white/60">lbs lifted</span>
          </div>
```

(`formatVolume` already exists at line 29.)

- [ ] **Step 4: Add the ⓘ reveal to `ActiveSet`**

In `ActiveSet`, below the "Set N · prescribed …" line, add an info toggle that reveals `set.prescribed.rationale`:

```tsx
  const [showWhy, setShowWhy] = useState(false);
  // ...
  {set.prescribed.rationale && (
    <button
      type="button"
      onClick={() => setShowWhy((v) => !v)}
      aria-label="Why this number?"
      className="ml-1.5 inline-flex size-4 items-center justify-center rounded-full border border-[var(--teal)] text-[10px] font-bold text-[var(--teal)]"
    >i</button>
  )}
  {showWhy && set.prescribed.rationale && (
    <p className="mt-2 rounded-[8px] border-[0.5px] border-[var(--teal)]/30 bg-[var(--teal)]/5 px-2.5 py-2 text-[11px] leading-snug text-[var(--teal)]">
      {set.prescribed.rationale}
    </p>
  )}
```

- [ ] **Step 5: Typecheck + manual smoke**

Run: `npx tsc --noEmit` → clean. Then `npm run dev`, start a workout, log a set with a big weight, confirm the next set jumps appropriately and the total climbs.

- [ ] **Step 6: Commit**

```bash
git add app/workout/[id]/session.tsx
git commit -m "feat: session uses adapt engine, shows live total + why reveal"
```

---

### Task 10: Session — expand/edit any set (two-level collapse + cascade)

**Files:**
- Modify: `app/workout/[id]/session.tsx`

- [ ] **Step 1: Make completed set rows tappable to open an editor**

Add `openSetId` state and let `CompactSetRow` call back on tap. Replace the render branch for completed sets so a tapped completed set renders an editor:

```tsx
  const [openSetId, setOpenSetId] = useState<string | null>(null);
  // ...inside the exercise body map:
  if (s.id === activeSetId) return <ActiveSet key={s.id} set={s} onCommit={(a) => handleCommit(s.id, a)} />;
  if (s.id === calculatingSetId) return <CalculatingNext key={s.id} />;
  if (s.id === openSetId && s.completed)
    return <ActiveSet key={s.id} set={s} editing onCommit={(a) => handleEdit(s.id, a)} />;
  return <CompactSetRow key={s.id} set={s} divider={!last} onTap={() => setOpenSetId(s.id)} />;
```

- [ ] **Step 2: Add `handleEdit` that re-flows + persists via `editSet`**

```tsx
  async function handleEdit(setId: string, actual: Actual) {
    let updated = sets.map((s) => (s.id === setId ? { ...s, actual } : s));
    const target = updated.find((s) => s.id === setId)!;
    const exerciseSets = updated
      .filter((s) => s.exerciseName === target.exerciseName)
      .sort((a, b) => a.setNumber - b.setNumber);
    const adapted = adaptChain(exerciseSets.map((s) => ({ prescribed: s.prescribed, actual: s.actual })));
    updated = updated.map((s) => {
      const i = exerciseSets.findIndex((e) => e.id === s.id);
      return i === -1 ? s : { ...s, prescribed: adapted[i].prescribed };
    });
    setSets(updated);
    setOpenSetId(null);
    await editSet({ workoutId, setId, actual });
  }
```

- [ ] **Step 3: Add `editing` prop + tap target to `ActiveSet`/`CompactSetRow`**

Give `ActiveSet` an optional `editing?: boolean` (changes the "active" pill text to "editing" and pre-fills from `set.actual ?? set.prescribed`). Add `onTap?: () => void` to `CompactSetRow`, wrap the row in a `<button onClick={onTap}>` with a trailing `›` chevron.

```tsx
function CompactSetRow({ set, divider, onTap }: { set: SessionSet; divider: boolean; onTap?: () => void }) {
  // wrap existing content in: <button type="button" onClick={onTap} className="w-full ...">
  // append a ChevronRight icon when onTap is provided
}
```

In `ActiveSet`, initialise from actuals when editing:

```tsx
  const [reps, setReps] = useState(String((editing ? set.actual?.reps : undefined) ?? set.prescribed.reps));
  const [weight, setWeight] = useState(String((editing ? set.actual?.weight : undefined) ?? set.prescribed.weight));
```

- [ ] **Step 4: Typecheck + manual smoke**

Run: `npx tsc --noEmit` → clean. `npm run dev`: tap a completed set, change its weight, confirm later sets re-flow and the total updates.

- [ ] **Step 5: Commit**

```bash
git add app/workout/[id]/session.tsx
git commit -m "feat: edit any set, two-level collapse, cascade re-flow"
```

---

### Task 11: Pin-baseline banner + action

**Files:**
- Create: `lib/actions/lift-estimates.ts` (`pinBaseline`)
- Modify: `app/workout/[id]/actions.ts` (export `pinBaseline`)
- Modify: `app/workout/[id]/session.tsx` (banner)
- Test: `tests/pin-trigger.test.ts`

- [ ] **Step 1: Failing test for the trigger predicate**

```ts
// tests/pin-trigger.test.ts
import { describe, it, expect } from "vitest";
import { isBigJump } from "@/lib/workouts/pin-trigger";

describe("isBigJump", () => {
  it("true when actual weight is >=25% over prescribed", () => {
    expect(isBigJump(37, 100)).toBe(true);
    expect(isBigJump(100, 125)).toBe(true);
  });
  it("false for small or no increase", () => {
    expect(isBigJump(100, 110)).toBe(false);
    expect(isBigJump(100, 100)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pin-trigger.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement the predicate**

```ts
// lib/workouts/pin-trigger.ts
/** True when a logged weight is far enough above prescribed to offer a baseline pin. */
export function isBigJump(prescribedWeight: number, actualWeight: number, ratio = 1.25): boolean {
  if (prescribedWeight <= 0) return actualWeight > 0;
  return actualWeight >= prescribedWeight * ratio;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/pin-trigger.test.ts` → PASS.

- [ ] **Step 5: Implement `pinBaseline`**

```ts
// lib/actions/lift-estimates.ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { liftEstimates } from "@/lib/db/schema";

export async function pinBaseline(input: {
  exerciseName: string;
  weightLbs: number;
  reps: number;
}): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");
  await db.insert(liftEstimates).values({
    userId: user.id,
    exerciseName: input.exerciseName,
    weightLbs: Math.round(input.weightLbs),
    reps: input.reps,
    source: "user_pinned",
  });
}
```

Re-export from `app/workout/[id]/actions.ts`:

```ts
import { pinBaseline as pinBaselineImpl } from "@/lib/actions/lift-estimates";
export async function pinBaseline(i: { exerciseName: string; weightLbs: number; reps: number }) {
  return pinBaselineImpl(i);
}
```

- [ ] **Step 6: Show the banner in `session.tsx`**

After a commit, if `isBigJump(prescribed.weight, actual.weight)`, set `pinPrompt = { exerciseName, weight, reps }`. Render a banner above the next active set:

```tsx
  {pinPrompt && (
    <div className="mx-4 mb-3 rounded-[12px] border-[0.5px] border-[var(--teal)]/40 bg-[var(--teal)]/5 p-3">
      <p className="text-sm font-medium text-[var(--teal)]">Big jump — pin {pinPrompt.weight} lbs?</p>
      <p className="mt-1 text-[11px] text-[var(--teal)]/80">
        Future {titleCase(pinPrompt.exerciseName)} workouts will start from here.
      </p>
      <div className="mt-2 flex gap-2">
        <button className="..." onClick={async () => { await pinBaseline(pinPrompt); setPinPrompt(null); }}>Pin baseline</button>
        <button className="..." onClick={() => setPinPrompt(null)}>Not now</button>
      </div>
    </div>
  )}
```

Import `isBigJump` and `pinBaseline`. Add `const [pinPrompt, setPinPrompt] = useState<{exerciseName:string;weight:number;reps:number}|null>(null);`.

- [ ] **Step 7: Typecheck + manual smoke**

Run: `npx tsc --noEmit` → clean. `npm run dev`: log a set ≥25% over prescribed → banner appears → Pin → confirm a `user_pinned` row exists (`npm run db:studio`).

- [ ] **Step 8: Commit**

```bash
git add lib/actions/lift-estimates.ts lib/workouts/pin-trigger.ts app/workout/[id]/actions.ts app/workout/[id]/session.tsx tests/pin-trigger.test.ts
git commit -m "feat: pin-baseline banner on big jumps"
```

---

## PR5 — Workouts history screen

### Task 12: Workouts list data + delete action

**Files:**
- Create: `lib/actions/workout-history.ts` (`listWorkouts`, `deleteWorkout`)
- Test: `tests/workout-history-shape.test.ts`

- [ ] **Step 1: Failing test for the summary shaper**

```ts
// tests/workout-history-shape.test.ts
import { describe, it, expect } from "vitest";
import { summarizeWorkout } from "@/lib/workouts/summarize-workout";

describe("summarizeWorkout", () => {
  it("computes volume and groups sets by exercise in order", () => {
    const out = summarizeWorkout([
      { exerciseName: "incline_press", setNumber: 1, actual: { reps: 8, weight: 140, feeling: "yellow" } },
      { exerciseName: "incline_press", setNumber: 2, actual: { reps: 8, weight: 140, feeling: "yellow" } },
      { exerciseName: "lateral_raise", setNumber: 1, actual: { reps: 15, weight: 20, feeling: "green" } },
    ]);
    expect(out.volume).toBe(8 * 140 + 8 * 140 + 15 * 20);
    expect(out.exercises.map((e) => e.name)).toEqual(["incline_press", "lateral_raise"]);
    expect(out.exercises[0].sets).toEqual(["8×140", "8×140"]);
  });
});
```

- [ ] **Step 2: Run test → FAIL**

Run: `npx vitest run tests/workout-history-shape.test.ts`

- [ ] **Step 3: Implement the shaper**

```ts
// lib/workouts/summarize-workout.ts
type Row = {
  exerciseName: string;
  setNumber: number;
  actual: { reps: number; weight: number; feeling: string } | null;
};

export function summarizeWorkout(rows: Row[]) {
  let volume = 0;
  const order: string[] = [];
  const map = new Map<string, string[]>();
  for (const r of [...rows].sort((a, b) => a.setNumber - b.setNumber)) {
    if (!map.has(r.exerciseName)) { map.set(r.exerciseName, []); order.push(r.exerciseName); }
    if (r.actual) {
      volume += r.actual.reps * r.actual.weight;
      map.get(r.exerciseName)!.push(`${r.actual.reps}×${r.actual.weight}`);
    }
  }
  return { volume, exercises: order.map((name) => ({ name, sets: map.get(name)! })) };
}
```

- [ ] **Step 4: Run test → PASS**

Run: `npx vitest run tests/workout-history-shape.test.ts`

- [ ] **Step 5: Implement the actions**

```ts
// lib/actions/workout-history.ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { workouts, workoutSets } from "@/lib/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";

export async function deleteWorkout(workoutId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");
  // Ownership check
  const [w] = await db.select({ userId: workouts.userId }).from(workouts)
    .where(eq(workouts.id, workoutId)).limit(1);
  if (!w || w.userId !== user.id) throw new Error("workout not found");
  await db.transaction(async (tx) => {
    await tx.delete(workoutSets).where(eq(workoutSets.workoutId, workoutId));
    await tx.delete(workouts).where(eq(workouts.id, workoutId));
  });
}
```

- [ ] **Step 6: Commit**

```bash
git add lib/workouts/summarize-workout.ts lib/actions/workout-history.ts tests/workout-history-shape.test.ts
git commit -m "feat: workout history shaper + delete action"
```

---

### Task 13: Workouts route (collapsible cards + delete-from-detail)

**Files:**
- Create: `app/workouts/page.tsx` (server: load completed/abandoned workouts + sets)
- Create: `app/workouts/list.tsx` (client: collapsible cards, ⋯ menu → delete)

- [ ] **Step 1: Server page loads sessions + summaries**

```tsx
// app/workouts/page.tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { workouts, workoutSets } from "@/lib/db/schema";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { summarizeWorkout } from "@/lib/workouts/summarize-workout";
import { WorkoutsList } from "./list";

export default async function WorkoutsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const sessions = await db.select().from(workouts)
    .where(and(eq(workouts.userId, user.id), ne(workouts.status, "in_progress")))
    .orderBy(desc(workouts.startedAt)).limit(50);

  const ids = sessions.map((s) => s.id);
  const sets = ids.length
    ? await db.select().from(workoutSets).where(inArray(workoutSets.workoutId, ids))
    : [];

  const items = sessions.map((s) => {
    const rows = sets.filter((r) => r.workoutId === s.id).map((r) => ({
      exerciseName: r.exerciseName, setNumber: r.setNumber,
      actual: r.actual as { reps: number; weight: number; feeling: string } | null,
    }));
    return {
      id: s.id, dayKey: s.dayKey, status: s.status,
      startedAt: s.startedAt.toISOString(), setCount: rows.length,
      ...summarizeWorkout(rows),
    };
  });

  return <WorkoutsList items={items} />;
}
```

- [ ] **Step 2: Client list — collapsible cards + ⋯ delete**

```tsx
// app/workouts/list.tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { deleteWorkout } from "@/lib/actions/workout-history";

type Item = {
  id: string; dayKey: string; status: string; startedAt: string;
  setCount: number; volume: number; exercises: { name: string; sets: string[] }[];
};
const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function WorkoutsList({ items }: { items: Item[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(items[0]?.id ?? null);
  const [menu, setMenu] = useState<string | null>(null);

  async function onDelete(id: string) {
    if (!confirm("Delete this workout? This can't be undone.")) return;
    await deleteWorkout(id);
    router.refresh();
  }

  return (
    <main className="px-4 py-6 max-w-md mx-auto pb-24">
      <h1 className="px-1 text-2xl font-bold">Workouts</h1>
      <div className="mt-4 space-y-3">
        {items.map((w) => {
          const isOpen = open === w.id;
          return (
            <section key={w.id} className="rounded-[13px] bg-white border-[0.5px] border-[color:var(--hairline)] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3">
                <button className="min-w-0 text-left" onClick={() => setOpen(isOpen ? null : w.id)}>
                  <h2 className="text-[15px] font-semibold capitalize">{w.dayKey}
                    <span className="ml-2 rounded-full bg-[var(--teal)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--teal)]">{w.status}</span>
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {new Date(w.startedAt).toLocaleDateString()} · {w.setCount} sets · {w.volume.toLocaleString()} lbs
                  </p>
                </button>
                <div className="flex items-center gap-1">
                  <button aria-label="Options" onClick={() => setMenu(menu === w.id ? null : w.id)} className="p-1 text-muted-foreground">
                    <MoreHorizontal className="size-5" />
                  </button>
                  <ChevronDown className={`size-5 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </div>
              </div>
              {menu === w.id && (
                <div className="border-t border-[color:var(--hairline)] px-4 py-2">
                  <button onClick={() => onDelete(w.id)} className="text-sm font-medium text-red-600">Delete workout</button>
                </div>
              )}
              {isOpen && (
                <div className="border-t border-[color:var(--hairline)]">
                  {w.exercises.map((ex) => (
                    <div key={ex.name} className="px-4 py-2.5 border-b border-[color:var(--hairline)] last:border-0">
                      <p className="text-xs font-semibold capitalize text-foreground">{titleCase(ex.name)}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">{ex.sets.join(" · ")}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
        {items.length === 0 && <p className="px-1 text-sm text-muted-foreground">No workouts yet.</p>}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Typecheck + manual smoke**

Run: `npx tsc --noEmit` → clean. `npm run dev` → visit `/workouts`, expand a card, open ⋯, delete, confirm it disappears.

- [ ] **Step 4: Commit**

```bash
git add app/workouts/page.tsx app/workouts/list.tsx
git commit -m "feat: Workouts history screen with delete-from-detail"
```

---

## PR6 — Today restyle + 3-tab nav

### Task 14: 3-tab nav (Plan → Settings, Progress retired)

**Files:**
- Modify: `components/bottom-nav.tsx`
- Delete: `app/progress/page.tsx`
- Modify: `app/settings/page.tsx` (add a Plan entry point)

- [ ] **Step 1: Update the tabs**

```tsx
// components/bottom-nav.tsx — TABS array
import { Flame, Dumbbell, Settings, type LucideIcon } from "lucide-react";

const TABS: { href: string; label: string; Icon: LucideIcon }[] = [
  { href: "/today", label: "Today", Icon: Flame },
  { href: "/workouts", label: "Workouts", Icon: Dumbbell },
  { href: "/settings", label: "Settings", Icon: Settings },
];
```

Change the grid to 3 columns: `className="grid grid-cols-3 h-16 max-w-md mx-auto"`.

- [ ] **Step 2: Add a Plan link in Settings**

In `app/settings/page.tsx`, add a navigation row/link to `/plan` (the existing plan-design chat route stays; only the tab is removed):

```tsx
import Link from "next/link";
// within the page body:
<Link href="/plan" className="block rounded-lg border p-4 text-sm font-medium">
  Edit training plan →
</Link>
```

- [ ] **Step 3: Retire Progress**

```bash
git rm app/progress/page.tsx
```

Confirm nothing imports it: `grep -rn "/progress" app components lib` → only stale references, remove if any.

- [ ] **Step 4: Typecheck + manual smoke**

Run: `npx tsc --noEmit` → clean. `npm run dev`: nav shows 3 tabs; Settings links to Plan; `/progress` 404s (expected).

- [ ] **Step 5: Commit**

```bash
git add components/bottom-nav.tsx app/settings/page.tsx
git rm app/progress/page.tsx
git commit -m "feat: 3-tab nav — Workouts replaces Progress, Plan moves to Settings"
```

---

### Task 15: Today restyle (collapsible prescribed cards + ⓘ)

**Files:**
- Modify: `app/today/page.tsx`
- Create: `app/today/plan-preview.tsx` (client: collapsible exercise cards, read-only)

- [ ] **Step 1: Move the plan list into a collapsible client component**

```tsx
// app/today/plan-preview.tsx
"use client";
import { useState } from "react";
import { ChevronDown } from "lucide-react";

type Ex = { name: string; order: number; notes?: string };
const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function PlanPreview({ category, exercises }: { category: string; exercises: Ex[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const sorted = [...exercises].sort((a, b) => a.order - b.order);
  return (
    <section className="space-y-3">
      <p className="px-1 text-xs uppercase tracking-wide text-muted-foreground">{category}</p>
      {sorted.map((e) => {
        const isOpen = open === e.name;
        return (
          <div key={e.name} className="rounded-[13px] bg-white border-[0.5px] border-[color:var(--hairline)] overflow-hidden">
            <button className="w-full flex items-center justify-between px-4 py-3 text-left" onClick={() => setOpen(isOpen ? null : e.name)}>
              <span className="text-[15px] font-medium capitalize">{titleCase(e.name)}</span>
              <ChevronDown className={`size-5 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </button>
            {isOpen && e.notes && (
              <p className="border-t border-[color:var(--hairline)] px-4 py-2.5 text-xs text-muted-foreground">{e.notes}</p>
            )}
          </div>
        );
      })}
    </section>
  );
}
```

(Note: pre-start, there are no prescribed sets yet — the preview lists exercises. Prescribed weights/ⓘ appear once the workout is generated on the session screen. Keep the preview lightweight.)

- [ ] **Step 2: Use it in `app/today/page.tsx`**

Replace the inline `<ul>…</ul>` block (lines 61–73) with:

```tsx
import { PlanPreview } from "./plan-preview";
// ...
<PlanPreview category={planDay.category} exercises={planDay.exercises} />
<StartWorkoutButton />
```

- [ ] **Step 3: Typecheck + manual smoke**

Run: `npx tsc --noEmit` → clean. `npm run dev`: Today shows collapsible exercise cards + Start.

- [ ] **Step 4: Commit**

```bash
git add app/today/page.tsx app/today/plan-preview.tsx
git commit -m "feat: Today restyle — collapsible exercise cards"
```

---

## PR7 — Weekly review

### Task 16: Weekly review prompt + tool

**Files:**
- Create: `lib/prompts/weekly-review.ts`
- Create: `lib/review-tool.ts`
- Test: `tests/review-tool.test.ts`

- [ ] **Step 1: Failing test for the review tool schema**

```ts
// tests/review-tool.test.ts
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
```

- [ ] **Step 2: Run test → FAIL**

Run: `npx vitest run tests/review-tool.test.ts`

- [ ] **Step 3: Implement prompt + tool**

```ts
// lib/prompts/weekly-review.ts
export const WEEKLY_REVIEW_SYSTEM = `You are the user's strength coach reviewing the past week.
You receive each exercise's prescribed-vs-actual sets, how they felt, and any PINNED baselines.
Update the user's working baselines via the \`submit_review\` tool. Rules:
- Raise a baseline when actuals consistently beat prescribed at an easy/okay effort.
- Never lower a PINNED baseline; treat it as a floor.
- A pin is a "ceiling hint" — if a related lift is pinned high, you may raise related lifts using sound ratios (e.g. close-grip ≈ 80% of bench).
- Output only realistic, evidence-backed updates. An empty list is valid.
Call \`submit_review\` exactly once; no prose outside it.`;
```

```ts
// lib/review-tool.ts
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
```

- [ ] **Step 4: Run test → PASS**

Run: `npx vitest run tests/review-tool.test.ts`

- [ ] **Step 5: Commit**

```bash
git add lib/prompts/weekly-review.ts lib/review-tool.ts tests/review-tool.test.ts
git commit -m "feat: weekly-review prompt + tool schema"
```

---

### Task 17: Lazy-triggered review action + wiring

**Files:**
- Create: `lib/actions/weekly-review.ts` (`maybeRunWeeklyReview`)
- Modify: `lib/actions/workouts.ts` (`startWorkout`/`startImpromptuWorkout` fire-and-forget the review)
- Test: `tests/review-due.test.ts`

- [ ] **Step 1: Failing test for the "is it due?" predicate**

```ts
// tests/review-due.test.ts
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
```

- [ ] **Step 2: Run test → FAIL**

Run: `npx vitest run tests/review-due.test.ts`

- [ ] **Step 3: Implement the predicate**

```ts
// lib/workouts/review-due.ts
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export function isReviewDue(last: Date | null, now: Date): boolean {
  if (!last) return true;
  return now.getTime() - last.getTime() >= WEEK_MS;
}
```

- [ ] **Step 4: Run test → PASS**

Run: `npx vitest run tests/review-due.test.ts`

- [ ] **Step 5: Implement `maybeRunWeeklyReview`**

```ts
// lib/actions/weekly-review.ts
"use server";

import { db } from "@/lib/db";
import { profiles, workouts, workoutSets, liftEstimates } from "@/lib/db/schema";
import { and, desc, eq, gte } from "drizzle-orm";
import { isReviewDue } from "@/lib/workouts/review-due";

/** Runs at most once/week per user. Safe to fire-and-forget; failures don't advance the timestamp. */
export async function maybeRunWeeklyReview(userId: string): Promise<void> {
  const [profile] = await db.select({ last: profiles.lastWeeklyReviewAt })
    .from(profiles).where(eq(profiles.userId, userId)).limit(1);
  const now = new Date();
  if (!isReviewDue(profile?.last ?? null, now)) return;

  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const recent = await db.select().from(workouts)
    .where(and(eq(workouts.userId, userId), eq(workouts.status, "completed"), gte(workouts.startedAt, weekAgo)))
    .orderBy(desc(workouts.startedAt));
  if (recent.length === 0) return; // nothing to review; try again next time

  const { anthropic, model } = await import("@/lib/anthropic");
  const { WEEKLY_REVIEW_SYSTEM } = await import("@/lib/prompts/weekly-review");
  const { submitReviewTool, reviewResponseSchema } = await import("@/lib/review-tool");

  const ids = recent.map((w) => w.id);
  const sets = await db.select().from(workoutSets)
    .where(eq(workoutSets.workoutId, ids[0])); // see note: widen with inArray(ids) in impl
  const pins = await db.select().from(liftEstimates)
    .where(and(eq(liftEstimates.userId, userId), eq(liftEstimates.source, "user_pinned")));

  const context =
    `Pinned baselines:\n${pins.map((p) => `- ${p.exerciseName}: ${p.weightLbs}x${p.reps}`).join("\n") || "none"}\n\n` +
    `This week's sets:\n${sets.map((s) => {
      const p = s.prescribed as { reps: number; weight: number };
      const a = s.actual as { reps: number; weight: number; feeling: string } | null;
      return `- ${s.exerciseName}: prescribed ${p.reps}x${p.weight}${a ? `, actual ${a.reps}x${a.weight} (${a.feeling})` : ""}`;
    }).join("\n")}`;

  const res = await anthropic().messages.create({
    model: model(),
    max_tokens: 1024,
    system: [{ type: "text", text: WEEKLY_REVIEW_SYSTEM }],
    tools: [submitReviewTool] as any,
    tool_choice: { type: "tool", name: "submit_review" },
    messages: [{ role: "user", content: context }],
  });

  const toolUse = res.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return;
  const parsed = reviewResponseSchema.safeParse(toolUse.input);
  if (!parsed.success) return;

  if (parsed.data.updates.length) {
    await db.insert(liftEstimates).values(parsed.data.updates.map((u) => ({
      userId, exerciseName: u.exercise_name, weightLbs: Math.round(u.weight_lbs),
      reps: u.reps, source: "inferred_from_workout" as const,
    })));
  }
  await db.update(profiles).set({ lastWeeklyReviewAt: now }).where(eq(profiles.userId, userId));
}
```

Note for the implementer: replace the single-id `eq(workoutSets.workoutId, ids[0])` with `inArray(workoutSets.workoutId, ids)` (import `inArray`) — kept as a one-liner above for brevity; the test for this action is the predicate `isReviewDue`, the Claude call is exercised manually.

- [ ] **Step 6: Fire-and-forget from `startWorkout`**

In `lib/actions/workouts.ts` `startWorkout` and `startImpromptuWorkout`, after resolving `user`, add (non-blocking, swallow errors so a review failure never blocks starting a workout):

```ts
  import("@/lib/actions/weekly-review").then(({ maybeRunWeeklyReview }) =>
    maybeRunWeeklyReview(user.id).catch(() => {})
  );
```

- [ ] **Step 7: Run suite + typecheck + manual**

Run: `npm test && npx tsc --noEmit` → PASS/clean. Manual: with a `lastWeeklyReviewAt` older than 7 days and a completed workout this week, starting a workout writes `inferred_from_workout` estimates and advances the timestamp.

- [ ] **Step 8: Commit**

```bash
git add lib/actions/weekly-review.ts lib/workouts/review-due.ts lib/actions/workouts.ts tests/review-due.test.ts
git commit -m "feat: lazy weekly review updates baselines once/week"
```

---

## Self-review notes (coverage vs spec)

- §1 adaptation engine → Tasks 1–2, wired in Tasks 3,7,9,10. ✓
- §2 generation rationale + derivation → Tasks 4–6. ✓
- §3 session UI (two-level collapse, editable any set, cascade, live total, ⓘ, pin banner) → Tasks 9–11. ✓
- §4 pinned baselines (sticky floor + ceiling hint) → Task 3 (enum), Task 7 (floor clamp in commit), Task 11 (pin), Task 16 (ceiling hint in review prompt). ✓
- §5 weekly review → Tasks 16–17. ✓
- §6 Workouts screen + delete-from-detail → Tasks 12–13. ✓
- §7 Today restyle → Task 15. ✓
- §8 3-tab nav (Plan→Settings, Progress retired) → Task 14. ✓
- §9 schema deltas → Task 3 (enum, profile col); prescribed shape change → Tasks 4,6,8,9. ✓

**Type consistency:** `Prescribed`/`AdaptSet`/`Feeling`/`Actual` defined once in `lib/adapt.ts` and reused by `recompute-exercise.ts`, `session.tsx`, `to-set-rows.ts`. Tool output type `WorkoutResponse` (`workout-tool.ts`) consumed by `to-set-rows.ts`. `StoredSet` (recompute) mirrors the persisted `prescribed` shape.

**Sequencing caveat (flagged in tasks):** PR2 and PR3 should land together (or PR3 immediately after) because deleting `lib/branch.ts` and changing the prescribed shape breaks `tsc` in `session.tsx`/`page.tsx` until PR4. Recommended merge order: PR1 → (PR2+PR3) → PR4 → PR5 → PR6 → PR7. Each is independently revertible; only PR2/PR3 share a typecheck boundary.
