import { describe, it, expect } from "vitest";
import {
  recommendNext,
  qualifies,
  workingWeight,
  type SessionLog,
  type RecommendInput,
} from "@/lib/engine/double-progression";

const NOW = new Date("2026-10-27T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

/** Sessions are passed oldest-first here for readability, then reversed. */
function history(...sessions: Array<[number, number[], Partial<SessionLog>?]>): SessionLog[] {
  return sessions
    .map(([weight, reps, over], i) => ({
      finishedAt: daysAgo((sessions.length - i) * 3),
      complete: true,
      sets: reps.map((r) => ({ weight, reps: r })),
      ...over,
    }))
    .reverse();
}

const base = (sessions: SessionLog[], over: Partial<RecommendInput> = {}): RecommendInput => ({
  sessions,
  setCount: 3,
  repRange: { min: 8, max: 10 },
  increment: 5,
  now: NOW,
  ...over,
});

describe("recommendNext — the incline press example", () => {
  it("session 1: 10/10/9 → maintain", () => {
    const r = recommendNext(base(history([50, [10, 10, 9]])));
    expect(r.action).toBe("hold");
    expect(r.weight).toBe(50);
    expect(r.successStreak).toBe(0);
  });

  it("session 2: 10/10/10 → first success, still maintain", () => {
    const r = recommendNext(base(history([50, [10, 10, 9]], [50, [10, 10, 10]])));
    expect(r.action).toBe("hold");
    expect(r.weight).toBe(50);
    expect(r.successStreak).toBe(1);
    expect(r.reason).toMatch(/1 more session/);
  });

  it("session 3: 10/10/10 again → recommend 55 lb dumbbells", () => {
    const r = recommendNext(
      base(history([50, [10, 10, 9]], [50, [10, 10, 10]], [50, [10, 10, 10]])),
    );
    expect(r.action).toBe("increase");
    expect(r.weight).toBe(55);
    expect(r.baseWeight).toBe(50);
  });

  it("session 4: target resets to the bottom of the range at 55", () => {
    const r = recommendNext(
      base(history([50, [10, 10, 9]], [50, [10, 10, 10]], [50, [10, 10, 10]])),
    );
    expect(r.sets).toEqual([
      { weight: 55, targetReps: 8 },
      { weight: 55, targetReps: 8 },
      { weight: 55, targetReps: 8 },
    ]);
  });
});

describe("recommendNext — thresholds", () => {
  it("one rep short of the top on any set is not a success", () => {
    const r = recommendNext(base(history([50, [10, 10, 10]], [50, [10, 9, 10]])));
    expect(r.action).toBe("hold");
    expect(r.successStreak).toBe(0);
  });

  it("overshooting the top counts as hitting it", () => {
    const r = recommendNext(base(history([50, [12, 11, 10]], [50, [11, 11, 11]])));
    expect(r.action).toBe("increase");
  });

  it("a non-consecutive success doesn't carry over", () => {
    const r = recommendNext(
      base(history([50, [10, 10, 10]], [50, [10, 9, 8]], [50, [10, 10, 10]])),
    );
    expect(r.action).toBe("hold");
    expect(r.successStreak).toBe(1);
  });

  it("successes at a lighter weight don't count toward the current one", () => {
    const r = recommendNext(base(history([45, [10, 10, 10]], [50, [10, 10, 10]])));
    expect(r.action).toBe("hold");
    expect(r.successStreak).toBe(1);
  });

  it("respects a custom success threshold", () => {
    const sessions = history([50, [10, 10, 10]]);
    const rules = { successSessions: 1, missSessions: 3, breakDays: 14 };
    expect(recommendNext(base(sessions, { rules })).action).toBe("increase");
  });

  it("hold targets climb one rep per set, clamped to the range", () => {
    const r = recommendNext(base(history([50, [10, 9, 6]])));
    expect(r.sets.map((s) => s.targetReps)).toEqual([10, 10, 8]);
  });

  it("pads targets when the routine now has more sets than last time", () => {
    const r = recommendNext(base(history([50, [9, 9]]), { setCount: 3 }));
    expect(r.sets).toHaveLength(3);
    expect(r.sets[2]).toEqual({ weight: 50, targetReps: 10 });
  });
});

describe("recommendNext — failed sessions", () => {
  it("one or two sessions below the range hold the weight", () => {
    const r = recommendNext(base(history([50, [8, 7, 6]], [50, [8, 7, 7]])));
    expect(r.action).toBe("hold");
    expect(r.missStreak).toBe(2);
    expect(r.weight).toBe(50);
  });

  it("three in a row suggest one step down, never more weight", () => {
    const r = recommendNext(
      base(history([50, [8, 7, 6]], [50, [8, 7, 7]], [50, [7, 7, 6]])),
    );
    expect(r.action).toBe("decrease");
    expect(r.weight).toBe(45);
    expect(r.sets.every((s) => s.targetReps === 8)).toBe(true);
    expect(r.reason).toMatch(/Keep 50 lb/);
  });

  it("a session inside the range breaks the miss streak", () => {
    const r = recommendNext(
      base(history([50, [7, 7, 7]], [50, [7, 7, 7]], [50, [8, 8, 8]], [50, [7, 7, 7]])),
    );
    expect(r.action).toBe("hold");
    expect(r.missStreak).toBe(1);
  });
});

describe("recommendNext — incomplete or missing data", () => {
  it("ignores incomplete sessions entirely — no progress from them", () => {
    const r = recommendNext(
      base(history([50, [10, 10, 10]], [50, [10, 10], { complete: false }])),
    );
    expect(r.action).toBe("hold");
    expect(r.successStreak).toBe(1);
  });

  it("an incomplete session between two successes doesn't break the streak", () => {
    const r = recommendNext(
      base(history([50, [10, 10, 10]], [50, [6], { complete: false }], [50, [10, 10, 10]])),
    );
    expect(r.action).toBe("increase");
  });

  it("only-incomplete history repeats the load instead of judging it", () => {
    const r = recommendNext(base(history([50, [10, 10], { complete: false }])));
    expect(r.action).toBe("hold");
    expect(r.weight).toBe(50);
    expect(r.baseWeight).toBeNull();
  });

  it("rejects sessions with non-numeric data", () => {
    expect(qualifies({ finishedAt: NOW, complete: true, sets: [{ weight: NaN, reps: 10 }] })).toBe(false);
    expect(qualifies({ finishedAt: NOW, complete: true, sets: [] })).toBe(false);
  });

  it("no history → start from the seed (or zero) at the bottom of the range", () => {
    expect(recommendNext(base([], { seedWeight: 42.4 }))).toMatchObject({
      action: "start",
      weight: 42,
      sets: [{ targetReps: 8 }, { targetReps: 8 }, { targetReps: 8 }],
    });
    expect(recommendNext(base([])).weight).toBe(0);
  });
});

describe("recommendNext — manual overrides", () => {
  it("a heavier logged weight becomes the new base; old successes don't transfer", () => {
    // Recommended 50, but the user loaded 60 and hit 9s.
    const r = recommendNext(base(history([50, [10, 10, 10]], [60, [9, 9, 9]])));
    expect(r.action).toBe("hold");
    expect(r.weight).toBe(60);
    expect(r.successStreak).toBe(0);
  });

  it("ignoring an increase doesn't stack a second one", () => {
    // Earned 55 after two sessions at 50, but did 50 again: still 55, not 60.
    const r = recommendNext(
      base(history([50, [10, 10, 10]], [50, [10, 10, 10]], [50, [10, 10, 10]])),
    );
    expect(r.action).toBe("increase");
    expect(r.weight).toBe(55);
  });

  it("taking the increase restarts the count at the new weight", () => {
    const r = recommendNext(
      base(history([50, [10, 10, 10]], [50, [10, 10, 10]], [55, [10, 10, 10]])),
    );
    expect(r.action).toBe("hold");
    expect(r.weight).toBe(55);
    expect(r.successStreak).toBe(1);
  });

  it("a drop set is judged by its lightest working set", () => {
    expect(workingWeight([{ weight: 55, reps: 10 }, { weight: 50, reps: 10 }])).toBe(50);
    const r = recommendNext(base(history([50, [10, 10, 10]], [50, [10, 10, 10]], [55, [10, 10, 10]], )));
    expect(r.weight).toBe(55);
  });
});

describe("recommendNext — equipment and breaks", () => {
  it("dumbbells step per dumbbell: 30 → 35 each", () => {
    const r = recommendNext(
      base(history([30, [10, 10, 10]], [30, [10, 10, 10]]), { increment: 5 }),
    );
    expect(r.weight).toBe(35);
  });

  it("lower-body steps can be larger", () => {
    const r = recommendNext(
      base(history([135, [10, 10, 10]], [135, [10, 10, 10]]), { increment: 10 }),
    );
    expect(r.weight).toBe(145);
  });

  it("assisted pull-ups progress toward zero assistance", () => {
    const r = recommendNext(
      base(history([-40, [10, 10, 10]], [-40, [10, 10, 10]]), {
        allowNegative: true,
        repRange: { min: 6, max: 10 },
      }),
    );
    expect(r.weight).toBe(-35);
  });

  it("time passing alone never adds weight", () => {
    const sessions = history([50, [10, 10, 10]]);
    const r = recommendNext(base(sessions, { now: new Date(NOW.getTime() + 10 * 86_400_000) }));
    expect(r.weight).toBe(50);
  });

  it("after a long break, eases back ~10% without touching history", () => {
    const sessions = history([100, [10, 10, 10]], [100, [10, 10, 10]]);
    const later = new Date(NOW.getTime() + 30 * 86_400_000);
    const r = recommendNext(base(sessions, { now: later }));
    expect(r.action).toBe("ease_back");
    expect(r.weight).toBe(90);
    expect(r.sets.every((s) => s.targetReps === 8)).toBe(true);
  });

  it("easing back always drops at least one step", () => {
    const sessions = history([20, [10, 10, 10]]);
    const later = new Date(NOW.getTime() + 30 * 86_400_000);
    expect(recommendNext(base(sessions, { now: later })).weight).toBe(15);
  });
});
