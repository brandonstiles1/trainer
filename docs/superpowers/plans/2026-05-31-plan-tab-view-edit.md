# Plan Tab — View & Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `/plan` tab show the user's active workout plan and let them edit it (or design a fresh one) by chatting with Claude, with accepted edits creating a new plan version and adjusting today's in-progress workout.

**Architecture:** Render the active plan on `/plan` (server component, mirrors `/today`). Generalize the existing onboarding plan-design chat into a shared `<PlanDesignChat>` client component parameterized by mode. Extend the existing `/api/chat/plan` streaming route with a `mode` field via a pure, unit-tested message-assembly helper. Extend `acceptPlan` to regenerate today's not-yet-started sets via the existing `generateWorkout`, using a pure, unit-tested diff helper.

**Tech Stack:** Next.js (App Router, server components + server actions), Drizzle ORM (postgres-js), Supabase auth, Anthropic SDK (streaming + tool-use), Vitest, Tailwind/shadcn UI.

**Spec:** `docs/superpowers/specs/2026-05-31-plan-tab-view-edit-design.md`

---

## File Structure

- `lib/chat/assemble-plan-messages.ts` — **new.** Pure function turning (contextBlocks, transcript) into Anthropic `MessageParam[]` with valid role alternation. No I/O.
- `tests/assemble-plan-messages.test.ts` — **new.** Unit tests for the assembler.
- `app/api/chat/plan/route.ts` — **modify.** Accept `mode`, build context blocks per mode (incl. current plan for edit), delegate ordering to the assembler.
- `app/plan/page.tsx` — **modify.** Replace stub with the active-plan week view + Edit / Fresh buttons.
- `components/chat/plan-design-chat.tsx` — **new.** Shared chat client (extracted from onboarding), parameterized by `{ goalId, mode, autoSendFirst, redirectTo }`.
- `app/onboarding/chat/chat-client.tsx` — **modify.** Thin wrapper over `<PlanDesignChat>` (preserves onboarding behavior).
- `app/plan/chat/page.tsx` — **new.** Loads active plan → goalId, renders `<PlanDesignChat>` in edit/new mode.
- `lib/workouts/plan-today-diff.ts` — **new.** Pure function computing which sets to delete / exercises to regenerate when a plan changes mid-day.
- `tests/plan-today-diff.test.ts` — **new.** Unit tests for the diff.
- `lib/actions/workouts.ts` — **modify.** Export `generateWorkout`; add `adjustTodayWorkout`.
- `lib/actions/plans.ts` — **modify.** Call `adjustTodayWorkout` after inserting the new plan.

---

## Task 1: Pure message-assembly helper

**Files:**
- Create: `lib/chat/assemble-plan-messages.ts`
- Test: `tests/assemble-plan-messages.test.ts`

Background: Anthropic requires messages to alternate user/assistant and to start with `user`. The route already injects "context" (goal photos + an intro) on the first turn. For edit mode we also inject the current plan JSON. To keep this testable without hitting the network, the route builds the context blocks and this pure helper does the ordering/merging.

- [ ] **Step 1: Write the failing test**

```ts
// tests/assemble-plan-messages.test.ts
import { describe, it, expect } from "vitest";
import { assemblePlanMessages } from "@/lib/chat/assemble-plan-messages";

const ctx = [{ type: "text", text: "CONTEXT" }] as const;

describe("assemblePlanMessages", () => {
  it("empty transcript → single user message holding the context (new mode, auto-send)", () => {
    const out = assemblePlanMessages({ contextBlocks: [...ctx], transcript: [] });
    expect(out).toEqual([{ role: "user", content: [{ type: "text", text: "CONTEXT" }] }]);
  });

  it("transcript starting with a user turn → context prepended into that first user message", () => {
    const out = assemblePlanMessages({
      contextBlocks: [...ctx],
      transcript: [{ role: "user", content: "emphasize shoulders" }],
    });
    expect(out).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "CONTEXT" },
          { type: "text", text: "emphasize shoulders" },
        ],
      },
    ]);
  });

  it("transcript starting with an assistant turn → used as-is, no context injected", () => {
    const transcript = [
      { role: "assistant" as const, content: "here is a plan" },
      { role: "user" as const, content: "change it" },
    ];
    const out = assemblePlanMessages({ contextBlocks: [...ctx], transcript });
    expect(out).toEqual([
      { role: "assistant", content: "here is a plan" },
      { role: "user", content: "change it" },
    ]);
  });

  it("multi-turn edit transcript keeps alternation and prepends context to the first user turn", () => {
    const transcript = [
      { role: "user" as const, content: "emphasize shoulders" },
      { role: "assistant" as const, content: "revised plan" },
      { role: "user" as const, content: "now add arms" },
    ];
    const out = assemblePlanMessages({ contextBlocks: [...ctx], transcript });
    expect(out[0]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "CONTEXT" },
        { type: "text", text: "emphasize shoulders" },
      ],
    });
    expect(out[1]).toEqual({ role: "assistant", content: "revised plan" });
    expect(out[2]).toEqual({ role: "user", content: "now add arms" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/assemble-plan-messages.test.ts`
