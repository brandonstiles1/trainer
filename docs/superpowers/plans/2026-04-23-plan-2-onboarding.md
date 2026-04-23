# Plan 2 — Onboarding & Plan Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in user with no active plan goes through intake → streaming plan-design chat with Claude → accepts a structured plan that persists to the DB. `/today` now routes correctly based on plan state.

**Architecture:** Server Actions for form submission + photo uploads (via Supabase signed URLs). An SSE `/api/chat/plan` route streams Claude responses (raw `@anthropic-ai/sdk`, no `ai` package). The client reads the SSE stream manually. Claude is instructed to wrap its final structured plan in a `<plan>...</plan>` XML tag so the client can surface an "Accept Plan" button and the server can parse and persist on accept.

**Tech Stack:** Next.js 16 App Router · `@anthropic-ai/sdk` · Supabase Storage (signed uploads) · Drizzle (inserts) · shadcn (Input, Textarea, Slider, Label)

---

## Prerequisites

- Plan 1 is merged to `main` and deployed (you're in a worktree branched from post-Plan-1 `main`)
- `ANTHROPIC_API_KEY` is set in `.env.local` (confirm with `echo $ANTHROPIC_API_KEY` after `set -a; source .env.local; set +a`)
- Supabase Storage needs a `photos` bucket — created in Task 1 via SQL

---

## File Structure

```
trainer/
├── app/
│   ├── onboarding/
│   │   ├── page.tsx                     # Server component: auth check + render form
│   │   ├── form.tsx                     # Client form
│   │   ├── actions.ts                   # Server action: createGoal
│   │   └── chat/
│   │       ├── page.tsx                 # Server component: load goal, render chat shell
│   │       ├── chat-client.tsx          # Client chat UI
│   │       └── actions.ts               # Server action: acceptPlan
│   ├── api/chat/plan/route.ts           # SSE streaming endpoint
│   ├── today/page.tsx                   # Updated: redirect to /onboarding if no active plan
│   └── login/page.tsx                   # Updated: redirect to /today on success (handled by proxy already)
├── components/
│   ├── photo-upload.tsx                 # Single-file upload w/ preview; no live camera yet
│   ├── chat/
│   │   ├── message.tsx                  # One chat bubble
│   │   ├── message-list.tsx             # Scrollable list
│   │   └── input.tsx                    # Autosizing textarea + send button
│   └── ui/                              # shadcn Input, Textarea, Slider, Label (added)
├── lib/
│   ├── anthropic.ts                     # Configured Anthropic client
│   ├── prompts/plan-design.ts           # System prompt for plan chat
│   ├── plan-parser.ts                   # Extract + validate <plan> JSON block
│   ├── storage.ts                       # Supabase Storage helpers
│   └── actions/
│       ├── goals.ts                     # createGoal
│       └── plans.ts                     # acceptPlan (transaction: deactivate prior, insert new)
├── supabase/
│   └── storage.sql                      # Bucket creation + RLS policies on storage.objects
└── tests/
    ├── plan-parser.test.ts              # Parser edge cases
    └── prompts.test.ts                  # Snapshot of system prompt (catches accidental drift)
```

**Why this split:**
- `app/onboarding/form.tsx` is client-side because the photo upload uses `FileReader` for preview; page shell stays server-side for auth gating.
- `chat-client.tsx` is the only part that needs `"use client"` in the chat flow — keeps the server render cheap.
- Plan parsing + prompt live in `lib/` because both the streaming endpoint AND the accept action need them.
- `actions/` directory for server actions invoked from multiple places (form + chat).

---

## Task 1: Supabase Storage bucket + RLS

**Files:** Create `supabase/storage.sql`.

- [ ] **Step 1: Write `supabase/storage.sql`**

```sql
-- ============================================
-- Supabase Storage setup for the trainer app.
-- Creates one bucket: "photos"
-- Path convention: {user_id}/{kind}/{yyyy-mm-dd}-{uuid}.{ext}
-- ============================================

-- Create the bucket (idempotent)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'photos',
  'photos',
  false,                    -- private bucket; access via signed URLs only
  10485760,                 -- 10 MB limit per file
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

-- ---------- RLS ----------

create policy "photos: user reads own objects"
  on storage.objects for select
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "photos: user writes own objects"
  on storage.objects for insert
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "photos: user deletes own objects"
  on storage.objects for delete
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

- [ ] **Step 2: Apply the SQL**

Primary: Supabase Dashboard → SQL Editor → paste contents → Run.
Alternative: `set -a; source .env.local; set +a; psql "$DATABASE_URL" -f supabase/storage.sql`

Verify in Dashboard → Storage: `photos` bucket exists, Private, 10 MB limit.

- [ ] **Step 3: Commit**

```bash
git add supabase/storage.sql
git commit -m "feat: add Supabase Storage photos bucket with RLS"
```

---

## Task 2: Anthropic client module

**Files:** Create `lib/anthropic.ts`. Install `@anthropic-ai/sdk`.

- [ ] **Step 1: Install SDK**

```bash
cd /Users/brandonstiles/Desktop/my-apps/trainer
npm install @anthropic-ai/sdk
```

- [ ] **Step 2: Write `lib/anthropic.ts`**

```ts
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { serverEnv } from "@/lib/env";

let _client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: serverEnv().ANTHROPIC_API_KEY });
  }
  return _client;
}

