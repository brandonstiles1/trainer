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
  const messages: MessageParam[] = [];
  if (body.messages.length === 0) {
    const content: ContentBlockParam[] = [];

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