Expected: FAIL — cannot find module `@/lib/chat/assemble-plan-messages`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/chat/assemble-plan-messages.ts
import type {
  MessageParam,
  ContentBlockParam,
} from "@anthropic-ai/sdk/resources/messages/messages";

export type TranscriptMessage = { role: "user" | "assistant"; content: string };

/**
 * Order a plan-design chat transcript into Anthropic messages.
 *
 * `contextBlocks` are the server-built leading blocks (goal photos + intro, and for
 * edit mode the current plan JSON). They are injected ONLY when the conversation
 * would otherwise begin with a user turn:
 *   - empty transcript  → context becomes the sole first user message (new-mode auto-send)
 *   - transcript[0] is a user turn → context is prepended into that message's content
 *   - transcript[0] is an assistant turn → transcript is used verbatim (later turns)
 * This keeps roles alternating and the conversation starting with `user`.
 */
export function assemblePlanMessages(params: {
  contextBlocks: ContentBlockParam[];
  transcript: TranscriptMessage[];
}): MessageParam[] {
  const { contextBlocks, transcript } = params;

  if (transcript.length === 0) {
    return [{ role: "user", content: contextBlocks }];
  }

  if (transcript[0].role !== "user") {
    return transcript.map((m) => ({ role: m.role, content: m.content }));
  }

  const [first, ...rest] = transcript;
  return [
    { role: "user", content: [...contextBlocks, { type: "text", text: first.content }] },
    ...rest.map((m) => ({ role: m.role, content: m.content })),
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/assemble-plan-messages.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/chat/assemble-plan-messages.ts tests/assemble-plan-messages.test.ts
git commit -m "feat: pure plan-chat message assembler"
```

---

## Task 2: Add `mode` to the plan-chat route

**Files:**
- Modify: `app/api/chat/plan/route.ts`

The route currently builds first-turn context (photos + a "design a program" intro) only when `messages.length === 0`. Refactor it to: accept `mode`, build context blocks per mode (edit mode also loads the active plan and includes its JSON), and hand ordering to `assemblePlanMessages`. Photos/current-plan are built only when context will actually be injected (transcript empty, or first transcript message is a user turn).

- [ ] **Step 1: Update the body type and add plan import**

Replace the imports block and `Body` type at the top of `app/api/chat/plan/route.ts`. The current imports are:

```ts
import { createClient } from "@/lib/supabase/server";
import { anthropic, model } from "@/lib/anthropic";
import { PLAN_DESIGN_SYSTEM } from "@/lib/prompts/plan-design";
import { createSignedReadUrl } from "@/lib/storage";
import { db } from "@/lib/db";
import { goals } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type {
  MessageParam,
  ContentBlockParam,
} from "@anthropic-ai/sdk/resources/messages/messages";
```

Change to:

```ts
import { createClient } from "@/lib/supabase/server";
import { anthropic, model } from "@/lib/anthropic";
import { PLAN_DESIGN_SYSTEM } from "@/lib/prompts/plan-design";
import { createSignedReadUrl } from "@/lib/storage";
import { db } from "@/lib/db";
import { goals, plans } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { assemblePlanMessages } from "@/lib/chat/assemble-plan-messages";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages/messages";
```

And change the `Body` type from:

```ts
type Body = {
  goalId: string;
  messages: ChatMessage[]; // transcript so far (excluding the system prompt)
};
```

to:

```ts
type Body = {
  goalId: string;
  mode?: "new" | "edit"; // default "new"
  messages: ChatMessage[]; // transcript so far (excluding the system prompt)
};
```

- [ ] **Step 2: Replace the message-building block**

Replace the entire block that currently builds `messages` (from `const messages: MessageParam[] = [];` through the closing of the `else` branch that maps `body.messages`) with the following. This sits after the goal ownership check (`if (!goal || goal.userId !== user.id) { ... }`):

```ts
  const mode = body.mode ?? "new";

  // Only build (and fetch) context when the conversation would otherwise begin
  // with a user turn — i.e. there's nothing yet, or the first turn is the user's.
  const willInject =
    body.messages.length === 0 || body.messages[0].role === "user";

  const contextBlocks: ContentBlockParam[] = [];
  if (willInject) {
    // Photos: only on the genuinely first injected turn to avoid re-sending them.
    const firstInjectedTurn =
      mode === "edit" ? body.messages.length <= 1 : body.messages.length === 0;

    if (firstInjectedTurn && goal.beforePhotoPath) {
      const url = await createSignedReadUrl(goal.beforePhotoPath);
      const { data, mediaType } = await fetchImageAsBase64(url);
      contextBlocks.push({ type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg", data } });
      contextBlocks.push({ type: "text", text: "Above: my current 'before' photo." });
    }
    if (firstInjectedTurn && goal.goalPhotoPath) {
      const url = await createSignedReadUrl(goal.goalPhotoPath);
      const { data, mediaType } = await fetchImageAsBase64(url);
      contextBlocks.push({ type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg", data } });
      contextBlocks.push({ type: "text", text: "Above: my goal photo." });
    }

    if (mode === "edit") {
      const [activePlan] = await db
        .select()
        .from(plans)
        .where(and(eq(plans.userId, user.id), eq(plans.isActive, true)))
        .limit(1);
      const planJson = activePlan ? JSON.stringify(activePlan.structure) : "{}";
      contextBlocks.push({
        type: "text",
        text:
          `Here is my current active plan as JSON:\n${planJson}\n\n` +
          `I want to adjust it. Read my requested change below, then return a revised ` +
          `<plan> block reflecting that change while keeping everything else stable.`,
      });
    } else {
      contextBlocks.push({
        type: "text",
        text:
          `Please design a weekly strength program. ` +
          (goal.goalDescription ? `My goal: ${goal.goalDescription}. ` : "") +
          `I can train up to ${goal.maxDaysPerWeek} days/week, ${goal.maxMinutesSession} min/session. ` +
          `Propose a plan including specific exercises per day.`,
      });
    }
  }

  const messages = assemblePlanMessages({
    contextBlocks,
    transcript: body.messages,
  });
```

Note: `fetchImageAsBase64` and the `ChatMessage` type already exist in this file — leave them. The `MessageParam` import was removed because `assemblePlanMessages` now owns that type; if any other reference to `MessageParam` remains in the file, keep its import instead.

- [ ] **Step 3: Verify the route still type-checks and tests pass**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all existing tests + Task 1 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add app/api/chat/plan/route.ts
git commit -m "feat: plan-chat route supports edit mode (seeds current plan)"
```

---

## Task 3: Extract shared `<PlanDesignChat>` component

**Files:**
- Create: `components/chat/plan-design-chat.tsx`
- Modify: `app/onboarding/chat/chat-client.tsx`

Move the existing onboarding chat logic into a reusable component. The only new behavior vs. today: it sends `mode` in the request body, only auto-sends the first turn when `autoSendFirst` is true, and redirects to a configurable path on accept.

- [ ] **Step 1: Create the shared component**

```tsx
// components/chat/plan-design-chat.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageList, type ChatMessage } from "@/components/chat/message-list";
import { ChatInput } from "@/components/chat/input";
import { Button } from "@/components/ui/button";
import { acceptPlan } from "@/app/onboarding/chat/actions";

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

export function PlanDesignChat({
  goalId,
  mode,
  autoSendFirst,
  redirectTo,
}: {
  goalId: string;
  mode: "new" | "edit";
  autoSendFirst: boolean;
  redirectTo: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstRun = useRef(true);

  // Auto-send the first turn only when asked (new-plan flow proposes immediately;
  // edit flow waits for the user to describe a change).
  useEffect(() => {
    if (!firstRun.current) return;
    firstRun.current = false;
    if (autoSendFirst) void sendMessage(null);
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
          mode,
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
      router.replace(redirectTo);
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
          <Button onClick={handleAccept} disabled={accepting} className="w-full">
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

- [ ] **Step 2: Replace the onboarding chat-client with a thin wrapper**

Replace the entire contents of `app/onboarding/chat/chat-client.tsx` with:

```tsx
"use client";

import { PlanDesignChat } from "@/components/chat/plan-design-chat";

export function ChatClient({ goalId }: { goalId: string }) {
  return (
    <PlanDesignChat goalId={goalId} mode="new" autoSendFirst redirectTo="/today" />
  );
}
```

- [ ] **Step 3: Verify type-check and tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add components/chat/plan-design-chat.tsx app/onboarding/chat/chat-client.tsx
git commit -m "refactor: extract shared PlanDesignChat from onboarding"
```

---

## Task 4: `/plan` page — render the active plan

**Files:**
- Modify: `app/plan/page.tsx`

- [ ] **Step 1: Replace the stub**

```tsx
// app/plan/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { plans } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { Button } from "@/components/ui/button";

type PlanStructure = {
  split: string;
  notes?: string;
  days: Array<{
    day: string;
    category: string;
    exercises: Array<{ name: string; order: number; notes?: string }>;
  }>;
};

const WEEKDAY_ORDER = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
];

export default async function PlanPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [active] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.userId, user.id), eq(plans.isActive, true)))
    .limit(1);
  if (!active) redirect("/onboarding");

  const structure = active.structure as PlanStructure;
  const days = structure.days
    .slice()
    .sort((a, b) => WEEKDAY_ORDER.indexOf(a.day) - WEEKDAY_ORDER.indexOf(b.day));

  return (
    <main className="px-6 py-8 max-w-md mx-auto space-y-6 pb-24">
      <div>
        <h1 className="text-2xl font-bold">Plan</h1>
        <p className="text-sm text-muted-foreground capitalize">
          {structure.split.replace(/_/g, " ")}
        </p>
        {structure.notes && (
          <p className="text-sm text-muted-foreground mt-2">{structure.notes}</p>
        )}
      </div>

      <section className="space-y-3">
        {days.map((d) => (
          <div key={d.day} className="rounded-lg border p-4 bg-muted/30">
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-medium capitalize">{d.day}</p>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">
                {d.category.replace(/_/g, " ")}
              </p>
            </div>
            <ul className="mt-2 space-y-1 text-sm">
              {d.exercises
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((e) => (
                  <li key={e.name}>{e.name.replace(/_/g, " ")}</li>
                ))}
            </ul>
          </div>
        ))}
      </section>

      <div className="space-y-2">
        <Button asChild className="w-full">
          <Link href="/plan/chat?mode=edit">Edit with Claude</Link>
        </Button>
        <Button asChild variant="outline" className="w-full">
          <Link href="/plan/chat?mode=new">Start a fresh plan</Link>
        </Button>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify the Button `asChild` prop exists**

Run: `grep -n "asChild" components/ui/button.tsx`
Expected: a match (shadcn Button supports `asChild` via Radix Slot). If there is **no** match, replace each `<Button asChild …><Link …>label</Link></Button>` with `<Link className={buttonVariants({ variant })} …>label</Link>` importing `buttonVariants` from the same file, or simply wrap a plain `<Link>` styled with the existing button classes. Do not invent an API.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/plan/page.tsx
git commit -m "feat: /plan renders active plan week + edit/fresh actions"
```

---

## Task 5: `/plan/chat` page

**Files:**
- Create: `app/plan/chat/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
// app/plan/chat/page.tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { plans } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { PlanDesignChat } from "@/components/chat/plan-design-chat";

export default async function PlanChatPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode: rawMode } = await searchParams;
  const mode = rawMode === "new" ? "new" : "edit";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [active] = await db
    .select({ goalId: plans.goalId })
    .from(plans)
    .where(and(eq(plans.userId, user.id), eq(plans.isActive, true)))
    .limit(1);
  if (!active) redirect("/onboarding");

  return (
    <main className="flex flex-col h-dvh">
      <header className="px-6 py-4 border-b">
        <h1 className="text-xl font-semibold">
          {mode === "new" ? "Design a fresh plan" : "Edit your plan"}
        </h1>
        <p className="text-xs text-muted-foreground">
          {mode === "new"
            ? "Chat with Claude, then Accept when you like the plan."
            : "Tell Claude what to change, then Accept the revised plan."}
        </p>
      </header>
      <PlanDesignChat
        goalId={active.goalId}
        mode={mode}
        autoSendFirst={mode === "new"}
        redirectTo="/plan"
      />
    </main>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/plan/chat/page.tsx
git commit -m "feat: /plan/chat page for editing or creating a plan"
```

---

## Task 6: Pure `planTodayDiff` helper

**Files:**
- Create: `lib/workouts/plan-today-diff.ts`
- Test: `tests/plan-today-diff.test.ts`

This isolates the set-diffing rule from DB/Anthropic I/O. Rule: an exercise is "started" if it has ≥1 set with a non-null `completedAt`. Started exercises are left fully intact. Every set belonging to a not-started exercise is deleted, and the new plan day's not-started exercises are (re)generated.

- [ ] **Step 1: Write the failing test**

```ts
// tests/plan-today-diff.test.ts
import { describe, it, expect } from "vitest";
import { planTodayDiff } from "@/lib/workouts/plan-today-diff";

type Set = { id: string; exerciseName: string; completedAt: Date | null };

describe("planTodayDiff", () => {
  it("preserves started exercises and replaces everything not started", () => {
    const existingSets: Set[] = [
      { id: "a1", exerciseName: "bench_press", completedAt: new Date() }, // started
      { id: "a2", exerciseName: "bench_press", completedAt: null },       // started exercise → keep
      { id: "b1", exerciseName: "overhead_press", completedAt: null },    // not started → delete
      { id: "c1", exerciseName: "tricep_rope_extensions", completedAt: null }, // removed from plan → delete
    ];
    const newDayExercises = ["bench_press", "overhead_press", "lateral_raise"];

    const diff = planTodayDiff({ existingSets, newDayExercises });

    expect(diff.startedExercises.sort()).toEqual(["bench_press"]);
    expect(diff.setIdsToDelete.sort()).toEqual(["b1", "c1"]);
    // bench_press is started (skip); overhead_press + lateral_raise need fresh sets.
    expect(diff.exercisesToGenerate).toEqual(["overhead_press", "lateral_raise"]);
  });

  it("nothing started → delete all existing, generate the whole new day", () => {
    const existingSets: Set[] = [
      { id: "a1", exerciseName: "bench_press", completedAt: null },
      { id: "b1", exerciseName: "overhead_press", completedAt: null },
    ];
    const newDayExercises = ["squat", "leg_press"];

    const diff = planTodayDiff({ existingSets, newDayExercises });

    expect(diff.startedExercises).toEqual([]);
    expect(diff.setIdsToDelete.sort()).toEqual(["a1", "b1"]);
    expect(diff.exercisesToGenerate).toEqual(["squat", "leg_press"]);
  });

  it("preserves order of newDayExercises in exercisesToGenerate", () => {
    const diff = planTodayDiff({
      existingSets: [],
      newDayExercises: ["c", "a", "b"],
    });
    expect(diff.exercisesToGenerate).toEqual(["c", "a", "b"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/plan-today-diff.test.ts`
Expected: FAIL — cannot find module `@/lib/workouts/plan-today-diff`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/workouts/plan-today-diff.ts

export type DiffSet = {
  id: string;
  exerciseName: string;
  completedAt: Date | null;
};

export type PlanTodayDiff = {
  /** Exercises with ≥1 completed set — left fully intact. */
  startedExercises: string[];
  /** Set ids belonging to not-started exercises — to be deleted. */
  setIdsToDelete: string[];
  /** New-plan-day exercises that are not started — to be (re)generated, in plan order. */
  exercisesToGenerate: string[];
};

/**
 * Compute how to adjust today's in-progress workout when the plan changes.
 * "Finish what you started, replace everything not yet started."
 */
export function planTodayDiff(params: {
  existingSets: DiffSet[];
  newDayExercises: string[];
}): PlanTodayDiff {
  const { existingSets, newDayExercises } = params;

  const started = new Set<string>();
  for (const s of existingSets) {
    if (s.completedAt !== null) started.add(s.exerciseName);
  }

  const setIdsToDelete = existingSets
    .filter((s) => !started.has(s.exerciseName))
    .map((s) => s.id);

  const exercisesToGenerate = newDayExercises.filter((name) => !started.has(name));

  return {
    startedExercises: [...started],
    setIdsToDelete,
    exercisesToGenerate,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/plan-today-diff.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/workouts/plan-today-diff.ts tests/plan-today-diff.test.ts
git commit -m "feat: pure planTodayDiff set-adjustment helper"
```

---

## Task 7: `adjustTodayWorkout` action + export `generateWorkout`

**Files:**
- Modify: `lib/actions/workouts.ts`

- [ ] **Step 1: Export `generateWorkout`**

In `lib/actions/workouts.ts`, change the helper declaration from:

```ts
// Local helper — calls Anthropic directly.
async function generateWorkout(params: {
```

to:

```ts
// Calls Anthropic directly to design prescribed sets for a day's exercises.
export async function generateWorkout(params: {
```

(Leave the body unchanged.)

- [ ] **Step 2: Add `adjustTodayWorkout` at the end of the file**

Append to `lib/actions/workouts.ts`. Note the imports `and`, `eq`, `db`, `plans`, `workouts`, `workoutSets` are already imported at the top of the file; add `inArray` to the existing `drizzle-orm` import (`import { and, asc, eq, inArray } from "drizzle-orm";`). Add the diff import at the top too: `import { planTodayDiff } from "@/lib/workouts/plan-today-diff";`.

```ts
const weekdayName = (): string => {
  const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return names[new Date().getDay()];
};

/**
 * When a new plan becomes active, adjust today's in-progress workout to match it:
 * exercises already started are left intact; everything not yet started is replaced
 * with the new plan day's exercises. No-op if there's no in-progress workout or the
 * new plan has no entry for today.
 */
export async function adjustTodayWorkout(params: {
  userId: string;
  newPlanId: string;
  newStructure: PlanStructure;
}): Promise<void> {
  const { userId, newPlanId, newStructure } = params;

  const [inProgress] = await db
    .select()
    .from(workouts)
    .where(and(eq(workouts.userId, userId), eq(workouts.status, "in_progress")))
    .limit(1);
  if (!inProgress) return;

  const today = weekdayName();
  const planDay = newStructure.days.find((d) => d.day === today);
  if (!planDay) return; // new plan makes today a rest day — leave the workout as-is

  const newExercises = planDay.exercises
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((e) => e.name);

  const existingSets = await db
    .select({
      id: workoutSets.id,
      exerciseName: workoutSets.exerciseName,
      completedAt: workoutSets.completedAt,
    })
    .from(workoutSets)
    .where(eq(workoutSets.workoutId, inProgress.id));

  const diff = planTodayDiff({ existingSets, newDayExercises: newExercises });

  // Generate fresh prescribed sets for not-started exercises (Anthropic call,
  // done BEFORE the destructive DB writes so a failure leaves the workout intact).
  const generated =
    diff.exercisesToGenerate.length > 0
      ? await generateWorkout({
          userId,
          dayKey: planDay.category,
          exercises: diff.exercisesToGenerate,
        })
      : { exercises: [] as { name: string; sets: { set_number: number; prescribed: { reps: number; weight: number }; branches: unknown }[] }[] };

  const newSetRows = generated.exercises.flatMap((ex) =>
    ex.sets.map((s) => ({
      workoutId: inProgress.id,
      exerciseName: ex.name,
      setNumber: s.set_number,
      prescribed: { reps: s.prescribed.reps, weight: s.prescribed.weight, branches: s.branches },
    })),
  );

  await db.transaction(async (tx) => {
    if (diff.setIdsToDelete.length > 0) {
      await tx.delete(workoutSets).where(inArray(workoutSets.id, diff.setIdsToDelete));
    }
    if (newSetRows.length > 0) {
      await tx.insert(workoutSets).values(newSetRows as (typeof workoutSets.$inferInsert)[]);
    }
    await tx
      .update(workouts)
      .set({ planId: newPlanId, dayKey: planDay.category })
      .where(eq(workouts.id, inProgress.id));
  });
}
```

Note: `PlanStructure` is already declared at the top of `lib/actions/workouts.ts` (used by `startWorkout`) — reuse it; do not redeclare.

- [ ] **Step 3: Type-check and run all tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/actions/workouts.ts
git commit -m "feat: adjustTodayWorkout regenerates not-started sets on plan change"
```

---

## Task 8: Wire `adjustTodayWorkout` into `acceptPlan`

**Files:**
- Modify: `lib/actions/plans.ts`

- [ ] **Step 1: Import the helper**

At the top of `lib/actions/plans.ts`, after the existing imports, add:

```ts
import { adjustTodayWorkout } from "@/lib/actions/workouts";
```

- [ ] **Step 2: Call it after inserting the new plan**

In `acceptPlan`, the insert currently ends with:

```ts
    } as typeof plans.$inferInsert)
    .returning({ id: plans.id });

  return { planId: row.id };
```

Change to:

```ts
    } as typeof plans.$inferInsert)
    .returning({ id: plans.id });

  // Bring today's in-progress workout in line with the new plan, if any.
  await adjustTodayWorkout({
    userId: user.id,
    newPlanId: row.id,
    newStructure: parsed,
  });

  return { planId: row.id };
```

Note: `parsed` is the validated `Plan` from `extractPlan`. Its `days[].exercises[]` shape matches the `PlanStructure` expected by `adjustTodayWorkout` (both have `day`, `category`, `exercises: { name, order }`). If `tsc` complains about structural mismatch, cast at the call site: `newStructure: parsed as unknown as Parameters<typeof adjustTodayWorkout>[0]["newStructure"]` — but try without the cast first.

- [ ] **Step 3: Type-check and run all tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/actions/plans.ts
git commit -m "feat: acceptPlan adjusts today's workout to the new plan"
```

---

## Task 9: Manual end-to-end verification

**Files:** none (manual).

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: build succeeds with no type/lint errors.

- [ ] **Step 2: Manual smoke (dev server)**

Run: `npm run dev`, then with a logged-in user that has an active plan:
1. Tap **Plan** → see the full week (days sorted Mon→Sun, exercises in order, split + notes shown).
2. Tap **Edit with Claude** → type "put more emphasis on shoulders" → Claude returns a revised plan → **Accept** → land back on `/plan` showing the updated week.
3. Tap **Start a fresh plan** → Claude auto-proposes a new plan on load → **Accept** → `/plan` shows the new week; confirm the previous plan is no longer active (only one active plan).
4. With a workout started for today (log one set of the first exercise), edit the plan to swap the *second* exercise → Accept → open today's workout: the first exercise's logged set is intact; the not-started exercises reflect the new plan.

- [ ] **Step 3: Final commit (if any cleanup was needed)**

```bash
git add -A
git commit -m "chore: plan tab manual-verification fixups"
```

---

## Notes for the implementer

- **Run a single test file:** `npx vitest run tests/<file>.test.ts`. **All tests:** `npx vitest run`. **Type-check:** `npx tsc --noEmit`.
- **TDD ordering:** Tasks 1 and 6 are pure functions — write the test first and watch it fail before implementing. Tasks 2–5, 7, 8 are wiring around them; rely on `tsc --noEmit` + the existing suite as the guard.
- **Don't regress onboarding:** after Task 3, the onboarding `/onboarding/chat` flow must behave exactly as before (auto-proposes a plan, Accept → `/today`). Verify in Task 9 if touching onboarding.
- **One active plan invariant:** `acceptPlan` already deactivates the prior active plan before inserting; do not change that.