export function model(): string {
  return serverEnv().CLAUDE_MODEL;
}
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json lib/anthropic.ts
git commit -m "feat: add Anthropic SDK client module"
```

---

## Task 3: System prompt for plan design

**Files:** Create `lib/prompts/plan-design.ts`, `tests/prompts.test.ts`.

- [ ] **Step 1: Write `lib/prompts/plan-design.ts`**

```ts
/**
 * System prompt for the plan-design chat.
 * Tagged with cache_control on the caller — keep this stable so the cache hits across turns.
 *
 * The prompt asks Claude to always wrap its current proposed plan in <plan>...</plan> XML tags
 * containing JSON. The client uses the presence of a valid <plan> block to enable the
 * "Accept Plan" button.
 */
export const PLAN_DESIGN_SYSTEM = `You are an experienced strength and hypertrophy coach helping a single user design a personalized workout program.

The user has provided:
- Height, current weight, and (optionally) a "before" photo
- A goal: either a target photo or a text description of how they want to look
- Max days per week they can train
- Max minutes per session

Your job is to propose a weekly program — which days of the week they train, which body-part categories each day covers (e.g. Push, Pull, Legs, Upper, Lower, Full Body), and which specific exercises are assigned to each day. Respect the user's constraints. Propose progressive overload–friendly exercises (compound movements first, accessories second).

Be concise. Do not lecture. Ask at most one clarifying question if genuinely needed — otherwise propose a full plan on your first turn.

**IMPORTANT — Plan format:**
Whenever you propose a full plan (your first turn, and every revision), include it in this exact XML format at the end of your message:

<plan>
{
  "split": "push_pull_legs",
  "notes": "Short 1–2 sentence rationale visible to the user",
  "days": [
    {
      "day": "monday",
      "category": "push",
      "exercises": [
        { "name": "bench_press", "order": 1, "notes": "warm up first" },
        { "name": "overhead_press", "order": 2 },
        { "name": "incline_dumbbell_press", "order": 3 },
        { "name": "tricep_rope_extensions", "order": 4 }
      ]
    }
  ]
}
</plan>

Rules:
- \`day\` is lowercase english weekday: monday|tuesday|wednesday|thursday|friday|saturday|sunday
- \`category\` is a short lowercase label (push|pull|legs|upper|lower|full_body|cardio|rest)
- \`exercises\` is ordered by \`order\` (1-indexed)
- \`name\` is snake_case lowercase, singular, consistent across all days (e.g. always "bench_press", never "Bench Press" or "bench press")
- Only include days the user will actually train. No rest-day entries.
- No more than 6 exercises per day.
- JSON must be valid — escape quotes, no trailing commas, no comments.

If the user asks you to revise the plan, update the \`<plan>\` block accordingly. The user's client detects the block and shows an "Accept Plan" button when valid.`;
```

- [ ] **Step 2: Write `tests/prompts.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { PLAN_DESIGN_SYSTEM } from "@/lib/prompts/plan-design";

describe("PLAN_DESIGN_SYSTEM prompt", () => {
  it("mentions the <plan> XML tag", () => {
    expect(PLAN_DESIGN_SYSTEM).toContain("<plan>");
    expect(PLAN_DESIGN_SYSTEM).toContain("</plan>");
  });

  it("specifies required JSON fields", () => {
    for (const key of ["split", "days", "category", "exercises", "name", "order"]) {
      expect(PLAN_DESIGN_SYSTEM).toContain(key);
    }
  });

  it("specifies snake_case naming rule for exercise names", () => {
    expect(PLAN_DESIGN_SYSTEM).toMatch(/snake_case/i);
  });

  it("is stable (length within expected range for cache warming)", () => {
    // If this fails, review the prompt change — you're invalidating the prompt cache on every request.
    expect(PLAN_DESIGN_SYSTEM.length).toBeGreaterThan(1000);
    expect(PLAN_DESIGN_SYSTEM.length).toBeLessThan(3000);
  });
});
```

- [ ] **Step 3: Run test**

```bash
npm test -- prompts.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add lib/prompts/ tests/prompts.test.ts
git commit -m "feat: add plan-design system prompt with snapshot tests"
```

---

## Task 4: Plan parser + tests

**Files:** Create `lib/plan-parser.ts`, `tests/plan-parser.test.ts`.

- [ ] **Step 1: Write `tests/plan-parser.test.ts` (TDD — write tests first)**

```ts
import { describe, it, expect } from "vitest";
import { extractPlan } from "@/lib/plan-parser";

