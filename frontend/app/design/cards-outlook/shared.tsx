// TEMPORARY PREVIEW — delete after design review.
//
// Shared helpers + a verbatim-grammar copy of CardsPage.tsx's Section 5
// (THE TRAJECTORY), kept as a copy (not an import) so the new "Where each
// card is headed" section is previewed in the context it will actually
// ship below, without touching the live Cards page.

import type { OutlookFixture } from "./fixtures";

// ── Formatting ───────────────────────────────────────────────────────────

export function fmtGBP(n: number): string {
  return `£${Math.round(Math.abs(n)).toLocaleString("en-GB")}`;
}

// "YYYY-MM" → "Mar 2027"
export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

export function monthShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { month: "short" });
}

// Months between two "YYYY-MM" labels (b - a), a and b both "YYYY-MM".
export function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

// ── Whisper label (matches CardsPage.tsx) ───────────────────────────────

export function Whisper({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
      {children}
    </p>
  );
}

// ── The "what it would take" lead line ──────────────────────────────────
//
// Both variants share this sentence. It is always framed as a projection
// ("would clear"), never a promise — pace figures are demonstrated
// history projected forward, not a scheduled outcome.
export function leadLine(fixture: OutlookFixture): string | null {
  if (fixture.extraPerMonth === null || fixture.debtFreeMonth === null) return null;
  const month = monthLabel(fixture.debtFreeMonth);
  if (fixture.extraPerMonth === 0) {
    return `At your pace every carried card would clear by ${month}.`;
  }
  return `${fmtGBP(fixture.extraPerMonth)} more a month would clear every carried card by ${month}.`;
}

// Quiet closing line for cards that clear in full each cycle.
export function clearedMonthlyLine(cards: { name: string }[]): string | null {
  if (cards.length === 0) return null;
  if (cards.length === 1) return `${cards[0].name} clears in full each month.`;
  if (cards.length === 2) return `${cards[0].name} and ${cards[1].name} clear in full each month.`;
  const last = cards[cards.length - 1];
  const rest = cards.slice(0, -1).map((c) => c.name).join(", ");
  return `${rest} and ${last.name} clear in full each month.`;
}

// ── THE TRAJECTORY (copied verbatim in grammar from CardsPage.tsx §5) ────

export function TrajectoryPanel({ trajectory }: { trajectory: { period_end: string; delta: number }[] }) {
  const trajSlice = trajectory.slice(-6);
  const maxAbsDelta = trajSlice.reduce((m, t) => Math.max(m, Math.abs(t.delta)), 0);

  return (
    <div>
      <Whisper>THE TRAJECTORY</Whisper>
      <div className="glass-card rounded-2xl p-4 mt-3">
        {trajSlice.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">No closed cycles yet.</p>
        ) : (
          <>
            <div className="flex items-end gap-2 h-12">
              {trajSlice.map((t, i) => {
                const barH =
                  maxAbsDelta === 0 ? 4 : Math.max(4, Math.round((48 * Math.abs(t.delta)) / maxAbsDelta));
                const barColour = t.delta > 0 ? "bg-slate-400 dark:bg-slate-500" : "bg-emerald-500";
                return (
                  <div key={i} className="flex-1 flex flex-col items-stretch">
                    <div className="flex items-end flex-1">
                      <div className={`flex-1 rounded-t ${barColour}`} style={{ height: `${barH}px` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2 mt-1">
              {trajSlice.map((t, i) => (
                <p key={i} className="flex-1 text-[10px] text-slate-400 dark:text-slate-500 text-center">
                  {monthShort(t.period_end)}
                </p>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
