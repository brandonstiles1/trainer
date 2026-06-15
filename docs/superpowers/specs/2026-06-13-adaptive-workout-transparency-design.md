# Adaptive Workout Transparency & History — Design

**Date:** 2026-06-13
**Branch context:** `feat/workout-timer-overhaul`
**Status:** Approved design, pre-implementation

## Problem

The user doesn't trust that workouts adapt to their stated maxes or actual performance, and has no visibility into the AI's reasoning. Two concrete failures:

1. **Bad starting weights.** Told the AI their bench max was 200, but incline press started at 8 × 40 — far too light. No way to see *why* that number was chosen, and no way to correct it so the correction sticks.
2. **Adaptation can't make big jumps.** Prescribed tricep extension 10 × 37; the user did 8 × 100. The next set should react to that huge gap, but it only nudged toward ~40.

Root causes (confirmed by reading the code):

- **Generation** (`generateWorkout`, `lib/actions/workouts.ts`) sends Claude the user's lift estimates + recent sets, but the prompt (`lib/prompts/workout-design.ts`) only says "start conservatively" — it never teaches the model to *derive* a starting weight from a related max. Claude is also told to emit **no prose**, so no rationale is ever stored.
- **Adaptation** (`applyBranch`, `lib/branch.ts`) does not compute anything at runtime — it reads a **pre-baked `next_set`** that Claude generated with only ±5% deltas. The structure is *physically incapable* of reacting to a large miss, no matter how far off the prescription was.

## Approach

Claude bookends a deterministic core. **Claude runs exactly twice:** once per workout (design + rationale) and once per week (baseline review). Everything in between is pure, instant, explainable math — no token cost.

```
generate workout (Claude, 1×)
   → log set → recompute downstream sets (math) → … → pin baseline (math)
                                                          ↓
                          weekly review (Claude, 1×/week) ← reads week's actuals + pins
```

