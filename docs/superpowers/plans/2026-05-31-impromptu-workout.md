# Impromptu Workout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user start a workout from any of their plan's days via an inline "Choose an impromptu workout" box on `/today`, on both rest and training days.

**Architecture:** Extract `startWorkout`'s generate-and-insert block into a shared private `createWorkout` helper, add a pure `findPlanDay` lookup, and add a `startImpromptuWorkout(sourceDay)` server action that reuses both. A collapsible `ImpromptuBox` client component on `/today` lists the plan's days and routes into the existing `/workout/[id]` session on pick.

**Tech Stack:** Next.js (App Router, server components + server actions, `useTransition`), Drizzle ORM, Supabase auth, Anthropic SDK (existing `generateWorkout`), Vitest, Tailwind/shadcn UI.

**Spec:** `docs/superpowers/specs/2026-05-31-impromptu-workout-design.md`

---

## File Structure

- `lib/workouts/find-plan-day.ts` — **new.** Pure lookup: find a plan day by its `day` key. No I/O.
- `tests/find-plan-day.test.ts` — **new.** Unit tests for the lookup.
- `lib/actions/workouts.ts` — **modify.** Add private `createWorkout`; rewrite `startWorkout` to delegate to it (and use `findPlanDay`); add `startImpromptuWorkout`.
- `app/today/actions.ts` — **modify.** Add a `"use server"` forwarder for `startImpromptuWorkout`.
- `app/today/impromptu-box.tsx` — **new.** Collapsible client box listing plan days; starts the chosen one.
- `app/today/page.tsx` — **modify.** Render `<ImpromptuBox days={structure.days} />`.

---

## Task 1: Pure `findPlanDay` helper

**Files:**
- Create: `lib/workouts/find-plan-day.ts`
- Test: `tests/find-plan-day.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/find-plan-day.test.ts
import { describe, it, expect } from "vitest";
import { findPlanDay } from "@/lib/workouts/find-plan-day";

const structure = {
  split: "ppl",
  days: [
    { day: "monday", category: "push", exercises: [{ name: "bench_press", order: 1 }] },
    { day: "wednesday", category: "pull", exercises: [{ name: "deadlift", order: 1 }] },
  ],
};

describe("findPlanDay", () => {
  it("returns the matching day", () => {
    expect(findPlanDay(structure, "wednesday")?.category).toBe("pull");
  });

  it("returns null when the day is absent", () => {
    expect(findPlanDay(structure, "sunday")).toBeNull();
  });

  it("ignores extra structure fields and returns the full day object", () => {
    const day = findPlanDay(structure, "monday");
    expect(day).toEqual({
      day: "monday",
      category: "push",
      exercises: [{ name: "bench_press", order: 1 }],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/find-plan-day.test.ts`
Expected: FAIL — cannot find module `@/lib/workouts/find-plan-day`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/workouts/find-plan-day.ts

export type PlanDay = {
  day: string;
  category: string;
  exercises: { name: string; order: number; notes?: string }[];
};

/** Find the plan day whose `day` key matches, or null if today is a rest day. */
export function findPlanDay(
  structure: { days: PlanDay[] },
  day: string,
): PlanDay | null {
  return structure.days.find((d) => d.day === day) ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/find-plan-day.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/workouts/find-plan-day.ts tests/find-plan-day.test.ts
git commit -m "feat: pure findPlanDay lookup helper"
```

---

## Task 2: Refactor `createWorkout` + add `startImpromptuWorkout`

**Files:**
- Modify: `lib/actions/workouts.ts`

This extracts the generate-and-insert block from `startWorkout` into a shared private helper, rewrites `startWorkout` to delegate, and adds the impromptu action. Behavior of `startWorkout` must be unchanged.

- [ ] **Step 1: Add the `findPlanDay` import**

At the top of `lib/actions/workouts.ts`, the imports currently include:
```ts
import { planTodayDiff } from "@/lib/workouts/plan-today-diff";
```
Add directly below it:
```ts
import { findPlanDay } from "@/lib/workouts/find-plan-day";
```

- [ ] **Step 2: Replace the body of `startWorkout` (lines 25–82) with the delegating version + new helper**

Replace the ENTIRE current `startWorkout` function (from `export async function startWorkout(): Promise<` through its closing `}`) with the following two definitions:

```ts
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
  const planDay = findPlanDay(structure, weekdayForToday());
  if (!planDay) return { restDay: true, category: null };

  const exerciseNames = planDay.exercises
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((e) => e.name);

  return createWorkout({
    userId: user.id,
    planId: activePlan.id,
    category: planDay.category,
    exercises: exerciseNames,
  });
}

