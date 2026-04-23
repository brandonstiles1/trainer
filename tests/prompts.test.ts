import { describe, it, expect } from "vitest";
import { PLAN_DESIGN_SYSTEM } from "@/lib/prompts/plan-design";

describe("PLAN_DESIGN_SYSTEM prompt", () => {
  it("mentions the <plan> XML tag", () => {
    expect(PLAN_DESIGN_SYSTEM).toContain("<plan>");
    expect(PLAN_DESIGN_SYSTEM).toContain("</plan>");
  });

  it("specifies required JSON fields", () => {
    for (const key of ["split", "days", "category", "exercises", "name", "order"]) {
      expect(PLAN_DESIGN_SYSTEM).toContain(key);
    }
  });

  it("specifies snake_case naming rule for exercise names", () => {
    expect(PLAN_DESIGN_SYSTEM).toMatch(/snake_case/i);
  });

  it("is stable (length within expected range for cache warming)", () => {
    expect(PLAN_DESIGN_SYSTEM.length).toBeGreaterThan(1000);
    expect(PLAN_DESIGN_SYSTEM.length).toBeLessThan(3000);
  });
});
