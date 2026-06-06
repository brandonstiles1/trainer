import { describe, it, expect } from "vitest";
import { inchesToFeetInches, feetInchesToInches, formatHeight } from "@/lib/height";

describe("height conversions", () => {
  it("splits inches into feet and inches", () => {
    expect(inchesToFeetInches(69)).toEqual({ feet: 5, inches: 9 });
    expect(inchesToFeetInches(72)).toEqual({ feet: 6, inches: 0 });
    expect(inchesToFeetInches(48)).toEqual({ feet: 4, inches: 0 });
  });

  it("combines feet and inches back into total inches", () => {
    expect(feetInchesToInches(5, 9)).toBe(69);
    expect(feetInchesToInches(6, 0)).toBe(72);
  });

  it("round-trips", () => {
    for (const n of [48, 60, 69, 71, 84]) {
      const { feet, inches } = inchesToFeetInches(n);
      expect(feetInchesToInches(feet, inches)).toBe(n);
    }
  });

  it("formats as feet'inches\"", () => {
    expect(formatHeight(69)).toBe(`5'9"`);
    expect(formatHeight(72)).toBe(`6'0"`);
  });

  it("clamps and rounds bad input", () => {
    expect(inchesToFeetInches(-5)).toEqual({ feet: 0, inches: 0 });
    expect(feetInchesToInches(NaN, NaN)).toBe(0);
  });
});
