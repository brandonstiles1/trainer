import { describe, it, expect } from "vitest";
import { isBigJump } from "@/lib/workouts/pin-trigger";

describe("isBigJump", () => {
  it("true when actual weight is >=25% over prescribed", () => {
    expect(isBigJump(37, 100)).toBe(true);
    expect(isBigJump(100, 125)).toBe(true);
  });
  it("false for small or no increase", () => {
    expect(isBigJump(100, 110)).toBe(false);
    expect(isBigJump(100, 100)).toBe(false);
  });
});
