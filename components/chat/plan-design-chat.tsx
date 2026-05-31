"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageList, type ChatMessage } from "@/components/chat/message-list";
import { ChatInput } from "@/components/chat/input";
import { Button } from "@/components/ui/button";
import { acceptPlan } from "@/lib/actions/plans";

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
