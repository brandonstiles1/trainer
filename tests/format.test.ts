import { describe, it, expect } from "vitest";
import { formatDuration, formatSets, formatStep, formatWeight } from "@/lib/format";

describe("formatDuration", () => {
  it("formats sub-hour durations as mm:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(9)).toBe("0:09");
    expect(formatDuration(75)).toBe("1:15");
    expect(formatDuration(600)).toBe("10:00");
  });

  it("formats hour+ durations as h:mm:ss", () => {
    expect(formatDuration(3600)).toBe("1:00:00");
    expect(formatDuration(3661)).toBe("1:01:01");
  });

  it("clamps negatives to zero", () => {
    expect(formatDuration(-30)).toBe("0:00");
  });
});

describe("weight formatting", () => {
  it("shows dumbbells per dumbbell and the step as a pair total", () => {
    expect(formatWeight(55, "dumbbell")).toBe("55 lb each");
    expect(formatStep(5, "dumbbell")).toBe("+5 lb per dumbbell (10 lb total)");
    expect(formatStep(10, "barbell")).toBe("+10 lb");
  });

  it("shows bodyweight as added load or assistance", () => {
    expect(formatWeight(0, "bodyweight")).toBe("BW");
    expect(formatWeight(-40, "bodyweight")).toBe("BW −40");
    expect(formatWeight(10, "bodyweight")).toBe("BW +10");
  });

  it("collapses a straight-sets session", () => {
    expect(formatSets([{ weight: 50, reps: 10 }, { weight: 50, reps: 9 }])).toBe("50 lb × 10, 9");
    expect(formatSets([{ weight: 50, reps: 10 }, { weight: 45, reps: 9 }])).toBe("50×10 · 45×9");
  });
});
