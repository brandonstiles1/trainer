# Workout App — Design Spec

**Date:** 2026-04-23
**Codename:** `trainer` (placeholder)
**Sole user:** Brandon
**Status:** Approved for planning

## 1. Purpose

A personal mobile-first web app that uses Claude to design a strength-training program, plan each day's sets and weights with dynamic branching based on in-set performance, and track body-composition progress through aligned photo overlays.

Success = Brandon opens the app at the gym, hits "Start Workout," logs sets with single taps, and the next prescribed set always reflects the reality of what just happened.

## 2. User Flows

### 2.1 Onboarding (first login)

1. Sign in with Google via Supabase Auth.
2. Optional "Before" photo capture (skippable; persists if taken).
3. Intake form: height, weight, max days/week, max minutes/session, goal photo upload OR goal description.
4. Planning chat: streaming conversation with Claude. User refines the proposed program.
5. User taps "Accept Plan" → structured program is extracted from the chat and saved.

### 2.2 Daily workout

1. User taps "Start Workout" on the Today tab. Today's `plan_day` (e.g., Push) is already determined by day of week.
2. First workout of the program, a modal asks: "Want to enter known maxes so Claude has a baseline?" — optional, writes to `lift_estimates`.
3. Claude generates today's workout as structured JSON: exercises, prescribed sets (reps × weight), and decision branches for "what's the next set if I hit under / on / over the target."
4. Workout-in-progress screen shows one set at a time. After each set, user enters actual reps and taps 🔴 / 🟡 / 🟢.
5. Client applies the deterministic branch-selection algorithm. Next set card shows updated prescription.
6. Rest timer (75s default, configurable) starts automatically after set commit. Skip / +30s controls.
7. Workout completes → summary screen. `workouts.status = 'completed'`, `completed_at` set.

### 2.3 Progress tracking

1. Progress tab shows a horizontal timeline scrubber of progress photos, with the original "before" pic ghosted underneath.
2. User can tap "Take progress photo" any day → live camera view with the before pic overlaid at ~30% opacity to enable visual alignment.
3. Claude-powered comparison (on-demand): streams a short narrative on visible changes vs. before + goal.

### 2.4 Plan adjustment

User can reopen the planning chat from the Plan tab to request revisions. Accepting a revision deactivates the prior plan and activates the new one (history preserved via `is_active`).

## 3. Architecture & Stack