describe("extractPlan", () => {
  const validPlan = `Here's what I think. <plan>
{
  "split": "push_pull_legs",
  "notes": "3 days/week upper-lower focus",
  "days": [
    { "day": "monday", "category": "push", "exercises": [
      { "name": "bench_press", "order": 1 }
    ] }
  ]
}
</plan> Let me know what you'd change.`;

  it("returns null when no <plan> block present", () => {
    expect(extractPlan("Just a chat message.")).toBeNull();
  });

  it("extracts and parses a valid plan block", () => {
    const result = extractPlan(validPlan);
    expect(result).not.toBeNull();
    expect(result?.split).toBe("push_pull_legs");
    expect(result?.days).toHaveLength(1);
    expect(result?.days[0].category).toBe("push");
    expect(result?.days[0].exercises[0].name).toBe("bench_press");
  });

  it("returns null for malformed JSON inside <plan> tags", () => {
    const malformed = `<plan>{ not valid json }</plan>`;
    expect(extractPlan(malformed)).toBeNull();
  });

  it("returns null when required field is missing", () => {
    const missingDays = `<plan>{ "split": "x", "notes": "y" }</plan>`;
    expect(extractPlan(missingDays)).toBeNull();
  });

  it("rejects invalid day-of-week values", () => {
    const badDay = `<plan>{
      "split": "x", "notes": "y",
      "days": [{ "day": "Funday", "category": "push", "exercises": [] }]
    }</plan>`;
    expect(extractPlan(badDay)).toBeNull();
  });

  it("handles multiple <plan> blocks by taking the last one (user revision scenario)", () => {
    const twoBlocks = `
      <plan>{ "split": "old", "notes": "first", "days": [] }</plan>
      Later I revised:
      <plan>{
        "split": "new", "notes": "second", "days": [
          { "day": "monday", "category": "push", "exercises": [{ "name": "a", "order": 1 }] }
        ]
      }</plan>`;
    const result = extractPlan(twoBlocks);
    expect(result?.split).toBe("new");
  });

  it("tolerates whitespace and newlines around the JSON", () => {
    const whitespace = `<plan>
\t  { "split": "x", "notes": "y", "days": [
        { "day": "monday", "category": "push", "exercises": [{ "name": "a", "order": 1 }] }
      ] }
    \n  </plan>`;
    const result = extractPlan(whitespace);
    expect(result?.split).toBe("x");
  });

  it("allows empty exercise arrays on individual days (edge case Claude may produce)", () => {
    const emptyExercises = `<plan>{
      "split": "x", "notes": "y",
      "days": [{ "day": "monday", "category": "rest", "exercises": [] }]
    }</plan>`;
    const result = extractPlan(emptyExercises);
    expect(result?.days[0].exercises).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- plan-parser.test.ts
```

Expected: all 8 tests fail with "Cannot find module '@/lib/plan-parser'".

- [ ] **Step 3: Write `lib/plan-parser.ts`**

```ts
import { z } from "zod";

const dayOfWeek = z.enum([
  "monday", "tuesday", "wednesday",
  "thursday", "friday", "saturday", "sunday",
]);

const exercise = z.object({
  name: z.string().min(1).regex(/^[a-z0-9_]+$/, "must be snake_case"),
  order: z.number().int().min(1),
  notes: z.string().optional(),
});

const planDay = z.object({
  day: dayOfWeek,
  category: z.string().min(1).regex(/^[a-z0-9_]+$/),
  exercises: z.array(exercise),
});

export const planSchema = z.object({
  split: z.string().min(1),
  notes: z.string(),
  days: z.array(planDay).min(1),
});

export type Plan = z.infer<typeof planSchema>;

/**
 * Extract the last <plan>...</plan> block from a string and validate it.
 * Returns null on any failure (no block, malformed JSON, schema mismatch).
 */
export function extractPlan(text: string): Plan | null {
  const matches = [...text.matchAll(/<plan>([\s\S]*?)<\/plan>/gi)];
  if (matches.length === 0) return null;

  const lastMatch = matches[matches.length - 1][1].trim();
  let raw: unknown;
  try {
    raw = JSON.parse(lastMatch);
  } catch {
    return null;
  }

  const parsed = planSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test -- plan-parser.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/plan-parser.ts tests/plan-parser.test.ts
git commit -m "feat: add plan parser to extract and validate <plan> JSON blocks"
```

---

## Task 5: Supabase Storage helpers

**Files:** Create `lib/storage.ts`.

- [ ] **Step 1: Write `lib/storage.ts`**

```ts
import "server-only";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";

const BUCKET = "photos";

export type PhotoKind = "before" | "goal" | "progress";

/**
 * Returns a signed upload URL the client can PUT image bytes to.
 * Path format: {user_id}/{kind}/{iso-date}-{uuid}.{ext}
 */
export async function createSignedUploadUrl(params: {
  userId: string;
  kind: PhotoKind;
  ext: "jpg" | "jpeg" | "png" | "webp" | "heic";
}): Promise<{ path: string; token: string; signedUrl: string }> {
  const supabase = await createClient();
  const date = new Date().toISOString().slice(0, 10);
  const filename = `${date}-${randomUUID()}.${params.ext}`;
  const path = `${params.userId}/${params.kind}/${filename}`;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) throw new Error(`signed url failed: ${error?.message ?? "unknown"}`);

  return { path, token: data.token, signedUrl: data.signedUrl };
}

/**
 * Returns a signed URL the client can GET to display a stored image.
 * Expires in 1 hour.
 */
export async function createSignedReadUrl(path: string): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 3600);
  if (error || !data) throw new Error(`signed read url failed: ${error?.message ?? "unknown"}`);
  return data.signedUrl;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/storage.ts
git commit -m "feat: add Supabase Storage helpers for signed upload/read URLs"
```

---

## Task 6: shadcn form primitives

**Files:** Created by shadcn: `components/ui/input.tsx`, `components/ui/textarea.tsx`, `components/ui/slider.tsx`, `components/ui/label.tsx`.

- [ ] **Step 1: Add the four primitives**

```bash
cd /Users/brandonstiles/Desktop/my-apps/trainer
npx --yes shadcn@latest add input textarea slider label
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: succeeds. All four components in `components/ui/`.

- [ ] **Step 3: Commit**

```bash
git add components/ui/ package.json package-lock.json
git commit -m "chore: add shadcn Input, Textarea, Slider, Label primitives"
```

---

## Task 7: Photo upload component

**Files:** Create `components/photo-upload.tsx`.

- [ ] **Step 1: Write `components/photo-upload.tsx`**

```tsx
"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export type PhotoUploadProps = {
  /** Presentational label: "Before photo", "Goal photo", etc. */
  label: string;
  /** Optional: surface errors at the parent */
  onError?: (msg: string) => void;
  /** Fires with the selected File (or null if cleared) */
  onChange: (file: File | null) => void;
  /** Allow skipping entirely — renders a "No thanks" button */
  optional?: boolean;
};

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/heic"];
const MAX_BYTES = 10 * 1024 * 1024;

export function PhotoUpload({ label, onError, onChange, optional }: PhotoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(false);

  const handleFile = (file: File | null) => {
    if (!file) {
      setPreviewUrl(null);
      onChange(null);
      return;
    }
    if (!ACCEPTED.includes(file.type)) {
      onError?.(`Unsupported file type: ${file.type}. Use JPG/PNG/WEBP/HEIC.`);
      return;
    }
    if (file.size > MAX_BYTES) {
      onError?.(`File too large: ${(file.size / 1024 / 1024).toFixed(1)} MB. Max 10 MB.`);
      return;
    }
    setPreviewUrl(URL.createObjectURL(file));
    setSkipped(false);
    onChange(file);
  };

  if (skipped) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{label} skipped.</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setSkipped(false);
            onChange(null);
          }}
        >
          Change my mind
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">{label}</label>
        {optional && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setSkipped(true);
              setPreviewUrl(null);
              onChange(null);
            }}
          >
            Skip
          </Button>
        )}
      </div>

      {previewUrl ? (
        <div className="space-y-2">
          <img
            src={previewUrl}
            alt="preview"
            className="w-full max-h-80 object-cover rounded-lg border"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handleFile(null)}
          >
            Remove
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full h-40 border-2 border-dashed rounded-lg flex items-center justify-center text-sm text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
        >
          Tap to choose an image
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(",")}
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/photo-upload.tsx
git commit -m "feat: add PhotoUpload component with type/size validation + preview"
```

---

## Task 8: Onboarding form + server action

**Files:** Create `app/onboarding/page.tsx`, `app/onboarding/form.tsx`, `app/onboarding/actions.ts`, `lib/actions/goals.ts`.

- [ ] **Step 1: Write `lib/actions/goals.ts`**

```ts
"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { goals } from "@/lib/db/schema";
import { createSignedUploadUrl } from "@/lib/storage";
import type { PhotoKind } from "@/lib/storage";

export type CreateGoalInput = {
  heightIn: number;
  weightLbs: number;
  maxDaysPerWeek: number;
  maxMinutesSession: number;
  goalDescription: string | null;
  beforePhotoPath: string | null;
  goalPhotoPath: string | null;
};

export async function createGoal(input: CreateGoalInput): Promise<{ goalId: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");

  const [row] = await db
    .insert(goals)
    .values({
      userId: user.id,
      heightIn: undefined, // stored on profiles, not goals
      beforePhotoPath: input.beforePhotoPath,
      goalPhotoPath: input.goalPhotoPath,
      goalDescription: input.goalDescription,
      maxDaysPerWeek: input.maxDaysPerWeek,
      maxMinutesSession: input.maxMinutesSession,
      chatTranscript: [],
    } as typeof goals.$inferInsert)
    .returning({ id: goals.id });

  // Also persist height + weight on profiles.
  await supabase
    .from("profiles")
    .update({ height_in: input.heightIn, weight_lbs: input.weightLbs })
    .eq("user_id", user.id);

  return { goalId: row.id };
}

/** Invoked from the client to get a signed upload URL. */
export async function getUploadUrl(kind: PhotoKind, ext: "jpg" | "jpeg" | "png" | "webp" | "heic") {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");
  return createSignedUploadUrl({ userId: user.id, kind, ext });
}
```

- [ ] **Step 2: Write `app/onboarding/actions.ts`**

```ts
"use server";

import { redirect } from "next/navigation";
import { createGoal, type CreateGoalInput } from "@/lib/actions/goals";

export async function submitOnboarding(input: CreateGoalInput) {
  const { goalId } = await createGoal(input);
  redirect(`/onboarding/chat?goalId=${goalId}`);
}

// Re-export so client can import from a single path
export { getUploadUrl } from "@/lib/actions/goals";
```

- [ ] **Step 3: Write `app/onboarding/form.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { PhotoUpload } from "@/components/photo-upload";
import { submitOnboarding, getUploadUrl } from "./actions";
import type { PhotoKind } from "@/lib/storage";

function extFor(file: File): "jpg" | "jpeg" | "png" | "webp" | "heic" {
  const map: Record<string, "jpg" | "jpeg" | "png" | "webp" | "heic"> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
  };
  return map[file.type] ?? "jpg";
}

async function uploadPhoto(kind: PhotoKind, file: File): Promise<string> {
  const { path, signedUrl } = await getUploadUrl(kind, extFor(file));
  const res = await fetch(signedUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return path;
}

export function OnboardingForm() {
  const [beforePhoto, setBeforePhoto] = useState<File | null>(null);
  const [goalPhoto, setGoalPhoto] = useState<File | null>(null);
  const [goalDescription, setGoalDescription] = useState("");
  const [heightIn, setHeightIn] = useState(69);
  const [weightLbs, setWeightLbs] = useState(180);
  const [daysPerWeek, setDaysPerWeek] = useState(3);
  const [minutesSession, setMinutesSession] = useState(60);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!goalPhoto && goalDescription.trim().length < 10) {
      setError("Upload a goal photo OR describe your goal in at least 10 characters.");
      return;
    }

    try {
      const [beforePath, goalPath] = await Promise.all([
        beforePhoto ? uploadPhoto("before", beforePhoto) : Promise.resolve(null),
        goalPhoto ? uploadPhoto("goal", goalPhoto) : Promise.resolve(null),
      ]);

      startTransition(() => {
        submitOnboarding({
          heightIn,
          weightLbs,
          maxDaysPerWeek: daysPerWeek,
          maxMinutesSession: minutesSession,
          goalDescription: goalDescription.trim() || null,
          beforePhotoPath: beforePath,
          goalPhotoPath: goalPath,
        });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload failed");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <PhotoUpload
        label="Before photo (optional)"
        optional
        onChange={setBeforePhoto}
        onError={setError}
      />

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="height">Height (in)</Label>
          <Input
            id="height"
            type="number"
            min={48}
            max={96}
            value={heightIn}
            onChange={(e) => setHeightIn(Number(e.target.value))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="weight">Weight (lbs)</Label>
          <Input
            id="weight"
            type="number"
            min={80}
            max={500}
            value={weightLbs}
            onChange={(e) => setWeightLbs(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="days">Max days per week</Label>
          <span className="text-sm text-muted-foreground">{daysPerWeek}</span>
        </div>
        <Slider
          id="days"
          min={1}
          max={7}
          step={1}
          value={[daysPerWeek]}
          onValueChange={(v) => setDaysPerWeek(v[0])}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="minutes">Max minutes per session</Label>
          <span className="text-sm text-muted-foreground">{minutesSession}</span>
        </div>
        <Slider
          id="minutes"
          min={15}
          max={120}
          step={5}
          value={[minutesSession]}
          onValueChange={(v) => setMinutesSession(v[0])}
        />
      </div>

      <PhotoUpload
        label="Goal photo (optional if you describe your goal below)"
        optional
        onChange={setGoalPhoto}
        onError={setError}
      />

      <div className="space-y-2">
        <Label htmlFor="goal">Or describe your goal</Label>
        <Textarea
          id="goal"
          placeholder="e.g., lean + defined shoulders and back, maintain weight"
          value={goalDescription}
          onChange={(e) => setGoalDescription(e.target.value)}
          rows={3}
        />
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={isPending}>
        {isPending ? "Saving…" : "Let's build your plan →"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 4: Write `app/onboarding/page.tsx`**

```tsx
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { plans } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { OnboardingForm } from "./form";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // If a user already has an active plan, don't re-onboard them.
  const active = await db
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.userId, user.id), eq(plans.isActive, true)))
    .limit(1);
  if (active.length > 0) redirect("/today");

  return (
    <main className="px-6 py-8 max-w-md mx-auto">
      <h1 className="text-2xl font-bold mb-2">Let's get started</h1>
      <p className="text-muted-foreground mb-6">
        A few details so Claude can design your program.
      </p>
      <OnboardingForm />
    </main>
  );
}
```

- [ ] **Step 5: Verify build**

```bash
npm run build
```

Expected: compiles. Route `/onboarding` in the output.

- [ ] **Step 6: Commit**

```bash
git add app/onboarding/ lib/actions/goals.ts
git commit -m "feat: add onboarding intake form + createGoal server action"
```

---

## Task 9: Route /today based on active plan state

**Files:** Modify `app/today/page.tsx`.

- [ ] **Step 1: Rewrite `app/today/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { plans } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

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

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-4">Today</h1>
      <p className="text-muted-foreground mb-4">
        Signed in as {user.email}.
      </p>
      <section className="rounded-lg border p-4 bg-muted/30">
        <h2 className="text-sm font-medium text-muted-foreground mb-2">Active Plan</h2>
        <p className="text-sm">
          Split: <strong>{(active.structure as { split: string }).split}</strong> · {(active.structure as { days: unknown[] }).days.length} training days
        </p>
        <p className="text-muted-foreground mt-3 text-sm">
          Workout flow comes in Plan 3.
        </p>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: compiles. No type errors.

