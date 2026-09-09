// TEMPORARY PREVIEW — delete after design review.
//
// Pure formatting helpers shared by the faithful replica and all three
// variants. No hooks here (category colours are resolved with useColours()
// in CardsPageVariantsClient.tsx and passed down as props) so this file
// stays a plain, hook-free module.

import type { OutlookCard } from "./fixtures";

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function fmtGBP(n: number): string {
  return `£${Math.round(Math.abs(n)).toLocaleString("en-GB")}`;
}

export function monthShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { month: "short" });
}

// "YYYY-MM" → "Mar 2027"
export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

// Months between two "YYYY-MM" labels (b - a).
export function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

export function Whisper({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
      {children}
    </p>
  );
}

// ── The "what it would take" lead line — shared across all three variants.
// Always framed as a projection ("would clear"), never a promise: pace
// figures are demonstrated history projected forward, not a scheduled
// outcome (no-conviction-on-predictions doctrine).
export function leadLine(extraPerMonth: number | null, debtFreeMonth: string | null): string | null {
  if (extraPerMonth === null || debtFreeMonth === null) return null;
  const month = monthLabel(debtFreeMonth);
  if (extraPerMonth === 0) {
    return `At your pace every carried card would clear by ${month}.`;
  }
  return `${fmtGBP(extraPerMonth)} more a month would clear every carried card by ${month}.`;
}

// Quiet closing line for cards that clear in full each cycle.
export function clearedMonthlyLine(names: string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} clears in full each month.`;
  if (names.length === 2) return `${names[0]} and ${names[1]} clear in full each month.`;
  const last = names[names.length - 1];
  const rest = names.slice(0, -1).join(", ");
  return `${rest} and ${last} clear in full each month.`;
}

// Variant C's per-row subline under "£X owed": a promo end, a plain clear
// month, or (for cleared-monthly cards, handled by the caller before this
// is reached) "clears in full each month". Amber only when the card is
// genuinely being charged interest right now (Figures Are Ink / colour
// means one thing rule) — never introduced for a merely-carried, not
// currently charged balance.
export function cRowSubline(outlook: OutlookCard): { text: string; amber: boolean } {
  if (outlook.promoUntil) {
    return { text: outlook.ratePill.label, amber: false };
  }
  if (outlook.payoffMonth) {
    return { text: `clears ${monthLabel(outlook.payoffMonth)}`, amber: outlook.payingInterest };
  }
  return { text: "no clear date yet", amber: outlook.payingInterest };
}
