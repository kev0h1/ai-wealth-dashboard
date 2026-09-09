// TEMPORARY PREVIEW — delete after design review.
//
// Variant B "Timeline" — appends the same WHERE EACH CARD IS HEADED
// section as Variant A, but the body is a single horizontal 24-month rail
// (ticks every 6 months) with one dot per carried card at its projected
// clear month and hollow ticks at promo-end dates, followed by the same
// compact list underneath for accessibility (screen readers, low vision,
// or anyone who prefers numbers to a rail).

import MoneyText from "@/components/MoneyText";
import { OUTLOOK_CARDS, CLEARED_MONTHLY, EXTRA_PER_MONTH, DEBT_FREE_MONTH, FIXTURE_TODAY, nameFor } from "./fixtures";
import { Whisper, fmtGBP, monthLabel, monthsBetween, leadLine, clearedMonthlyLine } from "./shared";

const RAIL_MONTHS = 24;
const TICK_EVERY = 6;
// Ticks/dots are centred on their offset with -translate-x-1/2, which would
// let the 0-month and 24-month markers bleed half their own width past the
// card's edge. Inset the usable range so every marker, including its
// label, stays inside the card (matches cards-outlook/VariantB.tsx's fix).
const RAIL_INSET_PCT = 4;
function pctFor(offset: number): number {
  return RAIL_INSET_PCT + (offset / RAIL_MONTHS) * (100 - 2 * RAIL_INSET_PCT);
}

function railMonthLabel(startYm: string, offset: number): string {
  const [y, m] = startYm.split("-").map(Number);
  const total = y * 12 + (m - 1) + offset;
  const yy = Math.floor(total / 12);
  const mm = (total % 12) + 1;
  return `${yy}-${String(mm).padStart(2, "0")}`;
}

export default function VariantB({ namesMode }: { namesMode: "raw" | "clean" }) {
  const lead = leadLine(EXTRA_PER_MONTH, DEBT_FREE_MONTH);
  const closingLine = clearedMonthlyLine(CLEARED_MONTHLY.map((c) => nameFor(c.accountId, namesMode)));
  const startYm = FIXTURE_TODAY.slice(0, 7);
  const promoCards = OUTLOOK_CARDS.filter((c) => c.promoUntil !== null);

  return (
    <div>
      <Whisper>WHERE EACH CARD IS HEADED</Whisper>

      {lead && (
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 leading-snug">
          <MoneyText text={lead} />
        </p>
      )}

      <div className="glass-card rounded-2xl mt-3 p-4">
        {/* Rail */}
        <div className="relative h-14" role="img" aria-label="Month rail showing when each carried card is projected to clear">
          <div className="absolute left-0 right-0 top-6 h-px bg-slate-200 dark:bg-slate-700" />

          {Array.from({ length: Math.floor(RAIL_MONTHS / TICK_EVERY) + 1 }).map((_, i) => {
            const offset = i * TICK_EVERY;
            const pct = pctFor(offset);
            return (
              <div key={i} className="absolute top-0 flex flex-col items-center" style={{ left: `${pct}%` }}>
                <div className="w-px h-3 bg-slate-300 dark:bg-slate-600" />
                <p className="mt-6 text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap -translate-x-1/2">
                  {monthLabel(railMonthLabel(startYm, offset))}
                </p>
              </div>
            );
          })}

          {promoCards.map((c) => {
            const offset = Math.min(RAIL_MONTHS, Math.max(0, monthsBetween(startYm, c.promoUntil as string)));
            const pct = pctFor(offset);
            return (
              <div
                key={`promo-${c.accountId}`}
                className="absolute top-1 w-2 h-2 rounded-full border-2 border-slate-400 dark:border-slate-500 bg-transparent -translate-x-1/2"
                style={{ left: `${pct}%` }}
                title={`${nameFor(c.accountId, namesMode)}: ${c.ratePill.label}`}
              />
            );
          })}

          {OUTLOOK_CARDS.map((c) => {
            if (!c.payoffMonth) return null;
            const offset = Math.min(RAIL_MONTHS, Math.max(0, monthsBetween(startYm, c.payoffMonth)));
            const pct = pctFor(offset);
            return (
              <div key={c.accountId} className="absolute top-3 flex flex-col items-center -translate-x-1/2" style={{ left: `${pct}%` }}>
                <div className={`w-3 h-3 rounded-full ${c.payingInterest ? "bg-amber-500" : "bg-indigo-500"}`} aria-hidden="true" />
              </div>
            );
          })}
        </div>

        {/* Accessible list, same figures as the rail */}
        <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-700/60">
          {OUTLOOK_CARDS.map((c) => (
            <div key={c.accountId} className="py-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                  {nameFor(c.accountId, namesMode)}
                </p>
                <span
                  className={`inline-block mt-0.5 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full num ${
                    c.ratePill.amber
                      ? "bg-amber-50 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400"
                      : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
                  }`}
                >
                  {c.ratePill.label}
                </span>
              </div>
              <div className="text-right flex-shrink-0">
                {c.paceMonthly != null && (
                  <p className="text-sm font-semibold money text-slate-900 dark:text-slate-100">
                    +{fmtGBP(c.paceMonthly)}/mo
                  </p>
                )}
                <p className="text-[11px] text-slate-400 dark:text-slate-500">
                  {c.payoffMonth ? `clears ${monthLabel(c.payoffMonth)}` : "no clear date yet"}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {closingLine && (
        <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-3 leading-snug">{closingLine}</p>
      )}
    </div>
  );
}