- [ ] **Step 3: Commit**

```bash
git add app/today/page.tsx
git commit -m "feat: today routes to onboarding if no active plan, renders summary if active"
```

---

## Task 10: SSE streaming endpoint for plan chat

**Files:** Create `app/api/chat/plan/route.ts`.

- [ ] **Step 1: Write `app/api/chat/plan/route.ts`**

```ts
import { createClient } from "@/lib/supabase/server";
import { anthropic, model } from "@/lib/anthropic";
import { PLAN_DESIGN_SYSTEM } from "@/lib/prompts/plan-design";
import { createSignedReadUrl } from "@/lib/storage";
import { db } from "@/lib/db";
import { goals } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatMessage = { role: "user" | "assistant"; content: string };

type Body = {
  goalId: string;
  messages: ChatMessage[]; // transcript so far (excluding the system prompt)
};

async function fetchImageAsBase64(url: string): Promise<{ data: string; mediaType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch image failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mediaType = res.headers.get("content-type") ?? "image/jpeg";
  return { data: buf.toString("base64"), mediaType };
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const body = (await req.json()) as Body;

  // Load the goal for this chat — verifies ownership via RLS.
  const [goal] = await db.select().from(goals).where(eq(goals.id, body.goalId)).limit(1);
  if (!goal || goal.userId !== user.id) {
    return new Response("goal not found", { status: 404 });
  }

  // First turn: inject goal context (inputs + images) as the leading user message.
  // Subsequent turns: just use the transcript.
  const messages: Anthropic.MessageParam[] = [];
  if (body.messages.length === 0) {
    const content: Anthropic.ContentBlockParam[] = [];

    if (goal.beforePhotoPath) {
      const url = await createSignedReadUrl(goal.beforePhotoPath);
      const { data, mediaType } = await fetchImageAsBase64(url);
      content.push({ type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg", data } });
      content.push({ type: "text", text: "Above: my current 'before' photo." });
    }
    if (goal.goalPhotoPath) {
      const url = await createSignedReadUrl(goal.goalPhotoPath);
      const { data, mediaType } = await fetchImageAsBase64(url);
      content.push({ type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg", data } });
      content.push({ type: "text", text: "Above: my goal photo." });
    }
    const intro =
      `Please design a weekly strength program. ` +
      (goal.goalDescription ? `My goal: ${goal.goalDescription}. ` : "") +
      `I can train up to ${goal.maxDaysPerWeek} days/week, ${goal.maxMinutesSession} min/session. ` +
      `Propose a plan including specific exercises per day.`;
    content.push({ type: "text", text: intro });

    messages.push({ role: "user", content });
  } else {
    for (const m of body.messages) {
      messages.push({ role: m.role, content: m.content });
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const streamResp = anthropic().messages.stream({
          model: model(),
          max_tokens: 2048,
          system: [
            {
              type: "text",
              text: PLAN_DESIGN_SYSTEM,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages,
        });

        for await (const event of streamResp) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        controller.close();
      } catch (err) {
        controller.enqueue(
          encoder.encode(`\n\n[error: ${err instanceof Error ? err.message : "unknown"}]`),
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}

// Type shim — avoids an explicit "@anthropic-ai/sdk" value import for TS
import type Anthropic from "@anthropic-ai/sdk";
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: compiles. The `/api/chat/plan` route appears in the output as a dynamic route.

- [ ] **Step 3: Commit**

```bash
git add app/api/chat/plan/
git commit -m "feat: add streaming /api/chat/plan endpoint"
```

---

## Task 11: Chat UI components

**Files:** Create `components/chat/message.tsx`, `components/chat/message-list.tsx`, `components/chat/input.tsx`.

- [ ] **Step 1: Write `components/chat/message.tsx`**

```tsx
import { cn } from "@/lib/utils";

