// Shared formatting for the aim/checkpoint mechanism (BEHAVIOURS.md Layer 4
// — Checkpoints). Used by CategorySheet.tsx's DoorBlock (still the aim
// surface for the Budget page's synthetic "Choices in X" sheet) and
// SpendVerdictView.tsx's notable-card aim block (the Spend hub's copy —
// ENGINE.md Build Order stage, "Aim prompt moves to the notable card").
// One place for the copy so the two surfaces can never drift.
export function fmtWhole(n: number, sym: string): string {
  return `${sym}${Math.round(n).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function daysLabel(days: number): string {
  if (days <= 0) return "last day";
  if (days === 1) return "1 day left";
  return `${days} days left`;
}