### 3.1 Deployment
- Single **Next.js 15 (App Router)** app on **Vercel**
- GitHub-connected, `main` → prod
- Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` (default `claude-sonnet-4-6`)

### 3.2 Layers
- **Frontend:** RSC for auth-gated read paths. Client Components for camera capture, workout-in-progress screen, chat UI, timeline scrubber. Tailwind + `shadcn/ui` + `framer-motion`. Mobile-first CSS throughout.
- **Server:** Route Handlers at `app/api/*`:
  - `POST /api/chat/plan` — SSE stream for the plan-design chat
  - `POST /api/workout/plan` — one-shot workout generation returning structured JSON
  - `POST /api/photos/compare` — SSE stream for progress photo comparison
  - Server Actions for simple mutations (save plan, log set, update profile)
- **Data:** Supabase Postgres, accessed via `@supabase/ssr` in Server Components / Actions using the user's session. No direct service-role client on the frontend. RLS enforces per-user access on every table.
- **Storage:** Supabase Storage, user-scoped paths (e.g., `{user_id}/progress/{yyyy-mm-dd}-{uuid}.jpg`), RLS on `storage.objects`. Clients upload via signed URLs; the server never proxies image bytes.
- **Claude:** Official `@anthropic-ai/sdk`. Tool-use for structured JSON responses. Prompt caching on system prompts.

### 3.3 Dev experience (per user preference)
- Clone repo + drop `.env` + `npm run dev` = working app.
- `.env.example` lists every var with a comment on where to get it.
- Migrations auto-run (via Drizzle `drizzle-kit push` as a Vercel build step locally too, or `npm run migrate` on first boot).
- No required local Supabase CLI — works against remote Supabase with env vars alone. Local Docker Supabase is optional for integration tests.

## 4. Data Model

All tables have RLS enabled; the default policy is `user_id = auth.uid()`.

### profiles (1:1 with auth.users)
- `user_id` PK FK → `auth.users.id`
- `height_in` int
- `weight_lbs` int
- `rest_timer_seconds` int default 75
- `created_at`, `updated_at`

### goals (onboarding intake, append-only)
- `id` PK
- `user_id` FK
- `before_photo_path` text nullable
- `goal_photo_path` text nullable
- `goal_description` text nullable
- `max_days_per_week` smallint
- `max_minutes_session` smallint
- `chat_transcript` jsonb (the planning chat messages array)
- `created_at`

### plans (workout program; one active per user)
- `id` PK
- `user_id` FK
- `goal_id` FK
- `structure` jsonb — `[{ day: 'monday', category: 'push', exercises: [{ name, order, notes? }] }]`
- `is_active` boolean
- `activated_at`, `deactivated_at`

### lift_estimates (user-declared or inferred working weights)
- `id` PK
- `user_id` FK
- `exercise_name` text (normalized lowercase, e.g. `bench_press`)
- `weight_lbs` int
- `reps` smallint
- `source` enum: `user` | `inferred_from_workout`
- `recorded_at`

### workouts (one per session)
- `id` PK
- `user_id` FK
- `plan_id` FK
- `day_key` text (which day from `plan.structure`, e.g. `push`)
- `status` enum: `in_progress` | `completed` | `abandoned`
- `started_at`, `completed_at`

### workout_sets (one row per set — branches live here)
- `id` PK
- `workout_id` FK
- `exercise_name` text
- `set_number` smallint
- `prescribed` jsonb: `{ reps, weight, branches: { under: {...}, on: {...}, over: {...} } }`
- `actual` jsonb nullable: `{ reps, weight, feeling: 'red' | 'yellow' | 'green' }`
- `completed_at` timestamp nullable

### photos
- `id` PK
- `user_id` FK
- `kind` enum: `before` | `goal` | `progress`
- `storage_path` text
- `day_number` int (days since the `before` pic — used for timeline scrubbing)
- `taken_at`

## 5. Claude Integration

### 5.1 Plan-design chat
- **Endpoint:** `POST /api/chat/plan` (SSE)
- **Model:** `CLAUDE_MODEL` env (default Sonnet 4.6)
- **System prompt:** strength + hypertrophy coach persona, constraints framing, instruction to include a `<plan>{...}</plan>` JSON block whenever the current proposal is ready to commit. Cached via `cache_control: { type: 'ephemeral' }`.
- **User turns:** turn 1 carries before pic (image block), goal pic or description, height/weight, days/week, session length. Subsequent turns are text only.
- **Accept flow:** when user taps "Accept Plan," the server parses the most recent assistant message for the `<plan>` block, validates the schema, writes a `plans` row with `is_active = true` (deactivating any prior), and stores the full chat transcript in `goals.chat_transcript`.

### 5.2 Daily workout generation
- **Endpoint:** `POST /api/workout/plan` (one-shot, non-streaming — the full JSON is required before UI renders)
- **Input payload:** today's `plan_day` (category + exercise list), last ~5 sessions of `workout_sets` for those exercises, current `lift_estimates`.
- **Tool-use pattern:** define a single `submit_workout` tool with a strict JSON schema. Claude must call it exactly once. This enforces structure more reliably than prompting for raw JSON.
- **Response shape:**
  ```json
  {
    "exercises": [
      {
        "name": "bench_press",
        "sets": [
          {
            "set_number": 1,
            "prescribed": { "reps": 8, "weight": 185 },
            "branches": {
              "under": { "threshold_reps": 6, "next_set": { "reps": 8, "weight": 175 } },
              "on":    { "next_set": { "reps": 8, "weight": 185 } },
              "over":  { "threshold_reps": 10, "next_set": { "reps": 8, "weight": 195 } }
            }
          }
        ]
      }
    ]
  }
  ```
- **Caching:** system prompt (coaching guidelines + schema reminder) is cached. Per-call variable context is small, so the prefix cache hits frequently.

### 5.3 Progress photo comparison
- **Endpoint:** `POST /api/photos/compare` (SSE)
- **Input:** before photo + latest progress photo + optional goal photo (all as image blocks)
- **Output:** short streamed paragraph describing visible changes + optional plan-adjustment suggestions
- **Non-blocking & ephemeral:** user can dismiss. The comparison narrative is NOT persisted in MVP (photos themselves are). If we find value in the narratives later, we can add a `photo_comparisons` table.

### 5.4 Branch-application logic (client-side, deterministic)
Given the most recent `actual` for a set and the next set's `branches`:
1. If `actual.reps < branches.under.threshold_reps` → use `branches.under.next_set`
2. Else if `actual.reps > branches.over.threshold_reps` → use `branches.over.next_set`
3. Else → use `branches.on.next_set`
4. Feeling modifier: `red` shifts one notch down (if on → under, if over → on), `green` shifts one notch up, `yellow` no change.

This is ~20 lines of TypeScript, fully unit-testable, no Claude call.

## 6. Key UI Flows

### 6.1 Navigation
Bottom nav, 4 tabs: **Today** · **Progress** · **Plan** · **Settings**. Single-column, mobile-first.

### 6.2 Today tab
- No active workout: big "Start Workout" button, today's category + exercise preview
- Rest day: simple copy + optional "Take progress photo" nudge
- Mid-workout: auto-resume (reads any `workouts.status = 'in_progress'` row for today)
- Workout in progress (one card at a time):
  - Exercise name + "Set N of M"
  - Prescribed: `8 reps × 185 lbs`
  - Numeric input: actual reps (defaulted to prescribed)
  - Weight input (defaulted to prescribed, editable)
  - 🔴 🟡 🟢 buttons — tap commits the set
  - On commit: rest timer starts (configurable default 75s), next card slides in with branch-adjusted numbers
  - "Skip rest" ends timer; "+30s" extends
  - End of exercise → next exercise card; end of workout → summary

### 6.3 Progress tab
- Horizontal draggable timeline scrubber: progress photos day-by-day. Before pic ghosted under current photo for alignment.
- "Take progress photo" → camera screen with live `getUserMedia` feed + before-pic overlay at ~30% opacity + alignment dashed outline + mirror toggle + opacity slider
- Below timeline: simple line chart of estimated 1RM per lift over time (derived from `workout_sets`)

### 6.4 Plan tab
- Weekly calendar view (Mon–Sun): category + exercise count per day
- "Chat with coach to adjust" → reopens the planning chat. Accepting the revision deactivates old plan, activates new.

### 6.5 Settings tab
- Rest timer default
- Sign out
- Export all data (JSON dump; nice-to-have, can slip)

### 6.6 First-workout modal
Before the first "Start Workout" of a new program, show: "Want to enter known maxes so Claude has a baseline?" — small optional form for common lifts (bench, squat, deadlift, OHP, row), each as rep × weight. Writes to `lift_estimates`.

## 7. Testing Strategy

- **Vitest unit tests** (critical paths only):
  - Branch-selection algorithm (edge cases: missing branch, threshold boundaries, feeling modifier)
  - Claude tool-use response parser / JSON schema validator
  - Photo path builder, day-number computation
- **One integration test** via local Supabase Docker container: user → plan → workout → set → history query. Exercises RLS end-to-end.
- **No E2E / Playwright** for MVP — dogfooding in the gym is the integration test.
- **No live Claude calls in tests** — mock `@anthropic-ai/sdk` with fixture responses.

## 8. Error Handling

Principle: **fail loudly, never silently corrupt workout data.**

- Claude API timeout/error during workout generation → show retry button, no stale fallback
- Camera permission denied → fall back to file upload (still gets photo into the timeline, just no live alignment)
- Supabase Storage upload fails → retry with exponential backoff 3×, then queue in `localStorage` for later retry
- Mid-workout network drop → all set writes go to `localStorage` first, sync on reconnect; set logging never blocks
- Invalid Claude JSON (tool-use schema violation) → log + ask Claude to retry with the schema in the prompt (one retry, then surface error)

## 9. Deployment

- Vercel project, GitHub-connected, `main` → prod
- Supabase free tier (Postgres + Auth + Storage)
- Google OAuth credentials configured in Supabase Auth provider settings (one-time setup, documented in README)
- Storage bucket(s) created on first boot (scripted) with RLS policies applied
- `.env.example` checked into repo

## 10. Out of Scope (MVP)

Parked for later; not blocking plan phase:
- PWA manifest / add-to-home-screen (trivial to add later)
- Exercise-name standardization reference table (YAGNI until drift shows up)
- Multi-user / sharing features
- Push notifications / scheduled reminders
- Apple Health / Google Fit integration
- Video form checks
- Social feed or coach sharing
- Exporting as a native iOS app
