/** True when a logged weight is far enough above prescribed to offer a baseline pin. */
export function isBigJump(prescribedWeight: number, actualWeight: number, ratio = 1.25): boolean {
  if (prescribedWeight <= 0) return actualWeight > 0;
  return actualWeight >= prescribedWeight * ratio;
}
