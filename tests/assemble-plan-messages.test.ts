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
