// TEMPORARY PREVIEW — delete after design review.
//
// Faithful markup copy of frontend/app/cards/CardsPage.tsx's five existing
// sections (header, movement headline, WHERE IT MOVED, WHAT DROVE IT, THE
// TRAJECTORY) against this round's fixtures, kept as a copy (not an import)
// so the live page is never touched by this proposal. Structure, classes
// and copy grammar match CardsPage.tsx line for line except: no back-nav
// router (this is a static preview), no BottomNav, no loading/error states
// (fixtures always resolve), and balances are never masked (hide-balances
// is a live-data preference, out of scope for a fixture preview).
//
// Variant C's only change to the live page is additive: each WHERE IT
// MOVED row gains one subline under "£X owed" (showSublines=true, wired
// from CardsPageVariantsClient's variant===c branch). Variants A and B
// leave this replica untouched and append their own section afterward.

import { accountBrand, BankBadge } from "@/components/AccountMiniCard";
import type { Account } from "@/lib/api";
import MoneyText from "@/components/MoneyText";
import {
  PERIOD,
  MOVEMENT,
  PER_CARD,
  DRIVERS,
  PATTERN_LINE,
  TRAJECTORY,
  OUTLOOK_CARDS,
  CLEARED_MONTHLY,
  nameFor,
  metaFor,
} from "./fixtures";
import { fmtDate, fmtGBP, monthShort, Whisper, cRowSubline } from "./shared";

type NamesMode = "raw" | "clean";

