// TEMPORARY PREVIEW — delete after design review.
//
// Variant B "Timeline" — WHERE EACH CARD IS HEADED as a single horizontal
// month rail (24 months, ticks every 6), one dot per carried card at its
// projected clear month, promo-end markers as small hollow ticks, and a
// compact two-column list underneath carrying the same figures for anyone
// who can't read the rail (screen readers, low vision, or just prefers
// numbers).

import MoneyText from "@/components/MoneyText";
import { FIXTURE_TODAY, type OutlookFixture } from "./fixtures";
import { Whisper, fmtGBP, monthLabel, monthsBetween, leadLine, clearedMonthlyLine } from "./shared";

const RAIL_MONTHS = 24;
const TICK_EVERY = 6;
// Ticks/dots are centred on their offset with -translate-x-1/2, which would
// let the 0-month and 24-month markers bleed half their own width past the
// card's edge. Inset the usable range so every marker, including its label,
// stays inside the card.
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

export default function VariantB({
  fixture,
  clearedMonthly,
}: {
  fixture: OutlookFixture;
  clearedMonthly: { accountId: string; name: string }[];
}) {
  const lead = leadLine(fixture);
  const closingLine = clearedMonthlyLine(clearedMonthly);
  const isEmpty = fixture.cards.length === 0;
  const startYm = FIXTURE_TODAY.slice(0, 7);

  // Promo-end markers: driven by each card's own promoUntil (from
  // rate_schedule's "until" field on the active promo segment).
  const promoCards = fixture.cards.filter((c) => c.promoUntil !== null);

  return (
    <div>
      <Whisper>WHERE EACH CARD IS HEADED</Whisper>

      {isEmpty && closingLine === null ? (
        <div className="glass-card rounded-2xl mt-3 p-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No card is carrying a balance into next period.
          </p>
        </div>
      ) : (
        <>
          {lead && (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 leading-snug">
              <MoneyText text={lead} />
            </p>
          )}

          {fixture.cards.length > 0 && (
            <div className="glass-card rounded-2xl mt-3 p-4">
              {/* Rail */}
              <div className="relative h-14" role="img" aria-label="Month rail showing when each carried card is projected to clear">
                <div className="absolute left-0 right-0 top-6 h-px bg-slate-200 dark:bg-slate-700" />

                {/* Tick marks every 6 months */}
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

                {/* Promo-end hollow ticks, positioned from each card's own
                    promoUntil (rate_schedule's active-promo "until"). */}
                {promoCards.map((c) => {
                  const offset = Math.min(
                    RAIL_MONTHS,
                    Math.max(0, monthsBetween(startYm, c.promoUntil as string))
                  );
                  const pct = pctFor(offset);
                  return (
                    <div
                      key={`promo-${c.accountId}`}
                      className="absolute top-1 w-2 h-2 rounded-full border-2 border-slate-400 dark:border-slate-500 bg-transparent -translate-x-1/2"
                      style={{ left: `${pct}%` }}
                      title={`${c.name}: ${c.ratePill.label}`}
                    />
                  );
                })}

                {/* One dot per carried card at its clear month */}
                {fixture.cards.map((c) => {
                  if (!c.payoffMonth) return null;
                  const offset = Math.min(RAIL_MONTHS, Math.max(0, monthsBetween(startYm, c.payoffMonth)));
                  const pct = pctFor(offset);
                  return (
                    <div
                      key={c.accountId}
                      className="absolute top-3 flex flex-col items-center -translate-x-1/2"
                      style={{ left: `${pct}%` }}
                    >
                      <div
                        className={`w-3 h-3 rounded-full ${
                          c.payingInterest ? "bg-amber-500" : "bg-indigo-500"
                        }`}
                        aria-hidden="true"
                      />
                    </div>
                  );
                })}
              </div>

              {/* Accessible two-column list, same figures as the rail */}
              <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-700/60">
                {fixture.cards.map((c) => (
                  <div key={c.accountId} className="py-2.5 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{c.name}</p>
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
          )}

          {closingLine && (
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-3 leading-snug">{closingLine}</p>
          )}
        </>
      )}
    </div>
  );
}
