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
