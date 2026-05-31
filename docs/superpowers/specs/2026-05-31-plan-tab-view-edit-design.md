# Plan Tab — View & Edit the Active Plan

**Date:** 2026-05-31
**Status:** Approved (brainstorming)

## Goal

Turn the stubbed `/plan` tab into a working feature. When the user taps **Plan**, they:

1. See the workout plan they're currently on (the full week).
2. Can chat with Claude to **edit** that plan (e.g. "put more emphasis on shoulders").
3. Can chat with Claude to **create a fresh plan** against their existing goal.

Most of the machinery already exists from onboarding (the `/api/chat/plan` streaming route, `extractPlan`, `acceptPlan`, the chat UI components, and the `PLAN_DESIGN_SYSTEM` prompt). This work renders the active plan, generalizes the onboarding chat for reuse, and extends `acceptPlan` to adjust today's in-progress workout.

## Decisions (from brainstorming)

- **Edit storage:** New version, history preserved. Accepting an edit deactivates the current active plan and inserts a new active one (matches `acceptPlan` today).
- **New plan:** Reuses the existing goal (no re-onboarding). The user can shift emphasis via chat.
- **Goal record:** Emphasis ("more shoulders") is baked into the *new plan's* structure/notes only. The saved `goals` row is **not** mutated. (A future fresh plan won't auto-remember the emphasis — acceptable.)
- **Today's workout on edit:** If an in-progress workout exists for today and the new plan has a day for today, it adjusts with this rule:
  - Exercises with ≥1 **completed** set are left fully intact (finish what you started).
  - Everything not yet started is replaced: uncompleted sets for not-started exercises are deleted, and fresh sets for the new plan day's not-started exercises are generated via the existing `generateWorkout`, then `planId`/`dayKey` are repointed.
  - Completed **past** workouts (other days) are never touched.

## Components

### 1. `/plan` page — `app/plan/page.tsx` (server)

- Auth-guard; redirect to `/login` if no user.
- Load the active plan: `plans` where `userId` + `isActive`. If none → `redirect("/onboarding")` (mirrors `/today`).
- Render, styled to match the `/today` preview card (`max-w-md` column, bordered `bg-muted/30` cards):
  - Header: "Plan" + the plan's `split` (humanized) and `notes`.
  - One card per `structure.days` entry: `category` label + exercises sorted by `order`, names with `_`→space.
- Two buttons:
  - **Edit with Claude** → link to `/plan/chat?mode=edit`
  - **Start a fresh plan** → link to `/plan/chat?mode=new`

Reuse the `PlanStructure` type shape already used in `app/today/page.tsx`.

### 2. Shared chat component — `components/chat/plan-design-chat.tsx` (client)

Extract the body of `app/onboarding/chat/chat-client.tsx` into a reusable component:

```ts
type PlanDesignChatProps = {
  goalId: string;
  mode: "new" | "edit";
  autoSendFirst: boolean;   // new: true (auto-propose), edit: false (wait for user)
  redirectTo: string;       // onboarding: "/today", plan: "/plan"
};
```

- Same streaming fetch loop, `<plan>` detection (`hasValidPlanBlock`), and Accept button as today.
- Posts `mode` in the request body to `/api/chat/plan`.
- On accept, calls `acceptPlan` then `router.replace(redirectTo)`.
- `app/onboarding/chat/chat-client.tsx` becomes a thin wrapper: `<PlanDesignChat goalId={goalId} mode="new" autoSendFirst redirectTo="/today" />`. Onboarding behavior must remain identical.

### 3. `/plan/chat` page — `app/plan/chat/page.tsx` (server)

- Auth-guard.
- Read `mode` from `searchParams` (`"edit"` | `"new"`; default `"edit"`).
- Load the active plan → its `goalId`. If no active plan → `redirect("/onboarding")`.
- Render `<PlanDesignChat goalId={goalId} mode={mode} autoSendFirst={mode === "new"} redirectTo="/plan" />` inside the same flex column layout onboarding uses.

