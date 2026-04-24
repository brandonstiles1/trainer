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
