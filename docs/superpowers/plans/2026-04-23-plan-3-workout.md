# Plan 3 — Daily Workout Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in user with an active plan taps "Start Workout" on `/today`, gets a Claude-generated workout (tool-use JSON), executes it one set at a time with red/yellow/green feedback, and the next set auto-adjusts via deterministic branch logic. On completion, the workout is marked `completed` and a summary is shown.

**Architecture:** Tool-use (not prose XML) for workout generation — one non-streaming `POST /api/workout/plan` that calls Claude with a single `submit_workout` tool and a strict JSON schema. The workout is persisted as one `workouts` row + N `workout_sets` rows pre-inserted with `prescribed` filled. The client walks sets in order; on commit, a server action writes `actual` to the current set and applies branch logic to override the next set's `prescribed` before showing it. Branch selection is a ~20-line pure function with full test coverage.

**Tech Stack:** Next.js 16 App Router · `@anthropic-ai/sdk` tool-use · Drizzle (transactional inserts) · shadcn (Button, Input already installed; add Dialog for first-workout modal)

---

## Prerequisites

- Plan 2 is merged to `main` (you're in a worktree branched from post-Plan-2 `main`)
- The test account has an active `plans` row. If not, run onboarding first.
- `ANTHROPIC_API_KEY` set in `.env.local` of the worktree

---

## File Structure

```
trainer/
├── app/
│   ├── today/
│   │   ├── page.tsx                        # Updated: render today's category + Start/Resume button
│   │   ├── start-workout-button.tsx        # Client: triggers startWorkout action
│   │   ├── first-workout-modal.tsx         # Client: optional lift-estimates intake
│   │   └── actions.ts                      # startWorkout server action
│   ├── workout/
│   │   └── [id]/
│   │       ├── page.tsx                    # Server: load workout + sets, gate by status
│   │       ├── session.tsx                 # Client: full in-progress UI
│   │       └── actions.ts                  # commitSet, completeWorkout, abandonWorkout
│   └── api/workout/plan/route.ts           # One-shot Claude tool-use endpoint
├── components/
│   ├── workout/
│   │   ├── set-card.tsx                    # Current set: prescribed, inputs, RYG buttons
│   │   ├── rest-timer.tsx                  # Countdown w/ Skip / +30s
│   │   └── summary.tsx                     # End-of-workout recap
│   └── ui/dialog.tsx                       # shadcn Dialog (added)
├── lib/
│   ├── branch.ts                           # Pure: applyBranch(prev actual, next branches) → prescribed
│   ├── workout-tool.ts                     # Tool schema + response validator (shared by endpoint + tests)
│   ├── prompts/workout-design.ts           # System prompt for workout generation
│   └── actions/workouts.ts                 # startWorkout, commitSet, completeWorkout
└── tests/
    ├── branch.test.ts                      # Branch-selection edge cases
    ├── workout-tool.test.ts                # Schema validator accepts/rejects fixtures
    └── workout-design-prompt.test.ts       # Prompt snapshot
```

**Why this split:**
- `app/today/` and `app/workout/[id]/` are separate routes — `today` gates entry; `workout/[id]` is the durable workout session you can refresh/resume.
- `lib/branch.ts` is deliberately pure and isolated so it's trivially testable.
- `lib/workout-tool.ts` defines the tool-use JSON schema once; the API route uses it as the `input_schema` for Claude AND as a zod validator on the response. Single source of truth.
- `lib/actions/workouts.ts` centralizes mutations. Route handler only handles Claude I/O.

---

## Task 1: Branch-selection algorithm + unit tests

**Files:** Create `lib/branch.ts`, `tests/branch.test.ts`.

- [ ] **Step 1: Write `tests/branch.test.ts` (TDD)**

```ts
import { describe, it, expect } from "vitest";
import { applyBranch } from "@/lib/branch";
import type { Prescribed, Actual } from "@/lib/branch";

const branches: Prescribed["branches"] = {
  under: { threshold_reps: 6, next_set: { reps: 8, weight: 175 } },
  on: { next_set: { reps: 8, weight: 185 } },
  over: { threshold_reps: 10, next_set: { reps: 8, weight: 195 } },
};

describe("applyBranch", () => {
  it("picks 'under' when reps are below threshold", () => {
    const actual: Actual = { reps: 5, weight: 185, feeling: "yellow" };
    expect(applyBranch(actual, branches)).toEqual({ reps: 8, weight: 175 });
  });

  it("picks 'over' when reps are above threshold", () => {
    const actual: Actual = { reps: 11, weight: 185, feeling: "yellow" };
    expect(applyBranch(actual, branches)).toEqual({ reps: 8, weight: 195 });
  });

  it("picks 'on' for reps inside the window", () => {
    const actual: Actual = { reps: 8, weight: 185, feeling: "yellow" };
    expect(applyBranch(actual, branches)).toEqual({ reps: 8, weight: 185 });
  });

  it("feeling=red shifts one notch down (on → under)", () => {
    const actual: Actual = { reps: 8, weight: 185, feeling: "red" };
    expect(applyBranch(actual, branches)).toEqual({ reps: 8, weight: 175 });
  });

  it("feeling=red shifts one notch down (over → on)", () => {
    const actual: Actual = { reps: 11, weight: 185, feeling: "red" };
    expect(applyBranch(actual, branches)).toEqual({ reps: 8, weight: 185 });
  });

  it("feeling=red on under stays at under (clamped)", () => {
    const actual: Actual = { reps: 5, weight: 185, feeling: "red" };
    expect(applyBranch(actual, branches)).toEqual({ reps: 8, weight: 175 });
  });

  it("feeling=green shifts one notch up (on → over)", () => {
    const actual: Actual = { reps: 8, weight: 185, feeling: "green" };
    expect(applyBranch(actual, branches)).toEqual({ reps: 8, weight: 195 });
  });

  it("feeling=green on over stays at over (clamped)", () => {
    const actual: Actual = { reps: 11, weight: 185, feeling: "green" };
    expect(applyBranch(actual, branches)).toEqual({ reps: 8, weight: 195 });
  });

  it("threshold is inclusive on 'under' (reps == threshold_reps is NOT under)", () => {
    const actual: Actual = { reps: 6, weight: 185, feeling: "yellow" };
    // 6 is NOT < 6 — stays on
    expect(applyBranch(actual, branches)).toEqual({ reps: 8, weight: 185 });
  });

  it("threshold is inclusive on 'over' (reps == threshold_reps is NOT over)", () => {
    const actual: Actual = { reps: 10, weight: 185, feeling: "yellow" };
    // 10 is NOT > 10 — stays on
    expect(applyBranch(actual, branches)).toEqual({ reps: 8, weight: 185 });
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- branch.test.ts
```

Expected: all tests fail with "Cannot find module '@/lib/branch'".

- [ ] **Step 3: Write `lib/branch.ts`**

```ts
export type Feeling = "red" | "yellow" | "green";

export type Prescribed = {
  reps: number;
  weight: number;
  branches: {
    under: { threshold_reps: number; next_set: { reps: number; weight: number } };
    on: { next_set: { reps: number; weight: number } };
    over: { threshold_reps: number; next_set: { reps: number; weight: number } };
  };
};

export type Actual = {
  reps: number;
  weight: number;
  feeling: Feeling;
};

type Notch = "under" | "on" | "over";

const order: Notch[] = ["under", "on", "over"];

function pickNotch(actualReps: number, branches: Prescribed["branches"]): Notch {
  if (actualReps < branches.under.threshold_reps) return "under";
  if (actualReps > branches.over.threshold_reps) return "over";
  return "on";
}

function shift(notch: Notch, feeling: Feeling): Notch {
  const idx = order.indexOf(notch);
  if (feeling === "red") return order[Math.max(0, idx - 1)];
  if (feeling === "green") return order[Math.min(order.length - 1, idx + 1)];
  return notch;
}

/**
 * Given the actual result of the current set and the branch structure,
 * return the prescribed reps+weight for the NEXT set.
 */
export function applyBranch(
  actual: Actual,
  branches: Prescribed["branches"],
): { reps: number; weight: number } {
  const notch = shift(pickNotch(actual.reps, branches), actual.feeling);
  return branches[notch].next_set;
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test -- branch.test.ts
```

Expected: 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/branch.ts tests/branch.test.ts
git commit -m "feat: add branch-selection algorithm + tests"
```

---

## Task 2: Workout tool-use schema + validator

**Files:** Create `lib/workout-tool.ts`, `tests/workout-tool.test.ts`.

- [ ] **Step 1: Write `lib/workout-tool.ts`**

```ts
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
```

- [ ] **Step 2: Write `tests/workout-tool.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { workoutResponseSchema, submitWorkoutTool } from "@/lib/workout-tool";

const valid = {
  exercises: [
    {
      name: "bench_press",
      sets: [
        {
          set_number: 1,
          prescribed: { reps: 8, weight: 185 },
          branches: {
            under: { threshold_reps: 6, next_set: { reps: 8, weight: 175 } },
            on: { next_set: { reps: 8, weight: 185 } },
            over: { threshold_reps: 10, next_set: { reps: 8, weight: 195 } },
          },
        },
      ],
    },
  ],
};

describe("workoutResponseSchema", () => {
  it("accepts a valid response", () => {
    expect(workoutResponseSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty exercises", () => {
    expect(workoutResponseSchema.safeParse({ exercises: [] }).success).toBe(false);
  });

  it("rejects non-snake_case exercise names", () => {
    const bad = structuredClone(valid);
    bad.exercises[0].name = "Bench Press";
    expect(workoutResponseSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects missing branches", () => {
    const bad = { exercises: [{ name: "bench_press", sets: [{ set_number: 1, prescribed: { reps: 8, weight: 185 } }] }] };
    expect(workoutResponseSchema.safeParse(bad).success).toBe(false);
  });
});

describe("submitWorkoutTool", () => {
  it("is named correctly", () => {
    expect(submitWorkoutTool.name).toBe("submit_workout");
  });

  it("has a valid JSON Schema shape", () => {
    expect(submitWorkoutTool.input_schema.type).toBe("object");
    expect(submitWorkoutTool.input_schema.required).toContain("exercises");
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npm test -- workout-tool.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 4: Commit**

```bash
git add lib/workout-tool.ts tests/workout-tool.test.ts
git commit -m "feat: add workout tool-use schema + zod validator"
```

---

## Task 3: Workout-design system prompt

**Files:** Create `lib/prompts/workout-design.ts`, `tests/workout-design-prompt.test.ts`.

- [ ] **Step 1: Write `lib/prompts/workout-design.ts`**

```ts
/**
 * System prompt for daily workout generation. Cached via cache_control: ephemeral.
 * Keep stable — drift invalidates the cache.
 */
export const WORKOUT_DESIGN_SYSTEM = `You are the user's strength coach designing today's workout. You will be given:

- Today's category (e.g. "push") and the ordered list of exercises for today
- The user's recent working weights for these exercises (last ~5 sessions if available)
- The user's self-reported max lifts ("lift estimates") if any

Your job: generate the full workout as a single call to the \`submit_workout\` tool. Do NOT write any prose — just the tool call.

**Set design rules:**
- 3 to 5 sets per exercise, appropriate to the exercise (compounds get 4–5, accessories 3)
- First set is a working set at a weight the user can hit the target reps cleanly
- Target reps: 5–8 for main compounds, 8–12 for secondary compounds, 10–15 for accessories
- If you have prior data, nudge the weight up ~2.5–5 lbs (or 5% on lower-body compounds) if last session hit the "over" branch consistently
- If no prior data and no lift estimate, start conservatively — the user can adjust mid-set

**Branch rules (these feed a deterministic runtime algorithm):**
- \`under.threshold_reps\` = prescribed_reps - 2 (e.g. prescribed 8 → under triggers at < 6)
- \`over.threshold_reps\` = prescribed_reps + 2 (e.g. prescribed 8 → over triggers at > 10)
- \`under.next_set\` = same reps, weight dropped ~5–10%
- \`on.next_set\` = same reps, same weight (stay the course)
- \`over.next_set\` = same reps, weight up ~5%
- For the FINAL set of an exercise, branches still apply but the "next_set" values are informational only (won't actually be shown) — use the same rules for consistency

**Naming:**
- Exercise \`name\` is snake_case lowercase, matching the names in the user's plan exactly

Never invent exercises not in today's plan. Never add warm-up sets as separate entries (the user warms up off-book). Never call \`submit_workout\` more than once.`;
```

- [ ] **Step 2: Write `tests/workout-design-prompt.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { WORKOUT_DESIGN_SYSTEM } from "@/lib/prompts/workout-design";

describe("WORKOUT_DESIGN_SYSTEM prompt", () => {
  it("mentions the submit_workout tool", () => {
    expect(WORKOUT_DESIGN_SYSTEM).toContain("submit_workout");
  });

  it("specifies branch threshold rules", () => {
    expect(WORKOUT_DESIGN_SYSTEM).toContain("threshold_reps");
  });

  it("enforces snake_case naming", () => {
    expect(WORKOUT_DESIGN_SYSTEM).toMatch(/snake_case/i);
  });

  it("is stable length for cache (1k–3k chars)", () => {
    expect(WORKOUT_DESIGN_SYSTEM.length).toBeGreaterThan(1000);
    expect(WORKOUT_DESIGN_SYSTEM.length).toBeLessThan(3000);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npm test -- workout-design-prompt.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add lib/prompts/workout-design.ts tests/workout-design-prompt.test.ts
git commit -m "feat: workout-design system prompt with snapshot tests"
```

---

## Task 4: Workout generation endpoint

**Files:** Create `app/api/workout/plan/route.ts`.

- [ ] **Step 1: Write the route**

```ts
import { createClient } from "@/lib/supabase/server";
import { anthropic, model } from "@/lib/anthropic";
import { WORKOUT_DESIGN_SYSTEM } from "@/lib/prompts/workout-design";
import { submitWorkoutTool, workoutResponseSchema } from "@/lib/workout-tool";
import { db } from "@/lib/db";
import { plans, workoutSets, workouts, liftEstimates } from "@/lib/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  dayKey: string;         // e.g. "push"
  exercises: string[];    // snake_case names
};

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const body = (await req.json()) as Body;

  // Pull recent sets for these exercises to give Claude history.
  const history = await db
    .select({
      exerciseName: workoutSets.exerciseName,
      prescribed: workoutSets.prescribed,
      actual: workoutSets.actual,
      completedAt: workoutSets.completedAt,
    })
    .from(workoutSets)
    .innerJoin(workouts, eq(workouts.id, workoutSets.workoutId))
    .where(
      and(
        eq(workouts.userId, user.id),
        inArray(workoutSets.exerciseName, body.exercises),
      ),
    )
    .orderBy(desc(workoutSets.completedAt))
    .limit(40);

  // Lift estimates for these exercises (latest per exercise).
  const estimates = await db
    .select()
    .from(liftEstimates)
    .where(
      and(
        eq(liftEstimates.userId, user.id),
        inArray(liftEstimates.exerciseName, body.exercises),
      ),
    )
    .orderBy(desc(liftEstimates.recordedAt));

  const userContext =
    `Today is ${body.dayKey} day. Exercises in order: ${body.exercises.join(", ")}.\n\n` +
    (estimates.length
      ? `Self-reported maxes:\n${estimates
          .map((e) => `- ${e.exerciseName}: ${e.weightLbs} lbs x ${e.reps} reps`)
          .join("\n")}\n\n`
      : "No self-reported maxes.\n\n") +
    (history.length
      ? `Recent sets (newest first):\n${history
          .slice(0, 20)
          .map((h) => {
            const p = h.prescribed as { reps: number; weight: number };
            const a = h.actual as { reps: number; weight: number; feeling: string } | null;
            return `- ${h.exerciseName}: prescribed ${p.reps}x${p.weight}${a ? `, actual ${a.reps}x${a.weight} (${a.feeling})` : ", (skipped)"}`;
          })
          .join("\n")}`
      : "No prior sessions for these exercises.");

  try {
    const res = await anthropic().messages.create({
      model: model(),
      max_tokens: 4096,
      system: [{ type: "text", text: WORKOUT_DESIGN_SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: [submitWorkoutTool],
      tool_choice: { type: "tool", name: "submit_workout" },
      messages: [{ role: "user", content: userContext }],
    });

    const toolUse = res.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return new Response("no tool call in response", { status: 502 });
    }

    const parsed = workoutResponseSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "tool output failed schema", issues: parsed.error.issues }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }

    return Response.json(parsed.data);
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: compiles. `/api/workout/plan` appears in the route list.

- [ ] **Step 3: Commit**

```bash
git add app/api/workout/plan/
git commit -m "feat: /api/workout/plan tool-use endpoint"
```

---

## Task 5: startWorkout server action

**Files:** Create `lib/actions/workouts.ts`, `app/today/actions.ts`.

- [ ] **Step 1: Write `lib/actions/workouts.ts` (startWorkout only — commit/complete come in T7)**

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { plans, workouts, workoutSets } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { workoutResponseSchema } from "@/lib/workout-tool";

type PlanStructure = {
  split: string;
  days: Array<{
    day: string;
    category: string;
    exercises: Array<{ name: string; order: number; notes?: string }>;
  }>;
};

const weekdayForToday = (): string => {
  const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return names[new Date().getDay()];
};

export async function startWorkout(): Promise<
  | { workoutId: string }
  | { restDay: true; category: string | null }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");

  // Resume an in_progress workout if one exists
  const [inProgress] = await db
    .select()
    .from(workouts)
    .where(and(eq(workouts.userId, user.id), eq(workouts.status, "in_progress")))
    .limit(1);
  if (inProgress) return { workoutId: inProgress.id };

  const [activePlan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.userId, user.id), eq(plans.isActive, true)))
    .limit(1);
  if (!activePlan) throw new Error("no active plan");

  const structure = activePlan.structure as PlanStructure;
  const today = weekdayForToday();
  const planDay = structure.days.find((d) => d.day === today);
  if (!planDay) return { restDay: true, category: null };

  const exerciseNames = planDay.exercises
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((e) => e.name);

  // Call the workout-generation endpoint from this server action
  // by hitting it via relative URL (Node fetch is fine — same process, same auth cookie is NOT forwarded
  // from a server action, so instead we import the handler's logic inline would be cleaner, but a simpler
  // approach: call Anthropic directly here). Easier path: just re-run the same logic as route.ts here.
  const generated = await generateWorkout({ userId: user.id, dayKey: planDay.category, exercises: exerciseNames });

  // Transaction: insert workout row + all prescribed set rows
  const [workoutRow] = await db
    .insert(workouts)
    .values({
      userId: user.id,
      planId: activePlan.id,
      dayKey: planDay.category,
      status: "in_progress",
    } as typeof workouts.$inferInsert)
    .returning({ id: workouts.id });

  const setRows = generated.exercises.flatMap((ex) =>
    ex.sets.map((s) => ({
      workoutId: workoutRow.id,
      exerciseName: ex.name,
      setNumber: s.set_number,
      prescribed: { reps: s.prescribed.reps, weight: s.prescribed.weight, branches: s.branches },
    })),
  );
  await db.insert(workoutSets).values(setRows as (typeof workoutSets.$inferInsert)[]);

  return { workoutId: workoutRow.id };
}

// Local helper — calls Anthropic directly. We could DRY this with route.ts later,
// but sharing business logic across a route handler and a server action is annoying
// (import paths differ for "use server"), so we accept the duplication for now.
async function generateWorkout(params: {
  userId: string;
  dayKey: string;
  exercises: string[];
}) {
  const { anthropic, model } = await import("@/lib/anthropic");
  const { WORKOUT_DESIGN_SYSTEM } = await import("@/lib/prompts/workout-design");
  const { submitWorkoutTool, workoutResponseSchema } = await import("@/lib/workout-tool");
  const { liftEstimates, workouts: wt, workoutSets: ws } = await import("@/lib/db/schema");
  const { and, desc, eq, inArray } = await import("drizzle-orm");

  const history = await db
    .select({
      exerciseName: ws.exerciseName,
      prescribed: ws.prescribed,
      actual: ws.actual,
      completedAt: ws.completedAt,
    })
    .from(ws)
    .innerJoin(wt, eq(wt.id, ws.workoutId))
    .where(and(eq(wt.userId, params.userId), inArray(ws.exerciseName, params.exercises)))
    .orderBy(desc(ws.completedAt))
    .limit(40);

  const estimates = await db
    .select()
    .from(liftEstimates)
    .where(and(eq(liftEstimates.userId, params.userId), inArray(liftEstimates.exerciseName, params.exercises)))
    .orderBy(desc(liftEstimates.recordedAt));

  const userContext =
    `Today is ${params.dayKey} day. Exercises in order: ${params.exercises.join(", ")}.\n\n` +
    (estimates.length
      ? `Self-reported maxes:\n${estimates.map((e) => `- ${e.exerciseName}: ${e.weightLbs} lbs x ${e.reps} reps`).join("\n")}\n\n`
      : "No self-reported maxes.\n\n") +
    (history.length
      ? `Recent sets (newest first):\n${history.slice(0, 20).map((h) => {
          const p = h.prescribed as { reps: number; weight: number };
          const a = h.actual as { reps: number; weight: number; feeling: string } | null;
          return `- ${h.exerciseName}: prescribed ${p.reps}x${p.weight}${a ? `, actual ${a.reps}x${a.weight} (${a.feeling})` : ", (skipped)"}`;
        }).join("\n")}`
      : "No prior sessions for these exercises.");

  const res = await anthropic().messages.create({
    model: model(),
    max_tokens: 4096,
    system: [{ type: "text", text: WORKOUT_DESIGN_SYSTEM, cache_control: { type: "ephemeral" } }],
    tools: [submitWorkoutTool],
    tool_choice: { type: "tool", name: "submit_workout" },
    messages: [{ role: "user", content: userContext }],
  });

  const toolUse = res.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") throw new Error("claude: no tool call");
  const parsed = workoutResponseSchema.safeParse(toolUse.input);
  if (!parsed.success) throw new Error(`claude: schema failure: ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}
```

> **Note on duplication:** the generation logic is intentionally duplicated in the route handler and the server action. The route handler exists for a future client-side "regenerate" button; the server action inlines for atomic start-workout semantics. Extract later if both paths stick around.

- [ ] **Step 2: Write `app/today/actions.ts`**

```ts
"use server";

import { startWorkout as startWorkoutImpl } from "@/lib/actions/workouts";

// Forwarding wrapper — Turbopack requires async functions, not bare re-exports.
export async function startWorkout() {
  return startWorkoutImpl();
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: compiles.

- [ ] **Step 4: Commit**

```bash
git add lib/actions/workouts.ts app/today/actions.ts
git commit -m "feat: startWorkout server action (inserts workout + sets)"
```

---

## Task 6: Today page — Start Workout button + resume

**Files:** Modify `app/today/page.tsx`. Create `app/today/start-workout-button.tsx`.

- [ ] **Step 1: Write `app/today/start-workout-button.tsx`**

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { startWorkout } from "./actions";

export function StartWorkoutButton() {
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <Button
      size="lg"
      className="w-full"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await startWorkout();
          if ("workoutId" in result) {
            router.push(`/workout/${result.workoutId}`);
          } else {
            // rest day — page will re-render on next navigation; just refresh
            router.refresh();
          }
        })
      }
    >
      {pending ? "Generating your workout…" : "Start Workout"}
    </Button>
  );
}
```

- [ ] **Step 2: Rewrite `app/today/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { plans, workouts } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { StartWorkoutButton } from "./start-workout-button";

type PlanStructure = {
  split: string;
  days: Array<{
    day: string;
    category: string;
    exercises: Array<{ name: string; order: number; notes?: string }>;
  }>;
};

const weekdayForToday = (): string => {
  const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return names[new Date().getDay()];
};

export default async function TodayPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [active] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.userId, user.id), eq(plans.isActive, true)))
    .limit(1);
  if (!active) redirect("/onboarding");

  // If already mid-workout, bounce straight to the session
  const [inProgress] = await db
    .select({ id: workouts.id })
    .from(workouts)
    .where(and(eq(workouts.userId, user.id), eq(workouts.status, "in_progress")))
    .limit(1);
  if (inProgress) redirect(`/workout/${inProgress.id}`);

  const structure = active.structure as PlanStructure;
  const today = weekdayForToday();
  const planDay = structure.days.find((d) => d.day === today);

  return (
    <main className="px-6 py-8 max-w-md mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Today</h1>
        <p className="text-sm text-muted-foreground capitalize">{today}</p>
      </div>

      {planDay ? (
        <section className="space-y-4">
          <div className="rounded-lg border p-4 bg-muted/30">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              {planDay.category}
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {planDay.exercises
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((e) => (
                  <li key={e.name}>{e.name.replace(/_/g, " ")}</li>
                ))}
            </ul>
          </div>
          <StartWorkoutButton />
        </section>
      ) : (
        <section className="rounded-lg border p-4 bg-muted/30">
          <p className="text-sm font-medium">Rest day.</p>
          <p className="text-muted-foreground text-sm mt-1">
            No exercises planned for {today}. Eat, sleep, grow.
          </p>
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add app/today/
git commit -m "feat: /today renders category preview + Start Workout / resume"
```

---

## Task 7: commitSet + completeWorkout server actions

**Files:** Append to `lib/actions/workouts.ts`. Create `app/workout/[id]/actions.ts`.

- [ ] **Step 1: Append to `lib/actions/workouts.ts`**

```ts
// (keep existing imports; add these)
import { applyBranch, type Actual } from "@/lib/branch";
import { asc } from "drizzle-orm";

export type CommitSetInput = {
  workoutId: string;
  setId: string;
  actual: Actual;
};

export async function commitSet(input: CommitSetInput): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");

  // Ownership check + load the set we're committing
  const [row] = await db
    .select({
      setId: workoutSets.id,
      workoutUserId: workouts.userId,
      exerciseName: workoutSets.exerciseName,
      setNumber: workoutSets.setNumber,
      prescribed: workoutSets.prescribed,
    })
    .from(workoutSets)
    .innerJoin(workouts, eq(workouts.id, workoutSets.workoutId))
    .where(and(eq(workoutSets.id, input.setId), eq(workoutSets.workoutId, input.workoutId)))
    .limit(1);
  if (!row || row.workoutUserId !== user.id) throw new Error("set not found");

  // Write actual + completed_at
  await db
    .update(workoutSets)
    .set({ actual: input.actual, completedAt: new Date() })
    .where(eq(workoutSets.id, input.setId));

  // Apply branch logic to the NEXT set for this exercise (if one exists and isn't already completed).
  const nextSets = await db
    .select()
    .from(workoutSets)
    .where(and(eq(workoutSets.workoutId, input.workoutId), eq(workoutSets.exerciseName, row.exerciseName)))
    .orderBy(asc(workoutSets.setNumber));
  const next = nextSets.find((s) => s.setNumber > row.setNumber && s.completedAt === null);
  if (next) {
    const prescribed = row.prescribed as { reps: number; weight: number; branches: Parameters<typeof applyBranch>[1] };
    const adjusted = applyBranch(input.actual, prescribed.branches);
    const nextPrescribed = next.prescribed as { reps: number; weight: number; branches: unknown };
    await db
      .update(workoutSets)
      .set({
        prescribed: {
          reps: adjusted.reps,
          weight: adjusted.weight,
          branches: nextPrescribed.branches, // preserve original branches — they're still valid for THIS set's outcome
        },
      })
      .where(eq(workoutSets.id, next.id));
  }
}

export async function completeWorkout(workoutId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");

  await db
    .update(workouts)
    .set({ status: "completed", completedAt: new Date() })
    .where(and(eq(workouts.id, workoutId), eq(workouts.userId, user.id)));
}

export async function abandonWorkout(workoutId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");

  await db
    .update(workouts)
    .set({ status: "abandoned", completedAt: new Date() })
    .where(and(eq(workouts.id, workoutId), eq(workouts.userId, user.id)));
}
```

- [ ] **Step 2: Write `app/workout/[id]/actions.ts`**

```ts
"use server";

import {
  commitSet as commitSetImpl,
  completeWorkout as completeWorkoutImpl,
  abandonWorkout as abandonWorkoutImpl,
  type CommitSetInput,
} from "@/lib/actions/workouts";

export async function commitSet(input: CommitSetInput) {
  return commitSetImpl(input);
}
export async function completeWorkout(workoutId: string) {
  return completeWorkoutImpl(workoutId);
}
export async function abandonWorkout(workoutId: string) {
  return abandonWorkoutImpl(workoutId);
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add lib/actions/workouts.ts app/workout/
git commit -m "feat: commitSet (with branch application) + completeWorkout actions"
```

---

## Task 8: Set card + rest timer components

**Files:** Create `components/workout/set-card.tsx`, `components/workout/rest-timer.tsx`.

- [ ] **Step 1: Write `components/workout/rest-timer.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export function RestTimer({
  seconds,
  onDone,
}: {
  seconds: number;
  onDone: () => void;
}) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (remaining <= 0) {
      onDone();
      return;
    }
    const t = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(t);
  }, [remaining, onDone]);

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;

  return (
    <div className="flex flex-col items-center gap-4 p-6 rounded-lg border bg-muted/30">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Rest</p>
      <p className="text-5xl font-mono tabular-nums">
        {mins}:{secs.toString().padStart(2, "0")}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => setRemaining((r) => r + 30)}>
          +30s
        </Button>
        <Button variant="outline" size="sm" onClick={onDone}>
          Skip
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `components/workout/set-card.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Feeling } from "@/lib/branch";

export type SetCardProps = {
  exerciseName: string;
  setNumber: number;
  totalSets: number;
  prescribed: { reps: number; weight: number };
  onCommit: (actual: { reps: number; weight: number; feeling: Feeling }) => void | Promise<void>;
};

export function SetCard({ exerciseName, setNumber, totalSets, prescribed, onCommit }: SetCardProps) {
  const [reps, setReps] = useState(prescribed.reps);
  const [weight, setWeight] = useState(prescribed.weight);
  const [submitting, setSubmitting] = useState<Feeling | null>(null);

  const commit = async (feeling: Feeling) => {
    setSubmitting(feeling);
    try {
      await onCommit({ reps, weight, feeling });
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Set {setNumber} of {totalSets}
        </p>
        <h2 className="text-2xl font-bold capitalize">{exerciseName.replace(/_/g, " ")}</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Prescribed: {prescribed.reps} reps @ {prescribed.weight} lbs
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="reps">Reps</Label>
          <Input
            id="reps"
            type="number"
            min={0}
            max={99}
            value={reps}
            onChange={(e) => setReps(Number(e.target.value))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="weight">Weight (lbs)</Label>
          <Input
            id="weight"
            type="number"
            min={0}
            step={2.5}
            value={weight}
            onChange={(e) => setWeight(Number(e.target.value))}
          />
        </div>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
          How did that feel?
        </p>
        <div className="grid grid-cols-3 gap-2">
          <Button
            type="button"
            variant={submitting === "red" ? "secondary" : "outline"}
            disabled={submitting !== null}
            className="h-20 text-2xl"
            onClick={() => commit("red")}
            aria-label="Hard"
          >
            🔴
          </Button>
          <Button
            type="button"
            variant={submitting === "yellow" ? "secondary" : "outline"}
            disabled={submitting !== null}
            className="h-20 text-2xl"
            onClick={() => commit("yellow")}
            aria-label="Medium"
          >
            🟡
          </Button>
          <Button
            type="button"
            variant={submitting === "green" ? "secondary" : "outline"}
            disabled={submitting !== null}
            className="h-20 text-2xl"
            onClick={() => commit("green")}
            aria-label="Easy"
          >
            🟢
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/workout/
git commit -m "feat: SetCard and RestTimer components"
```

---

## Task 9: Workout session page + client

**Files:** Create `app/workout/[id]/page.tsx`, `app/workout/[id]/session.tsx`, `components/workout/summary.tsx`.

- [ ] **Step 1: Write `components/workout/summary.tsx`**

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export type SummarySet = {
  exerciseName: string;
  setNumber: number;
  prescribed: { reps: number; weight: number };
  actual: { reps: number; weight: number; feeling: string } | null;
};

export function Summary({ sets }: { sets: SummarySet[] }) {
  const router = useRouter();
  const grouped = new Map<string, SummarySet[]>();
  for (const s of sets) {
    if (!grouped.has(s.exerciseName)) grouped.set(s.exerciseName, []);
    grouped.get(s.exerciseName)!.push(s);
  }

  return (
    <main className="px-6 py-8 max-w-md mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Workout complete 💪</h1>
        <p className="text-muted-foreground text-sm mt-1">Here's what you did.</p>
      </div>

      <div className="space-y-4">
        {[...grouped.entries()].map(([ex, rows]) => (
          <section key={ex} className="rounded-lg border p-4 bg-muted/30">
            <h2 className="font-semibold capitalize">{ex.replace(/_/g, " ")}</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {rows.map((r) => (
                <li key={r.setNumber} className="flex justify-between">
                  <span>Set {r.setNumber}</span>
                  <span>
                    {r.actual
                      ? `${r.actual.reps} × ${r.actual.weight} lbs (${r.actual.feeling})`
                      : "skipped"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <Button className="w-full" size="lg" onClick={() => router.push("/today")}>
        Done
      </Button>
    </main>
  );
}
```

- [ ] **Step 2: Write `app/workout/[id]/session.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SetCard } from "@/components/workout/set-card";
import { RestTimer } from "@/components/workout/rest-timer";
import { Button } from "@/components/ui/button";
import { commitSet, completeWorkout, abandonWorkout } from "./actions";
import type { Feeling } from "@/lib/branch";

export type SessionSet = {
  id: string;
  exerciseName: string;
  setNumber: number;
  prescribed: { reps: number; weight: number };
  completed: boolean;
  actual: { reps: number; weight: number; feeling: Feeling } | null;
};

export function Session({
  workoutId,
  initialSets,
  restSeconds,
}: {
  workoutId: string;
  initialSets: SessionSet[];
  restSeconds: number;
}) {
  const router = useRouter();
  const [sets, setSets] = useState(initialSets);
  const [resting, setResting] = useState(false);
  const [pending, startTransition] = useTransition();

  const currentIdx = sets.findIndex((s) => !s.completed);
  const current = currentIdx === -1 ? null : sets[currentIdx];
  const perExerciseTotal = current
    ? sets.filter((s) => s.exerciseName === current.exerciseName).length
    : 0;

  async function handleCommit(actual: { reps: number; weight: number; feeling: Feeling }) {
    if (!current) return;
    await commitSet({ workoutId, setId: current.id, actual });

    // Re-fetch next set's prescribed from server by doing a minimal "refresh".
    // We update local state optimistically: mark current as complete, and for the NEXT set
    // in the same exercise, we don't know the adjusted prescription without round-trip.
    // Simplest: router.refresh() to reload server-computed state.
    setSets((prev) =>
      prev.map((s) => (s.id === current.id ? { ...s, completed: true, actual } : s)),
    );
    setResting(true);
    startTransition(() => router.refresh());
  }

  async function handleComplete() {
    await completeWorkout(workoutId);
    router.refresh();
  }

  async function handleAbandon() {
    if (!confirm("Abandon this workout? Your progress so far is kept.")) return;
    await abandonWorkout(workoutId);
    router.push("/today");
  }

  // All sets done — complete the workout automatically (but via explicit user tap to allow "I'm done" moments)
  if (current === null) {
    return (
      <main className="px-6 py-8 max-w-md mx-auto space-y-6">
        <h1 className="text-2xl font-bold">All sets logged 💪</h1>
        <p className="text-muted-foreground text-sm">Tap Finish to save your workout.</p>
        <Button className="w-full" size="lg" onClick={handleComplete} disabled={pending}>
          {pending ? "Saving…" : "Finish"}
        </Button>
      </main>
    );
  }

  return (
    <main className="px-6 py-8 max-w-md mx-auto space-y-6">
      {resting ? (
        <RestTimer seconds={restSeconds} onDone={() => setResting(false)} />
      ) : (
        <SetCard
          exerciseName={current.exerciseName}
          setNumber={current.setNumber}
          totalSets={perExerciseTotal}
          prescribed={current.prescribed}
          onCommit={handleCommit}
        />
      )}

      <div className="pt-4 border-t">
        <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={handleAbandon}>
          Abandon workout
        </Button>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Write `app/workout/[id]/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { workouts, workoutSets, profiles } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { Session, type SessionSet } from "./session";
import { Summary } from "@/components/workout/summary";

export default async function WorkoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [workout] = await db
    .select()
    .from(workouts)
    .where(and(eq(workouts.id, id), eq(workouts.userId, user.id)))
    .limit(1);
  if (!workout) redirect("/today");

  const rows = await db
    .select()
    .from(workoutSets)
    .where(eq(workoutSets.workoutId, id))
    .orderBy(asc(workoutSets.exerciseName), asc(workoutSets.setNumber));

  if (workout.status !== "in_progress") {
    const summary = rows.map((r) => ({
      exerciseName: r.exerciseName,
      setNumber: r.setNumber,
      prescribed: r.prescribed as { reps: number; weight: number },
      actual: r.actual as { reps: number; weight: number; feeling: string } | null,
    }));
    return <Summary sets={summary} />;
  }

  const sets: SessionSet[] = rows.map((r) => {
    const p = r.prescribed as { reps: number; weight: number };
    return {
      id: r.id,
      exerciseName: r.exerciseName,
      setNumber: r.setNumber,
      prescribed: { reps: p.reps, weight: p.weight },
      completed: r.completedAt !== null,
      actual: r.actual as SessionSet["actual"],
    };
  });

  const [profile] = await db.select({ rest: profiles.restTimerSeconds }).from(profiles).where(eq(profiles.userId, user.id)).limit(1);
  const restSeconds = profile?.rest ?? 75;

  return <Session workoutId={id} initialSets={sets} restSeconds={restSeconds} />;
}
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add app/workout/ components/workout/summary.tsx
git commit -m "feat: workout session page + summary"
```

---

## Task 10: Lift estimates intake (first-workout modal)

**Skip for MVP — defer to a later plan.** The first workout will just run without baseline data and Claude will start conservatively. Document here so future agents don't forget it exists in the spec:

- Spec § 6.6 describes a modal before the first Start Workout that optionally records lift estimates (bench, squat, deadlift, OHP, row).
- Schema already supports this (`lift_estimates` table; `source: "user"`).
- Add a simple pre-workout modal and server action in a future plan (probably Plan 5 polish) or inline into Plan 3 if dogfooding reveals Claude's cold-start numbers are off.

No code for this task.

---

## Task 11: Manual verification

- [ ] **Step 1: Start dev server in the worktree**

```bash
cd /Users/brandonstiles/Desktop/my-apps/trainer/.worktrees/plan-3-workout
npm run dev
```

- [ ] **Step 2: Open /today**

Expected: you see today's category (or "Rest day.") + a Start Workout button (if training day).

If today isn't a training day in your plan and you want to test anyway, temporarily edit your plan's `days[].day` in Supabase to match today.

- [ ] **Step 3: Tap Start Workout**

Expected: button shows "Generating your workout…" for a few seconds, then navigates to `/workout/<uuid>`.

- [ ] **Step 4: Execute all sets**

For each set: enter actual reps (or leave defaulted), tap 🔴/🟡/🟢. Rest timer counts down; tap Skip to move on.

Expected: each new set card reflects branch-adjusted numbers based on the previous set's outcome.

- [ ] **Step 5: Finish the workout**

After the last set: "All sets logged 💪" → Finish. Redirects to `/workout/<uuid>` in summary mode showing each exercise's results.

- [ ] **Step 6: Verify DB**

Supabase → Table Editor:
- `workouts`: row with `status = 'completed'`, `completed_at` set
- `workout_sets`: N rows, all have `actual` populated with `{reps, weight, feeling}` and `completed_at` set

- [ ] **Step 7: Verify /today resume behavior**

Start another workout but don't finish it. Navigate away to `/today`. Expected: `/today` should redirect back to `/workout/<id>`.

- [ ] **Step 8: Tag**

```bash
git tag plan-3-complete
git push origin plan-3-complete
```

---

## Self-Review

Coverage audit against the design spec:

- **§ 2.2 Daily workout** — Start Workout T6, workout generation T4–T5, in-progress UI T8–T9, red/yellow/green commit T8, branch application T1 + T7, rest timer T8, summary T9. ✓
- **§ 5.2 Workout generation** — Tool-use T2, prompt T3, endpoint T4, also inlined in server action T5. ✓
- **§ 5.4 Branch algorithm** — T1 with 10 tests including threshold boundaries + feeling modifier. ✓
- **§ 6.6 First-workout modal** — **Deferred** to a later plan (documented in T10). This is the only deliberate gap from MVP.
- **§ 7 Testing** — Unit tests for branch algo + tool-use schema + prompt (3 test files). Integration test against real DB not included; the manual verification (T11) exercises end-to-end instead.
- **§ 8 Error handling** — Claude timeouts return 500/502 from the endpoint and throw from the server action; surfaced to the user as the transition error. `localStorage` resilience for network drops not yet implemented — noted for future polish.

No placeholders found. Type reuse: `Actual` and `Feeling` from `@/lib/branch` are imported in `set-card.tsx`, `session.tsx`, `lib/actions/workouts.ts`. `WorkoutResponse` / `workoutResponseSchema` shared between route and server action.

Known deviations from spec:
- Workout generation duplicated between `app/api/workout/plan/route.ts` and `lib/actions/workouts.ts`. The route exists for a future "regenerate this workout" button; the server action inlines so `startWorkout` is one atomic call. Acceptable small duplication; DRY later if the regenerate button ships.
- No `localStorage` fallback for set writes during network drops (spec § 8). MVP relies on the dev-server/gym-wifi being OK. Add if dogfooding hits this.
- First-workout modal for lift estimates deferred (see Task 10).

---

## Execution Handoff

Plan 3 complete. Ready to execute.

**Demo-able end state:** Sign in → /today shows today's exercises → Start Workout → execute N sets with red/yellow/green feedback + rest timer → Finish → see summary → `/today` empty/rest-day for the rest of the day.

**Next plan after this ships:** Plan 4 — Progress Photos & Timeline.