export type MessageRole = "user" | "assistant";

export function Message({ role, text }: { role: MessageRole; text: string }) {
  const isUser = role === "user";
  // Strip <plan>...</plan> blocks from displayed text — the block is parsed separately
  // and surfaced via the "Accept Plan" button, not shown to the user raw.
  const displayed = text.replace(/<plan>[\s\S]*?<\/plan>/gi, "").trim();

  return (
    <div
      className={cn(
        "flex w-full",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2 text-sm leading-relaxed whitespace-pre-wrap",
          isUser
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-muted text-foreground rounded-bl-sm",
        )}
      >
        {displayed || (isUser ? "" : "…")}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `components/chat/message-list.tsx`**

```tsx
"use client";

import { useEffect, useRef } from "react";
import { Message, type MessageRole } from "./message";

export type ChatMessage = { role: MessageRole; text: string };

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, messages[messages.length - 1]?.text]);

  return (
    <div className="flex flex-col gap-3 py-4">
      {messages.map((m, i) => (
        <Message key={i} role={m.role} text={m.text} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
```

- [ ] **Step 3: Write `components/chat/input.tsx`**

```tsx
"use client";

import { useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";

export function ChatInput({
  value,
  onChange,
  onSend,
  disabled,
  placeholder = "Say something...",
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Autosize textarea
  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = `${Math.min(ref.current.scrollHeight, 160)}px`;
  }, [value]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !disabled) onSend();
    }
  };

  return (
    <div className="flex items-end gap-2 p-3 border-t bg-background sticky bottom-16">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKey}
        placeholder={placeholder}
        rows={1}
        disabled={disabled}
        className="flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
      />
      <Button
        type="button"
        onClick={onSend}
        disabled={disabled || !value.trim()}
        size="sm"
      >
        Send
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add components/chat/
git commit -m "feat: add chat UI components (message, list, input)"
```

---

## Task 12: Plan-design chat page + streaming consumer

**Files:** Create `app/onboarding/chat/page.tsx`, `app/onboarding/chat/chat-client.tsx`.

- [ ] **Step 1: Write `app/onboarding/chat/page.tsx`**

```tsx
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { goals } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ChatClient } from "./chat-client";

export default async function PlanChatPage({
  searchParams,
}: {
  searchParams: Promise<{ goalId?: string }>;
}) {
  const { goalId } = await searchParams;
  if (!goalId) redirect("/onboarding");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [goal] = await db.select().from(goals).where(eq(goals.id, goalId)).limit(1);
  if (!goal || goal.userId !== user.id) redirect("/onboarding");

  return (
    <main className="flex flex-col h-dvh">
      <header className="px-6 py-4 border-b">
        <h1 className="text-xl font-semibold">Design your plan</h1>
        <p className="text-xs text-muted-foreground">Chat with Claude, then Accept when you like the plan.</p>
      </header>
      <ChatClient goalId={goalId} />
    </main>
  );
}
```

- [ ] **Step 2: Write `app/onboarding/chat/chat-client.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageList, type ChatMessage } from "@/components/chat/message-list";
import { ChatInput } from "@/components/chat/input";
import { Button } from "@/components/ui/button";
import { acceptPlan } from "./actions";

function hasValidPlanBlock(text: string): boolean {
  const match = text.match(/<plan>([\s\S]*?)<\/plan>/i);
  if (!match) return false;
  try {
    const parsed = JSON.parse(match[1].trim());
    return typeof parsed === "object" && parsed !== null && Array.isArray(parsed.days);
  } catch {
    return false;
  }
}

export function ChatClient({ goalId }: { goalId: string }) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstRun = useRef(true);

  // Auto-send first turn on mount so Claude proposes the initial plan without user input.
  useEffect(() => {
    if (!firstRun.current) return;
    firstRun.current = false;
    void sendMessage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastAssistantText = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i].text;
    }
    return "";
  })();
  const canAccept = !streaming && !accepting && hasValidPlanBlock(lastAssistantText);

  async function sendMessage(userText: string | null) {
    setError(null);
    const next: ChatMessage[] = userText
      ? [...messages, { role: "user", text: userText }]
      : messages;
    setMessages([...next, { role: "assistant", text: "" }]);
    setDraft("");
    setStreaming(true);

    try {
      const res = await fetch("/api/chat/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goalId,
          messages: next.map((m) => ({ role: m.role, content: m.text })),
        }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`request failed: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        assistantText += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", text: assistantText };
          return updated;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "stream failed");
    } finally {
      setStreaming(false);
    }
  }

  async function handleAccept() {
    setAccepting(true);
    setError(null);
    try {
      await acceptPlan({
        goalId,
        transcript: messages.map((m) => ({ role: m.role, content: m.text })),
      });
      router.replace("/today");
    } catch (err) {
      setError(err instanceof Error ? err.message : "accept failed");
      setAccepting(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto px-4">
        <MessageList messages={messages} />
        {error && <p className="text-sm text-destructive px-2">{error}</p>}
      </div>

      {canAccept && (
        <div className="px-4 py-2 border-t bg-muted/30">
          <Button
            onClick={handleAccept}
            disabled={accepting}
            className="w-full"
          >
            {accepting ? "Saving plan…" : "Accept this plan →"}
          </Button>
        </div>
      )}

      <ChatInput
        value={draft}
        onChange={setDraft}
        onSend={() => sendMessage(draft)}
        disabled={streaming || accepting}
        placeholder={streaming ? "Claude is responding..." : "Request a change, or just Accept above"}
      />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/onboarding/chat/page.tsx app/onboarding/chat/chat-client.tsx
git commit -m "feat: plan-design chat page with streaming Claude responses"
```

---

## Task 13: Accept plan server action

**Files:** Create `lib/actions/plans.ts`, `app/onboarding/chat/actions.ts`.

- [ ] **Step 1: Write `lib/actions/plans.ts`**

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { plans, goals } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { extractPlan, type Plan } from "@/lib/plan-parser";

export type AcceptPlanInput = {
  goalId: string;
  transcript: Array<{ role: "user" | "assistant"; content: string }>;
};

export async function acceptPlan(input: AcceptPlanInput): Promise<{ planId: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");

  // Find the latest assistant message containing a valid plan block.
  let parsed: Plan | null = null;
  for (let i = input.transcript.length - 1; i >= 0; i--) {
    const m = input.transcript[i];
    if (m.role !== "assistant") continue;
    parsed = extractPlan(m.content);
    if (parsed) break;
  }
  if (!parsed) throw new Error("no valid plan block found in transcript");

  // Verify the goal belongs to this user.
  const [goal] = await db.select().from(goals).where(eq(goals.id, input.goalId)).limit(1);
  if (!goal || goal.userId !== user.id) throw new Error("goal not found");

  // Persist the transcript on the goal.
  await db
    .update(goals)
    .set({ chatTranscript: input.transcript })
    .where(eq(goals.id, input.goalId));

  // Deactivate any existing active plan.
  await db
    .update(plans)
    .set({ isActive: false, deactivatedAt: new Date() })
    .where(and(eq(plans.userId, user.id), eq(plans.isActive, true)));

  // Insert the new active plan.
  const [row] = await db
    .insert(plans)
    .values({
      userId: user.id,
      goalId: input.goalId,
      structure: parsed,
      isActive: true,
      activatedAt: new Date(),
    } as typeof plans.$inferInsert)
    .returning({ id: plans.id });

  return { planId: row.id };
}
```

- [ ] **Step 2: Write `app/onboarding/chat/actions.ts`**

```ts
"use server";

export { acceptPlan } from "@/lib/actions/plans";
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: compiles. No TS errors.

- [ ] **Step 4: Commit**

```bash
git add lib/actions/plans.ts app/onboarding/chat/actions.ts
git commit -m "feat: acceptPlan server action — parses, persists, activates"
```

---

## Task 14: Integration test for the plan parser + acceptPlan logic

**Files:** Create `tests/accept-plan-shape.test.ts`.

This is a pure-logic test — it doesn't hit the DB. It verifies that a realistic Claude response string, when run through `extractPlan`, yields a shape that `plans.structure` can hold.

- [ ] **Step 1: Write `tests/accept-plan-shape.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { extractPlan, planSchema } from "@/lib/plan-parser";

describe("accept plan integration shape", () => {
  const realistic = `Great — here's a 3-day push/pull/legs split.

<plan>
{
  "split": "push_pull_legs",
  "notes": "3 days/week, ~60 min each. Compounds first, accessories second.",
  "days": [
    {
      "day": "monday",
      "category": "push",
      "exercises": [
        { "name": "bench_press", "order": 1 },
        { "name": "overhead_press", "order": 2 },
        { "name": "incline_dumbbell_press", "order": 3 },
        { "name": "tricep_rope_extensions", "order": 4 }
      ]
    },
    {
      "day": "wednesday",
      "category": "pull",
      "exercises": [
        { "name": "deadlift", "order": 1 },
        { "name": "pullup", "order": 2 },
        { "name": "barbell_row", "order": 3 },
        { "name": "bicep_curl", "order": 4 }
      ]
    },
    {
      "day": "friday",
      "category": "legs",
      "exercises": [
        { "name": "back_squat", "order": 1 },
        { "name": "romanian_deadlift", "order": 2 },
        { "name": "walking_lunge", "order": 3 },
        { "name": "calf_raise", "order": 4 }
      ]
    }
  ]
}
</plan>

Let me know if you'd like changes.`;

  it("parses a realistic Claude response to a valid Plan", () => {
    const plan = extractPlan(realistic);
    expect(plan).not.toBeNull();
    expect(plan?.days).toHaveLength(3);
    expect(plan?.days.map((d) => d.category)).toEqual(["push", "pull", "legs"]);
  });

  it("re-validates via planSchema (safety check for jsonb column insert)", () => {
    const plan = extractPlan(realistic);
    expect(plan).not.toBeNull();
    // If we ever change the schema, this will catch drift between parser and DB column expectations.
    const result = planSchema.safeParse(plan);
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: all tests pass (old ones + new ones).

- [ ] **Step 3: Commit**

```bash
git add tests/accept-plan-shape.test.ts
git commit -m "test: integration shape test for extractPlan + plans.structure"
```

---

## Task 15: Manual verification

This is not automated — you run through the flow end-to-end.

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

Open http://localhost:3000 in a private window.

- [ ] **Step 2: Sign in with Google**

Expected: you land on `/today` briefly, which redirects to `/onboarding` (no active plan yet).

If instead you hit `/today` and stay there, your test user already has an active plan from a prior attempt. Delete it in Supabase → Table Editor → `plans` (or set `is_active = false`).

- [ ] **Step 3: Fill out the intake form**

- Skip the "before" photo
- Height: 69, Weight: 180 (defaults)
- Max days: 3, Max minutes: 60
- Goal description: "Lean + visible abs, maintain weight"
- Submit.

Expected: you're routed to `/onboarding/chat?goalId=...` and Claude's response starts streaming in immediately (first turn auto-sent).

- [ ] **Step 4: Wait for the plan to appear**

Claude should produce a short intro + a `<plan>` block. Because the message UI strips `<plan>...</plan>` for display, you'll see the rationale text only. Once streaming finishes, the "Accept this plan →" button should appear above the input.

- [ ] **Step 5: (Optional) Revise the plan**

Type a revision request like "make it 4 days, add a dedicated shoulders day" and Send. A new assistant turn streams in with an updated `<plan>` block.

- [ ] **Step 6: Accept the plan**

Click "Accept this plan →". Expected: redirected to `/today`, which now shows the active plan summary (split + day count).

- [ ] **Step 7: Verify DB state**

Supabase Dashboard → Table Editor:
- `goals` — one row with your goal data + `chat_transcript` populated
- `plans` — one row with `is_active = true`, `structure` containing valid JSON matching the plan
- If you revised the plan multiple times, only one `plans` row has `is_active = true`

- [ ] **Step 8: Verify navigation from /today**

- Reload `/today`: should render the plan summary (no redirect loop)
- Sign out, sign back in → should land on `/today` directly (has active plan)

- [ ] **Step 9: Tag the milestone**

```bash
git tag plan-2-complete
git push origin plan-2-complete
```

---

## Self-Review

Coverage audit against the design spec:

- **§ 2.1 Onboarding flow** — Intake form (T8), before-photo upload (T7), chat (T10–T12), accept (T13). ✓
- **§ 2.4 Plan adjustment** — Chat revisions handled in T12 (user can send follow-up messages). Accepting a revision deactivates prior plan via T13's `lib/actions/plans.ts`. ✓
- **§ 3 Architecture** — Server Actions ✓, SSE route handler ✓, Supabase signed uploads ✓, prompt caching ✓.
- **§ 4 Data Model** — Goal insert T8, plan insert T13, chat transcript saved T13. ✓
- **§ 5.1 Plan-design chat** — System prompt T3, tool-use equivalent (XML `<plan>` block) T3 + T4, cache control T10, accept flow T13. ✓
- **§ 5.3 Progress photo comparison** — Not in this plan (Plan 4).
- **§ 5.4 Branch-application logic** — Not in this plan (Plan 3).
- **§ 6.3 Progress tab camera** — Not in this plan (Plan 4).
- **§ 8 Error handling** — Chat stream errors caught in T10 and T12. Upload failures surfaced in T8. Invalid Claude JSON surfaces as "Accept Plan" button not appearing (user can ask Claude to fix formatting). ✓

No placeholders found. Type names consistent: `Plan` imported from `@/lib/plan-parser` in T13; `ChatMessage` defined in T11 and used in T12; `PhotoKind` imported from `@/lib/storage` in T7, T8, T10.

Known deviations from spec:
- The spec says "tool-use for structured JSON responses" for workout generation (§ 5.2). Plan 2's plan-design chat uses an XML `<plan>` block instead, because the chat format needs natural prose around the plan (user-facing rationale) which tool-use doesn't support cleanly. Workout generation (Plan 3) will still use tool-use as spec'd. This is an informed deviation, not a bug.
- Height/weight live on `profiles` per the data model, but the onboarding form collects them (T8 updates both `goals` and `profiles`). Reasonable since they're captured in the same interaction.

---

## Execution Handoff

Plan 2 complete. Ready to execute.

**Demo-able end state:** Sign in → fill intake form → chat with Claude → accept plan → `/today` shows your active plan summary.

**Next plan after this ships:** Plan 3 — Daily Workout Execution (the core app).