### 4. `/api/chat/plan` route — add `mode`

- Body gains `mode: "new" | "edit"` (default `"new"` for back-compat).
- Build a `contextBlocks: ContentBlockParam[]` array (goal photos as today, then an intro text block):
  - `mode === "new"`: existing onboarding intro ("Please design a weekly strength program…").
  - `mode === "edit"`: load the active plan; intro = "Here is my current active plan: `<json>`. I want to adjust it. Wait for my specific request below, then return a revised `<plan>` block reflecting the change while keeping everything else stable."
- Inject context so role alternation stays valid:
  - If `messages.length === 0` (new mode, auto-send): `messages = [{ role: "user", content: contextBlocks }]`.
  - Else (edit mode, first user turn present): prepend `contextBlocks` into the **first** transcript message's content (convert to array form), then append the rest unchanged.
- Everything else (system prompt with cache_control, streaming) unchanged.

### 5. `acceptPlan` — `lib/actions/plans.ts`

- Existing flow unchanged: find latest valid `<plan>`, verify goal ownership, persist transcript, deactivate active plan, insert new active plan, return `{ planId }`.
- **Add** after insert: call a new `adjustTodayWorkout(userId, newPlanId, newStructure)` helper (same file or `lib/actions/workouts.ts`):
  1. Find the in-progress workout for `userId`. If none → return.
  2. Compute today's weekday; find the matching day in `newStructure`. If none → return (leave workout as-is).
  3. Load the workout's sets. Determine **started** exercises = those with any `completedAt != null`.
  4. Delete sets where exercise is **not** started (regardless of completion — they're all uncompleted by definition of not-started).
  5. New-plan exercises that are not started → generate sets via the existing `generateWorkout({ userId, dayKey: day.category, exercises })`, insert them (same row shape as `startWorkout`).
  6. Update the workout row: `planId = newPlanId`, `dayKey = day.category`.
- `generateWorkout` is currently a private helper in `lib/actions/workouts.ts`; export it (or move the adjust helper into that file) so `acceptPlan` can reuse it. No duplicate Anthropic call path.

## Data Flow

```
/plan (view)  ──Edit──▶  /plan/chat?mode=edit ──▶ PlanDesignChat(edit)
   ▲                                                    │ POST /api/chat/plan {mode:edit}
   │                                                    │  (current plan seeded as context)
   └────────── redirect "/plan" ◀── acceptPlan ◀── Accept (valid <plan>)
                                       │
                                       └─▶ adjustTodayWorkout (regenerate not-started sets)
```

## Error Handling

- Reuse existing patterns: route returns 401/404 on auth/ownership; chat client surfaces stream/accept errors in the existing error `<p>`.
- `adjustTodayWorkout` failures must not silently corrupt the workout: regenerate sets and repoint within a DB transaction so a failed Anthropic call leaves the old plan's workout intact. If generation fails after the new plan is inserted, surface the error from `acceptPlan` (the new plan is still active; the workout simply wasn't adjusted — acceptable and reported).

## Testing

- **`extractPlan` / accept shape:** already covered; no change.
- **`/api/chat/plan` context injection:** unit-test the message-assembly helper for both modes — `new` produces a single user message with goal intro; `edit` prepends current-plan context into the first transcript message and preserves alternation. Extract the assembly into a pure function to make it testable without hitting Anthropic.
- **`adjustTodayWorkout` rule:** unit-test the set-diffing logic (started vs not-started, which sets are deleted, which exercises regenerate) with `generateWorkout` stubbed.
- **Manual:** edit active plan → accept → `/plan` shows new week; with a today workout part-done, started exercise preserved, rest replaced.

## Out of Scope

- Calendar / scheduling view (later plan).
- Mutating the `goals` record from chat.
- Editing a plan while no active plan exists (covered by onboarding).
- Multi-week / mesocycle plans.
