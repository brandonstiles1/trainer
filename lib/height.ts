/** Height is stored as a single integer of total inches. These helpers convert
 *  to/from the feet'inches" form people actually think in. */

export function inchesToFeetInches(totalInches: number): { feet: number; inches: number } {
  const safe = Math.max(0, Math.round(totalInches));
  return { feet: Math.floor(safe / 12), inches: safe % 12 };
}

export function feetInchesToInches(feet: number, inches: number): number {
  const f = Math.max(0, Math.round(feet) || 0);
  const i = Math.max(0, Math.round(inches) || 0);
  return f * 12 + i;
}

export function formatHeight(totalInches: number): string {
  const { feet, inches } = inchesToFeetInches(totalInches);
  return `${feet}'${inches}"`;
}