export default function ReplicaSections({
  namesMode,
  colours,
  categoryColour,
  showSublines,
}: {
  namesMode: NamesMode;
  colours: Record<string, string>;
  categoryColour: (category: string, colours: Record<string, string>) => string;
  /** Variant C only: append the outlook subline under each carried card's
   *  "£X owed" caption in WHERE IT MOVED. */
  showSublines: boolean;
}) {
  const { delta, new_spend, payments } = MOVEMENT;
  const { days_elapsed } = PERIOD;
  const deltaAbs = Math.abs(delta);

  let verdictNode: React.ReactNode;
  if (deltaAbs < 20) {
    verdictNode = <span className="text-slate-900 dark:text-slate-100">Held steady</span>;
  } else if (delta >= 20) {
    verdictNode = (
      <span className="text-slate-900 dark:text-slate-100">
        ↑ <span className="font-mono tabular-nums">{fmtGBP(delta)}</span>
      </span>
    );
  } else {
    verdictNode = (
      <span className="text-emerald-600 dark:text-emerald-400">
        −<span className="font-mono tabular-nums">{fmtGBP(delta)}</span>
      </span>
    );
  }

  const outlookByAccount = new Map(OUTLOOK_CARDS.map((o) => [o.accountId, o]));
  const clearedMonthlyIds = new Set(CLEARED_MONTHLY.map((c) => c.accountId));

  const trajSlice = TRAJECTORY;
  const maxAbsDelta = trajSlice.reduce((m, t) => Math.max(m, Math.abs(t.delta)), 0);

  return (
    <>
      {/* ── Section 1: Header ──────────────────────────────────────────── */}
      <div>
        <Whisper>CARDS · THIS CYCLE</Whisper>
        <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">
          {fmtDate(PERIOD.start)} – {fmtDate(PERIOD.end)}
        </p>
      </div>

      {/* ── Section 2: Movement headline ──────────────────────────────── */}
      <div className="glass-hero rounded-3xl p-5">
        <Whisper>CARD MOVEMENT · {days_elapsed} DAYS</Whisper>
        <p className="text-3xl font-bold num tracking-tight mt-2 mb-1">{verdictNode}</p>
        <p className="text-sm text-slate-500 dark:text-slate-400 num">
          New spend <span className="font-mono tabular-nums">{fmtGBP(new_spend)}</span> · Payments{" "}
          <span className="font-mono tabular-nums">{fmtGBP(payments)}</span>
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-3 leading-snug">
          <MoneyText
            text={`Your balances grew by ${fmtGBP(delta)}, you put on ${fmtGBP(new_spend)} and paid off ${fmtGBP(payments)}.`}
          />
        </p>
      </div>

      {/* ── Section 3: WHERE IT MOVED ───────────────────────────────────── */}
      <div>
        <Whisper>WHERE IT MOVED</Whisper>
        <div className="glass-card rounded-2xl mt-3 divide-y divide-slate-100 dark:divide-slate-700/60 overflow-hidden">
          {PER_CARD.map((c) => {
            const meta = metaFor(c.account_id);
            const fakeAccount = { provider: meta.provider, name: meta.rawName, type: "credit_card" } as unknown as Account;
            const brand = accountBrand(fakeAccount);
            const balanceAbs = Math.abs(c.balance);
            const balanceCaption = c.balance < 0 ? "owed" : c.balance > 0 ? "in credit" : null;

            let subline: { text: string; amber: boolean } | null = null;
            if (showSublines) {
              if (clearedMonthlyIds.has(c.account_id)) {
                subline = { text: "clears in full each month", amber: false };
              } else {
                const outlook = outlookByAccount.get(c.account_id);
                if (outlook) subline = cRowSubline(outlook);
              }
            }

            return (
              <div key={c.account_id} className="px-4 py-3 flex items-center gap-3">
                <BankBadge logoSrc={brand.logoSrc} initials={brand.initials} altText={brand.label} brandBg={brand.background} />

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                    {nameFor(c.account_id, namesMode)}
                  </p>
                  {c.apr != null && (
                    <span className="inline-block mt-0.5 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 num">
                      {c.apr}% APR
                    </span>
                  )}
                </div>

                <div className="text-right flex-shrink-0">
                  {c.delta > 0 ? (
                    <p className="text-sm font-semibold money text-slate-900 dark:text-slate-100">+{fmtGBP(c.delta)}</p>
                  ) : c.delta < 0 ? (
                    <p className="text-sm font-semibold money text-emerald-600 dark:text-emerald-400">−{fmtGBP(c.delta)}</p>
                  ) : (
                    <p className="text-sm font-semibold money text-slate-900 dark:text-slate-100">£0</p>
                  )}
                  {balanceCaption && (
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 num">
                      <span className={`font-mono tabular-nums ${c.balance < 0 ? "text-rose-600 dark:text-rose-400" : ""}`}>
                        {`£${Math.round(balanceAbs).toLocaleString("en-GB")}`}
                      </span>{" "}
                      {balanceCaption}
                    </p>
                  )}
                  {subline && (
                    <p
                      className={`text-[11px] mt-0.5 ${
                        subline.amber
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-slate-400 dark:text-slate-500"
                      }`}
                    >
                      {subline.text}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Section 4: WHAT DROVE IT ────────────────────────────────────── */}
      <div>
        <Whisper>WHAT DROVE IT</Whisper>
        <div className="glass-card rounded-2xl mt-3 overflow-hidden">
          <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {DRIVERS.map((d) => {
              const colour = categoryColour(d.category, colours);
              return (
                <div key={d.category} className="px-4 py-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${colour}26` }}>
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: colour }} />
                  </div>
                  <p className="flex-1 text-sm font-medium text-slate-700 dark:text-slate-200">{d.category}</p>
                  <p className="text-sm font-semibold money text-slate-900 dark:text-slate-100">{fmtGBP(d.total)}</p>
                </div>
              );
            })}
          </div>
          {PATTERN_LINE && (
            <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-700/60">
              <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-snug">{PATTERN_LINE}</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Section 5: THE TRAJECTORY ───────────────────────────────────── */}
      <div>
        <Whisper>THE TRAJECTORY</Whisper>
        <div className="glass-card rounded-2xl p-4 mt-3">
          <div className="flex items-end gap-2 h-12">
            {trajSlice.map((t, i) => {
              const barH = maxAbsDelta === 0 ? 4 : Math.max(4, Math.round((48 * Math.abs(t.delta)) / maxAbsDelta));
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
        </div>
      </div>
    </>
  );
}
