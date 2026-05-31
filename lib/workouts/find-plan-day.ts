export type PlanDay = {
  day: string;
  category: string;
  exercises: { name: string; order: number; notes?: string }[];
};

/** Find the plan day whose `day` key matches, or null if today is a rest day. */
export function findPlanDay(
  structure: { days: PlanDay[] },
  day: string,
): PlanDay | null {
  return structure.days.find((d) => d.day === day) ?? null;
}
