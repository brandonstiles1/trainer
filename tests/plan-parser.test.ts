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
