# Log book progression

Replaces the autoregulation engine (`docs/superpowers/specs/2026-06-13-adaptive-workout-transparency-design.md`)
with a log book that nudges.

## The rule

Last session's sets carry forward — position for position, load for load. They
move only when the session was clean: **every set at or above its target**.

- Clean → target reps climb by one. `55×8, 55×8, 55×8` becomes `55×9`.
- Any set short → the same targets run again. `55×8, 55×7, 55×7` stays at 8.
- Clean at the top of the rep range → one weight step, back to the bottom.
  `55×12 ×3` with a 5 lb step becomes `60×8`.
- Overshoot counts. `55×10 ×3` against a target of 8 goes to 11, not 9 — the
  next target is the *lowest reps actually done*, plus one.
- Clean but two or more sets rated hard → hold one session, then push.

Rep range and weight step are per-exercise, defaulted from the exercise name
(compound 6–10, isolation 10–15) and editable from the info panel.

The whole rule is `planNextTargets` in `lib/engine/progression.ts`: pure, no
I/O, ~60 lines. `lib/workouts/exercise-history.ts` turns stored rows into the
sessions it reads.

## What the app does mid-workout

Almost nothing. Logging a set no longer re-derives anything downstream, with one
exception: later sets of the same exercise follow the **weight** you actually put
on the bar (`lib/workouts/carry-weight.ts`). Rep targets stand — coming up a rep
short doesn't lower what you're chasing.

Editing is the interface. What you type into a set is the log, and the log is
what next session builds on, which is why pinning a baseline is gone: lift 95
instead of 55 and next session simply starts at 95.

## The info panel

Tap ⓘ on any exercise card for its last three sessions (every set, with its feel
colour and whether it hit target), the standing PR, and the two settings that
decide when it earns a bump.

## Removed

- e1RM estimation and everything on it: EMA blending, recalibration and
  confirmation sets, `weightForReps` prescriptions
- in-workout autoregulation — readiness multipliers, fatigue decay, muscle-group
  carryover, the set-1 probe
- calibration ramps (light×10 → +20%×8 → AMRAP) for new exercises
- stall breaker, auto-deload, auto set-count growth from "easy" sessions
- the pin-a-baseline dialog and the 850 ms "Calculating next set…" beat
- writing `lift_estimates` on workout completion
- the weekly review's ability to write numbers at all (see below)

`lift_estimates` rows survive for one job: a signup answer ("I can bench 185×5")
seeds the opening load for an exercise the user has never logged. That is the
only remaining caller of the Epley math in `lib/adapt.ts`.

## The weekly review

Commentary, and structurally nothing else. `submit_review` used to return
`{ exercise_name, weight_lbs, reps }` triples that were written straight into
`lift_estimates`; it now returns a headline and up to six observations, each a
sentence tied to an exercise or to the week as a whole. There is no numeric
field left in the schema, so the model cannot reach the progression path even
if it tries — and the prompt tells it the rule is fixed and readable by the
user, so it shouldn't.

Reviews land in `weekly_reviews` and show as a card at the top of the Workouts
tab. Before this they were written to `lift_estimates` and displayed nowhere.

It earns its place by seeing what `planNextTargets` can't: that rule looks
exactly one session back, per exercise. The review reads the whole week and can
say "curls have been stuck three sessions while you're clearing everything on
rows" or "you've skipped back work twice."

## Schema

`exercise_preferences` gains nullable `rep_min` / `rep_max`; `workout_sets`
gains an index on `exercise_name`, now the hot path. New `weekly_reviews` table
(RLS added in `supabase/policies.sql`). Old `prescribed` payloads still read
fine — their `amrap` / `calibration` / `deload` flags are inert.

`lift_estimates` keeps its rows and its `user_pinned` enum value for the sake
of history, but nothing writes either any more.
