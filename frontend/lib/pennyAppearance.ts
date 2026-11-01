/** The three approved visual treatments for the Penny entry points. */
export const PENNY_APPEARANCES = ["original", "outline", "ink"] as const;

export type PennyAppearance = typeof PENNY_APPEARANCES[number];

export const DEFAULT_PENNY_APPEARANCE: PennyAppearance = "original";

export function pennyAppearanceFromSnapshot(value: unknown): PennyAppearance {
  return PENNY_APPEARANCES.includes(value as PennyAppearance)
    ? value as PennyAppearance
    : DEFAULT_PENNY_APPEARANCE;
}
