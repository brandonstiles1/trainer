# A/B/C/D rotation + double progression

Replaces the log-book nudge (`2026-08-18-log-book-progression-design.md`) and
the Claude-designed weekday plan with a fixed four-day rotation and a
double-progression rule. No LLM is left in the app.

## The rule — `recommendNext` in `lib/engine/double-progression.ts`

Pure function: an exercise's sessions (newest first), its set count, rep range,
load step and the clock in; a recommendation out.

- A session counts only if it is **complete**: every prescribed working set
  logged with real numbers, in a workout that was finished. Incomplete sessions
  neither earn progress nor break a streak.
- Working weight = the lightest working set of the latest complete session.
- Every set at or above the top of the range, at that weight, for
  `successSessions` (default 2) sessions in a row → **+1 step**, targets reset to
  the bottom of the range.
- Any set below the bottom of the range for `missSessions` (default 3) in a row →
  **suggest −1 step** (prefilled, overridable, says so).
- Otherwise **hold**: same weight, each set targets last time's reps + 1, clamped
  to the range.
- Last session older than `breakDays` (default 14) → **ease back** ~10%, at
  least one step. Time passing never adds weight.
- Streaks only count sessions at the current working weight, so ignoring an
  increase never stacks a second one, and a manual jump simply becomes the new
  base.

Steps come from Settings by equipment (`lib/program/settings.ts`): dumbbells
per dumbbell (5 → +10 total), barbell 5 upper / 10 lower, cable/machine 5 / 10,
bodyweight 5 (assisted pull-ups log negative load). A per-exercise override from
the exercise's info sheet wins.

## Data

Additive migration `0005_abcd_rotation.sql`:

- `workouts.is_extra` — extra sessions feed history but don't move the rotation.
- partial unique index: one `in_progress` workout per user (older duplicates are
  marked abandoned first).
- `profiles.progression` jsonb — all Settings values, defaults applied on read.
- `exercise_preferences.weight_increment` nullable — null means "use Settings".
- `body_weights` table (RLS in `supabase/policies.sql`).

`plans.structure` gains `version: 2` with `sets`, `repMin`, `repMax` and
optional equipment overrides per exercise. Older weekday plans are read through
`normalizeProgram` (3 sets, inferred range) and the app offers a one-tap switch
to the default program; nothing is deleted.

`workout_sets.prescribed` now records `repMin`, `repMax`, `slotSets`,
`equipment`, `restSeconds`, and on set 1 `action` + `rationale`. `slotSets` is
what lets history tell a skipped prescribed set (incomplete) from an extra
back-off set (ignored). Old rows still read: `feeling` on `actual` is ignored,
missing fields fall back to row counts.

## Rotation

Next workout = the slot after the last **completed, non-extra** workout's
`day_key`. Picking another slot from the home screen starts it as a rotation
workout (the queue continues from there). Discarded workouts don't count.

## Removed

Easy/Medium/Hard rating (UI, `lib/engine/feel.ts`, the hold-on-hard rule),
the old `planNextTargets`, Claude plan chat (onboarding + `/plan`), the weekly
AI review (table and rows kept, nothing reads them), onboarding form, weekday
plan matching, the Anthropic SDK.
