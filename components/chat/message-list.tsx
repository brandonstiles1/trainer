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
