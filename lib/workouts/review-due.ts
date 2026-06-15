const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export function isReviewDue(last: Date | null, now: Date): boolean {
  if (!last) return true;
  return now.getTime() - last.getTime() >= WEEK_MS;
}
