import { createClient } from "@/lib/supabase/server";
import { anthropic, model } from "@/lib/anthropic";
import { PLAN_DESIGN_SYSTEM } from "@/lib/prompts/plan-design";
import { createSignedReadUrl } from "@/lib/storage";
import { db } from "@/lib/db";
import { goals, plans } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { assemblePlanMessages } from "@/lib/chat/assemble-plan-messages";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages/messages";

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatMessage = { role: "user" | "assistant"; content: string };

type Body = {
  goalId: string;
  mode?: "new" | "edit"; // default "new"
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