This was chosen over re-asking Claude mid-set (too slow/expensive in the gym) and over widening the pre-baked branches (still can't handle arbitrary-magnitude misses).

---

## 1. In-workout adaptation engine (replaces `applyBranch`)

`lib/branch.ts`'s pre-baked branch system is removed and replaced with a 1RM-based engine. **Critically, adaptation is a pure recompute from the ordered chain of actuals**, not an in-place mutation of "the next row." This is what lets the user edit *any* set and have everything after it re-flow.

**Core math (Epley):**

- Estimated 1RM from a logged set: `e1RM = weight × (1 + reps / 30)`
- Target weight for a later set at its `targetReps`, leaving a rep buffer (RIR):
  `weight = e1RM / (1 + (targetReps + buffer) / 30)`
- **Feeling modulates the buffer:** `Easy` → smaller buffer (push harder), `Hard` → larger buffer (back off), `Okay` → hold. Proposed defaults: Okay = 2, Easy = 1, Hard = 3 (tunable).
- Round to the nearest 5 lb.
- **Clamp:** never drop a prescribed weight below the user's pinned baseline floor for that lift (see §4).

**Shape:** a single pure function

```
adaptChain(sets: SetState[], baselineFloor?: number): SetState[]
```

takes the ordered sets for one exercise and returns them with each non-first set's `prescribed.weight` recomputed from the *prior* set's actual (or, if not yet logged, from the prior set's prescription). Used **both client-side** (instant UI feedback on edit) and **server-side** (authoritative persistence). Editing set _k_ re-runs the chain from _k_ forward.

**Worked example (tricep):** logged 8 × 100, felt Okay → `e1RM ≈ 100 × (1 + 8/30) ≈ 127`. Next set at target 10 reps, buffer 2 → `127 / (1 + 12/30) ≈ 90` → **90 lbs**, not 40.

---

## 2. Generation changes (the incline bug + the "why")

- The `submit_workout` tool (`lib/workout-tool.ts`) is **simplified**: the entire `branches` tree is removed. Each set carries `{ set_number, target_reps, weight }`; each exercise gains a **`rationale`** string (≤ ~140 chars) explaining the set-1 weight.
- `WORKOUT_DESIGN_SYSTEM` (`lib/prompts/workout-design.ts`) gains explicit guidance for **deriving starting weights from related maxes** (e.g. incline ≈ ~70% of flat bench; close-grip ≈ ~80%, etc.) and is instructed to always justify set 1 in `rationale`. The "no prose" rule stays for everything except the structured `rationale` field.
- **Rationale provenance:** set 1's rationale comes from Claude; sets 2+ get a rationale **computed by the adaptation engine** ("You hit 8 × 100, est. 1RM ~127 → targeting 10 reps with a buffer → 90").

---

## 3. The workout UI (session screen)

The collapsible exercise-card component is shared. `/today` with no in-progress workout shows it **read-only** (prescribed cards + Start). Starting redirects to `/workout/[id]` (existing behavior), where the same cards become **interactive**.

**Two-level collapse:**
- **Card level** — tap an exercise header to expand/collapse the whole exercise.
- **Set level** — tap any individual set row to expand it into an editable state; collapse back to a compact row.

**Editable any set + cascade:**
- Expanding a set reveals editable **reps** and **weight** number inputs plus the feel chips (Hard/Okay/Easy).
- Committing or editing a set (including an already-completed earlier one) runs `adaptChain` from that set forward; downstream sets visibly update (tagged "updated").

**"Why" reveal (chosen: tap-to-reveal ⓘ):**
- A small ⓘ next to "prescribed N × W" expands a one-line rationale inline. Clean by default, detail on demand.

**Live "Total lifted":**
- Lives in the session header. Starts at 0, increments after every committed set (sum of `reps × weight` over logged sets), with a brief "+X last set" flash. Recomputes correctly when a set is edited.

---

## 4. Pinned baselines (sticky floor + ceiling hint)

Chosen behavior: **pin, but as a ceiling hint.**

- `lift_estimates` gains a `user_pinned` source. A pinned entry is a **sticky floor**: generation honors it, and a single bad day will not lower it.
- The weekly review (§5) treats a pin as "I can do at least this" and nudges **related** exercises up too (Claude knows movement relationships).

**Pin interaction (chosen: contextual prompt right after the jump):**
- When a committed set's weight is **far above** its prescription (proposed trigger: ≥ 25% over — tunable), a banner slides onto the next set: *"Big jump 37 → 100. Pin 100 as your baseline for tricep extension?"* → one tap to pin, or dismiss.

---

## 5. Weekly review (Claude, 1× / week)

- **Lazy trigger:** on workout start, if it's been ≥ 7 days since the last review **and** there's a completed workout in the window, fire a background Claude call.
- **Input:** the week's prescribed-vs-actual, feelings, and any pins.
- **Output:** updated `lift_estimates` for worked exercises *and* related ones (the ceiling-hint cross-exercise nudge).
- **Tracking:** a `last_weekly_review_at timestamptz` column on `profiles`.
- **Surface (minimal for v1):** a small "Coach updated your baselines this week" note on `/today`. Optional; can ship without.

---

## 6. Workouts screen (new — replaces Progress)

- A **stack of collapsible cards, one per past session**. Collapsed header: day category + status badge (`done` / `abandoned`) + date + sets + total volume. Expanded: each exercise with the sets/reps actually performed.
- **Delete (chosen: delete-from-detail):** in an expanded card, an overflow (⋯) menu holds **Delete** (with a confirm). Deletes the workout and its sets.

---

## 7. Today screen (restyled)

- Day category at the top (Push / Pull / …), then the shared collapsible exercise cards showing the prescribed sets/reps (read-only preview), the ⓘ rationale, and a **Start workout** button. Impromptu "do a different day" stays.

---

## 8. Navigation (3 tabs)

- `components/bottom-nav.tsx` becomes **Today · Workouts · Settings**.
- **Progress** tab is removed (the `/progress` stub is retired).
- **Plan** moves **into Settings** — the plan-design chat is reachable from the Settings screen rather than a top-level tab.

---

## 9. Schema deltas

- `lift_estimates`: add `user_pinned` to the `lift_source` enum.
- `workout_sets.prescribed` (jsonb): new shape `{ reps, weight, target_reps, rationale? }`; **drop `branches`**. New code tolerates pre-existing in-progress workouts that still carry `branches` (treat as no-op adaptation seed).
- `profiles`: add `last_weekly_review_at timestamptz` (nullable).

---

## Components & boundaries

- `lib/adapt.ts` (new) — `adaptChain` + Epley helpers. Pure, fully unit-testable, shared client/server. Replaces `lib/branch.ts`.
- `lib/workout-tool.ts` — simplified tool schema (no branches; adds `rationale`, `target_reps`).
- `lib/prompts/workout-design.ts` — derivation guidance + rationale instruction.
- `lib/actions/workouts.ts` — `commitSet` recomputes the chain server-side; new `editSet`, `pinBaseline`, `deleteWorkout`, `runWeeklyReview` (lazy-triggered).
- `lib/prompts/weekly-review.ts` (new) + a review action.
- `app/workout/[id]/session.tsx` — two-level collapse, editable any set, cascade, live total, ⓘ reveal, pin banner.
- `app/today/page.tsx` — restyled to shared collapsible cards.
- `app/workouts/` (new route) — session-card stack + delete-from-detail.
- `components/bottom-nav.tsx` — 3 tabs.
- Settings screen — host the plan-design entry point.

## Error handling

- Claude generation failure: unchanged behavior (throws; surfaced to caller). Schema validation via zod stays.
- Weekly review failure: background, non-blocking — log and skip; the timestamp is **not** advanced so it retries next workout start.
- Pin write / delete failures: surfaced as a toast; UI rolls back optimistic state.
- `adaptChain` is total (never throws) — clamps and rounds defensively.

## Testing

- **Unit (priority):** `adaptChain` — Epley math, feeling buffers, rounding, baseline-floor clamp, the tricep big-jump example, and **chain recompute when an earlier set is edited**.
- **Unit:** tool-schema zod validation for the new `submit_workout` shape.
- **Integration:** `commitSet` / `editSet` persist recomputed downstream sets; `pinBaseline` writes a sticky `user_pinned` estimate; `deleteWorkout` cascades to sets.
- **Manual:** the two real-world scenarios (incline derivation, tricep jump) reproduced end-to-end.

## Decisions log (defaults that are tunable)

- Adaptation buffer (RIR): Okay 2 / Easy 1 / Hard 3.
- Weight rounding: nearest 5 lb.
- Pin-prompt trigger: committed weight ≥ 25% over prescribed.
- Weekly-review cadence: ≥ 7 days, lazy-triggered on workout start.
- Weekly-review surface: minimal note on `/today`, optional for v1.

## Out of scope (v1)

- Progress photos / timeline (was the old Progress tab).
- Per-plate / dumbbell-specific rounding (flat 5 lb for now).
- Configurable buffers/triggers in Settings (hard-coded defaults first).