// Generates prescribed sets via Claude and inserts the workout + its set rows.
async function createWorkout(params: {
  userId: string;
  planId: string;
  category: string;     // stored as workouts.dayKey
  exercises: string[];  // ordered exercise names
}): Promise<{ workoutId: string }> {
  const generated = await generateWorkout({
    userId: params.userId,
    dayKey: params.category,
    exercises: params.exercises,
  });

  const [workoutRow] = await db
    .insert(workouts)
    .values({
      userId: params.userId,
      planId: params.planId,
      dayKey: params.category,
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

export async function startImpromptuWorkout(
  sourceDay: string,
): Promise<{ workoutId: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");

  // Resume an in_progress workout if one exists (one active workout at a time).
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
  const planDay = findPlanDay(structure, sourceDay);
  if (!planDay) throw new Error("plan day not found");

  const exerciseNames = planDay.exercises
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((e) => e.name);

  return createWorkout({
    userId: user.id,
    planId: activePlan.id,
    category: planDay.category,
    exercises: exerciseNames,
  });
}
```

Note: `createClient`, `db`, `plans`, `workouts`, `workoutSets`, `and`, `eq`, `generateWorkout`, `weekdayForToday`, and the `PlanStructure` type are all already present in this file. `PlanStructure.days` is structurally compatible with `findPlanDay`'s `{ days: PlanDay[] }` parameter — no cast needed. Do NOT touch `generateWorkout`, `commitSet`, `completeWorkout`, `abandonWorkout`, or `adjustTodayWorkout` further down the file.

- [ ] **Step 3: Type-check and run all tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests PASS (including Task 1's).

- [ ] **Step 4: Commit**

```bash
git add lib/actions/workouts.ts
git commit -m "refactor: extract createWorkout; add startImpromptuWorkout action"
```

---

## Task 3: `startImpromptuWorkout` forwarder

**Files:**
- Modify: `app/today/actions.ts`

The page-local actions file forwards lib server actions (Turbopack "use server" re-export limitation). Add a forwarder mirroring the existing `startWorkout` one.

- [ ] **Step 1: Replace the file contents**

The current file is:
```ts
"use server";

import { startWorkout as startWorkoutImpl } from "@/lib/actions/workouts";

export async function startWorkout() {
  return startWorkoutImpl();
}
```
Replace with:
```ts
"use server";

import {
  startWorkout as startWorkoutImpl,
  startImpromptuWorkout as startImpromptuWorkoutImpl,
} from "@/lib/actions/workouts";

export async function startWorkout() {
  return startWorkoutImpl();
}

export async function startImpromptuWorkout(sourceDay: string) {
  return startImpromptuWorkoutImpl(sourceDay);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/today/actions.ts
git commit -m "feat: forward startImpromptuWorkout server action"
```

---

## Task 4: `ImpromptuBox` client component

**Files:**
- Create: `app/today/impromptu-box.tsx`

- [ ] **Step 1: Create the component**

```tsx
// app/today/impromptu-box.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startImpromptuWorkout } from "./actions";

type Day = {
  day: string;
  category: string;
  exercises: { name: string; order: number; notes?: string }[];
};

const WEEKDAY_ORDER = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
];

const humanize = (s: string) =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function ImpromptuBox({ days }: { days: Day[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function pick(day: string) {
    setError(null);
    start(async () => {
      try {
        const { workoutId } = await startImpromptuWorkout(day);
        router.push(`/workout/${workoutId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "could not start workout");
      }
    });
  }

  const sorted = days
    .slice()
    .sort((a, b) => WEEKDAY_ORDER.indexOf(a.day) - WEEKDAY_ORDER.indexOf(b.day));

  return (
    <div className="rounded-lg border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium"
      >
        Choose an impromptu workout
        <span className="text-muted-foreground">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="border-t px-2 py-2 space-y-1">
          {sorted.map((d) => {
            const preview = d.exercises
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((e) => e.name.replace(/_/g, " "))
              .join(", ");
            return (
              <button
                key={d.day}
                type="button"
                disabled={pending}
                onClick={() => pick(d.day)}
                className="w-full text-left rounded-md px-3 py-2 hover:bg-muted disabled:opacity-50"
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium">{humanize(d.category)}</span>
                  <span className="text-xs text-muted-foreground capitalize">{d.day}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate">{preview}</p>
              </button>
            );
          })}
          {pending && (
            <p className="text-xs text-muted-foreground px-3 py-1">Generating your workout…</p>
          )}
          {error && <p className="text-xs text-destructive px-3 py-1">{error}</p>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/today/impromptu-box.tsx
git commit -m "feat: ImpromptuBox collapsible day picker"
```

---

## Task 5: Wire `ImpromptuBox` into `/today`

**Files:**
- Modify: `app/today/page.tsx`

- [ ] **Step 1: Add the import**

At the top of `app/today/page.tsx`, the imports include:
```ts
import { StartWorkoutButton } from "./start-workout-button";
```
Add directly below it:
```ts
import { ImpromptuBox } from "./impromptu-box";
```

- [ ] **Step 2: Render the box after the conditional block**

In the returned JSX, the structure currently is:
```tsx
      {planDay ? (
        <section className="space-y-4">
          ...
          <StartWorkoutButton />
        </section>
      ) : (
        <section className="rounded-lg border p-4 bg-muted/30">
          ...
        </section>
      )}
    </main>
```
Insert `<ImpromptuBox days={structure.days} />` between the closing `}` of the ternary and the closing `</main>`, so it renders on both branches:
```tsx
      {planDay ? (
        <section className="space-y-4">
          ...
          <StartWorkoutButton />
        </section>
      ) : (
        <section className="rounded-lg border p-4 bg-muted/30">
          ...
        </section>
      )}

      <ImpromptuBox days={structure.days} />
    </main>
```
Do not change anything else in the file. `structure` is already declared (`const structure = active.structure as PlanStructure;`) and `structure.days` matches the `ImpromptuBox` `days` prop shape (`{ day, category, exercises: { name, order, notes? }[] }`).

- [ ] **Step 3: Type-check and run all tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add app/today/page.tsx
git commit -m "feat: show impromptu workout box on /today"
```

---

## Task 6: Verification

**Files:** none (verification).

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: build succeeds with no type/lint errors.

- [ ] **Step 2: Manual smoke (dev server)**

Run: `npm run dev`, with a logged-in user that has an active plan and NO in-progress workout:
1. On a **rest day** (today not in the plan): `/today` shows the rest-day card and the "Choose an impromptu workout" box below it. Expand it → see all plan days (Mon→Sun order, category + weekday + exercise preview).
2. Pick a day → routes to `/workout/{id}` with that day's exercises; the generated session works like a normal workout.
3. On a **training day**: the box also appears below the Start Workout button and works the same.
4. Confirm a normal **Start Workout** on a training day still works (no regression from the `createWorkout` refactor).
5. Complete or abandon, and confirm the impromptu workout recorded its chosen category as `dayKey`.

- [ ] **Step 3: Final commit (only if cleanup was needed)**

```bash
git add -A
git commit -m "chore: impromptu workout manual-verification fixups"
```

---

## Notes for the implementer

- **Run a single test file:** `npx vitest run tests/<file>.test.ts`. **All tests:** `npx vitest run`. **Type-check:** `npx tsc --noEmit`.
- **No `startWorkout` behavior change:** Task 2 is a pure refactor of `startWorkout` plus a new sibling action. The resume-in-progress, no-active-plan, and rest-day return paths must stay byte-for-byte equivalent in effect.
- **The action itself isn't unit-tested** (it calls Anthropic + DB), matching how `startWorkout` is currently covered; the pure `findPlanDay` lookup carries the unit-test coverage, and Task 6 covers the integration manually.
