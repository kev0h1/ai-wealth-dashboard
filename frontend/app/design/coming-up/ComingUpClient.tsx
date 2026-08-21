"use client";

// TEMPORARY PREVIEW — delete after design review.
//
// Three redesign directions for the Home "Coming up" card
// (components/UpcomingBillsStrip.tsx). Static mockup, hardcoded fixtures,
// no API calls, no auth, no router dependency — see fixtures.ts for the
// scenarios and the count/income accuracy decision they encode.
//
// Deep-linkable: /design/coming-up?mode=light|dark&state=everything

import { Fragment, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronRight, Receipt } from "lucide-react";
import {
  BUSY_BILLS,
  QUIET_BILLS,
  HEAVY_BILLS,
  dailyTotals,
  dueToday,
  fmt,
  fmtSum,
  totalOut,
  type FixtureBill,
} from "./fixtures";
import {
  AmberSignifier,
  SettleBar,
  computeHeadsUp,
  computeDrop,
  DropSentence,
  HeadsUpSentence,
  nextPaymentWhen,
  settleClusters,
} from "@/lib/comingUp";

type Mode = "light" | "dark";

// Renders "next {name}, {mono amount}, {when}" as a caption fragment — the
// currency figure gets its own mono span (The Money Is Mono Rule) while the
// merchant name, count and date stay in Figtree, per the surrounding prose.
function NextPaymentCaption({ bills }: { bills: FixtureBill[] }) {
  const [next] = bills; // fixtures are already in day order
  if (!next) return null;
  return (
    <>
      next {next.name}, <span className="font-mono tabular-nums">{fmt(next.amount)}</span>, {nextPaymentWhen(next)}
    </>
  );
}

// ── Variant A — Ledger line ──────────────────────────────────────────────
// Verdict-led: the total is the lead mono figure at Amount-on-card scale
// (700/19px), a quiet caption names the count and the next payment with its
// date, one amber dot only when something is genuinely due today.

function VariantA({ bills }: { bills: FixtureBill[] }) {
  const total = totalOut(bills);
  const today = dueToday(bills);

  return (
    <button
      type="button"
      className="w-full glass-card rounded-2xl px-4 py-3.5 flex items-center gap-3 active:scale-[0.99] transition-transform text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700/60 flex items-center justify-center flex-shrink-0">
        <Receipt size={17} className="text-slate-500 dark:text-slate-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Coming up &middot; 14 days
        </p>
        <p className="mt-0.5 text-[19px] font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
          {fmtSum(total)}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-slate-500 dark:text-slate-400">
          <AmberSignifier show={today.length > 0} />
          <span>
            {bills.length} bill{bills.length === 1 ? "" : "s"} over 14 days, <NextPaymentCaption bills={bills} />
          </span>
        </p>
      </div>
      <ChevronRight size={18} className="text-slate-300 dark:text-slate-600 flex-shrink-0" aria-hidden />
    </button>
  );
}

// ── Variant B — Pressure timeline ────────────────────────────────────────
// Keeps the total as the lead figure, adds a 14-day micro-timeline: one
// slim bar per day, height scaled to that day's outgoing amount, one tonal
// (indigo) family throughout. Today's bar is the only place amber can
// appear, and only when something is genuinely due that day — a single
// signifier, not a flood.

function VariantB({ bills }: { bills: FixtureBill[] }) {
  const total = totalOut(bills);
  const today = dueToday(bills);
  const days = dailyTotals(bills);
  const max = Math.max(...days, 0.01);

  return (
    <button
      type="button"
      className="w-full glass-card rounded-2xl px-4 py-3.5 flex flex-col gap-3 active:scale-[0.99] transition-transform text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Coming up &middot; 14 days
          </p>
          <p className="mt-0.5 text-[19px] font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {fmtSum(total)}
          </p>
        </div>
        <ChevronRight size={18} className="text-slate-300 dark:text-slate-600 flex-shrink-0 mt-1" aria-hidden />
      </div>

      <div className="flex items-end justify-between gap-[3px] h-8">
        {days.map((amt, i) => {
          const isToday = i === 0;
          const hasAmount = amt > 0;
          const heightPct = hasAmount ? 14 + (amt / max) * 86 : 10;
          const isCaution = isToday && hasAmount;
          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
              <div
                className={
                  "w-full rounded-full " +
                  (isCaution
                    ? "bg-amber-600 dark:bg-amber-400"
                    : hasAmount
                      ? "bg-indigo-600 dark:bg-indigo-400/80"
                      : "bg-slate-200 dark:bg-slate-700/50")
                }
                style={{ height: `${heightPct}%` }}
              />
              {isToday && (
                <span
                  aria-hidden
                  className="mt-1 w-1 h-1 rounded-full bg-slate-400 dark:bg-slate-500"
                />
              )}
            </div>
          );
        })}
      </div>

      <p className="flex items-center gap-1.5 text-[13px] text-slate-500 dark:text-slate-400">
        <AmberSignifier show={today.length > 0} />
        <span>
          {bills.length} bill{bills.length === 1 ? "" : "s"}, <NextPaymentCaption bills={bills} />
        </span>
      </p>
    </button>
  );
}

// ── Variant C — Next three ───────────────────────────────────────────────
// Drops the aggregate-first framing: the next three payments as compact
// rows (merchant, date, mono amount), a summary footer carries the 14-day
// total and remaining count. Most concrete, least abstract of the three.

function VariantC({ bills }: { bills: FixtureBill[] }) {
  const total = totalOut(bills);
  const nextThree = bills.slice(0, 3);
  const remaining = bills.length - nextThree.length;

  return (
    <button
      type="button"
      className="w-full glass-card rounded-2xl px-4 py-3.5 flex flex-col active:scale-[0.99] transition-transform text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Coming up &middot; 14 days
        </p>
        <ChevronRight size={16} className="text-slate-300 dark:text-slate-600 flex-shrink-0" aria-hidden />
      </div>

      <div className="mt-2 flex flex-col divide-y divide-slate-100 dark:divide-slate-700/60">
        {nextThree.map((b) => (
          <div key={`${b.name}-${b.date}`} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
            <div className="min-w-0 flex items-center gap-1.5">
              <AmberSignifier show={b.daysAway === 0} />
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {b.name}
                </p>
                <p className="text-[12px] text-slate-400 dark:text-slate-500">
                  {b.daysAway === 0 ? "Today" : b.daysAway === 1 ? "Tomorrow" : b.date}
                </p>
              </div>
            </div>
            <p className="text-[14px] font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100 flex-shrink-0">
              {fmt(b.amount)}
            </p>
          </div>
        ))}
      </div>

      {remaining > 0 ? (
        <p className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700/60 text-[12px] text-slate-500 dark:text-slate-400">
          +{remaining} more &middot; <span className="font-mono tabular-nums">{fmtSum(total)}</span> total over 14 days
        </p>
      ) : (
        <p className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700/60 text-[12px] text-slate-500 dark:text-slate-400">
          <span className="font-mono tabular-nums">{fmtSum(total)}</span> total over 14 days
        </p>
      )}
    </button>
  );
}

// ── D/E/F shared data readings ───────────────────────────────────────────
// Kept beside the variants rather than in fixtures.ts — these are
// presentation-layer readings of the fixture (which zone money falls in,
// whether the fortnight is front-loaded), not fixture data itself.

// settleClusters (zone boundaries: near = daysAway<=1, mid 2-6, far >=7) and
// SettleBar now live in lib/comingUp.tsx, shared with the live card — the
// tilt-per-bar language (+6°/-3°/flat) mirrors the settle mark's own
// three-bar shape, so Variant D/H's bars read as the same three-stage
// settle the icon draws, just at data scale instead of icon scale.

// computeDrop / DropInsight / DropSentence now live in lib/comingUp.tsx,
// shared with the live card — the "penny drops" reading for Variant E: is
// this fortnight front-loaded (a majority of the money lands in the first
// half of the window) or genuinely spread out/quiet.

// ── Variant D — Settling stack ───────────────────────────────────────────
// The central visual borrows the settle mark's own bar language directly:
// three horizontal bars in the same tilt family as the app icon (+6°, -3°,
// flat), one per TIME-ZONE rather than one per bill — 29 individual bills
// would be illegible as bars at this width, but three zones is exactly the
// bar count the glyph itself has. Tilt encodes WHICH zone (near/mid/far),
// never the amount in it, so a genuinely empty near zone still renders as a
// thin tilted sliver rather than lying about being settled; width is the
// only channel carrying magnitude, keeping "when" and "how much" honest and
// independent. The bottom bar is deliberately flat and, when it carries
// money, rendered in a neutral slate rather than indigo — by days 8-14
// there's runway to act, so it reads as at rest, the same "settled" reading
// the icon's own bottom bar carries. The lead mono total stays the
// heaviest element on the card (Numbers Lead Rule holds); the stack is
// evidence underneath it.
//
// Colour, computed against glass-card's own fills (#ffffff light /
// #1a2334 dark), both ≥3:1:
//   near  bg-indigo-600 / dark:bg-indigo-400  — 6.29:1 / 5.28:1
//   mid   bg-indigo-500 (both themes)         — 4.47:1 / 3.52:1
//   far   bg-slate-600 / dark:bg-slate-400    — 7.58:1 / 6.14:1

function VariantD({ bills }: { bills: FixtureBill[] }) {
  const total = totalOut(bills);
  const today = dueToday(bills);
  const [near, mid, far] = settleClusters(bills);
  const maxAmount = Math.max(near.amount, mid.amount, far.amount, 0.01);

  return (
    <button
      type="button"
      className="w-full glass-card rounded-2xl px-4 py-3.5 flex flex-col active:scale-[0.99] transition-transform text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Coming up &middot; 14 days
          </p>
          <p className="mt-0.5 text-[19px] font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {fmtSum(total)}
          </p>
        </div>
        <ChevronRight size={18} className="text-slate-300 dark:text-slate-600 flex-shrink-0 mt-1" aria-hidden />
      </div>

      <div className="mt-2 flex flex-col">
        <SettleBar label={near.label} amount={near.amount} maxAmount={maxAmount} rotate={6} tone="bg-indigo-600 dark:bg-indigo-400" />
        <SettleBar label={mid.label} amount={mid.amount} maxAmount={maxAmount} rotate={-3} tone="bg-indigo-500" />
        <SettleBar label={far.label} amount={far.amount} maxAmount={maxAmount} rotate={0} tone="bg-slate-600 dark:bg-slate-400" />
      </div>

      <p className="mt-1 flex items-center gap-1.5 text-[13px] text-slate-500 dark:text-slate-400">
        <AmberSignifier show={today.length > 0} />
        <span>
          {bills.length} bill{bills.length === 1 ? "" : "s"}, <NextPaymentCaption bills={bills} />
        </span>
      </p>
    </button>
  );
}

// ── Variant E — The drop ─────────────────────────────────────────────────
// Leads with the realisation itself rather than the aggregate: one computed
// sentence (see computeDrop above) stating either how front-loaded the
// fortnight is or, in a genuinely quiet week, how much runway there is
// before the first bill lands. The total/count sit underneath as evidence,
// in mono per the Money Is Mono Rule.
//
// Deliberately bends the Numbers Lead Rule: the sentence (18px/700), not
// the total figure (13px/700 below it), is the heaviest thing on this
// card. The brief calls this out as the one variant allowed to make that
// trade — here the verdict literally IS a sentence, not a number, so making
// the number bigger than the sentence would be lying about what's actually
// doing the informing.
//
// Amber signifier computed against the same pairing as D: amber-600 on
// white (3.19:1), amber-400 on #1a2334 (9.43:1).

function VariantE({ bills }: { bills: FixtureBill[] }) {
  const total = totalOut(bills);
  const today = dueToday(bills);

  return (
    <button
      type="button"
      className="w-full glass-card rounded-2xl px-4 py-3.5 flex flex-col active:scale-[0.99] transition-transform text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        Coming up &middot; 14 days
      </p>
      <p className="mt-1 text-[18px] font-bold leading-snug text-pretty text-slate-900 dark:text-slate-100">
        <DropSentence bills={bills} />
      </p>
      <div className="mt-2.5 pt-2.5 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[13px] text-slate-500 dark:text-slate-400">
          <AmberSignifier show={today.length > 0} />
          <span>
            {bills.length} bill{bills.length === 1 ? "" : "s"} &middot;{" "}
            <span className="font-mono tabular-nums">{fmtSum(total)}</span> total
          </span>
        </p>
        <ChevronRight size={16} className="text-slate-300 dark:text-slate-600 flex-shrink-0" aria-hidden />
      </div>
    </button>
  );
}

// ── Variant F — Coin run ─────────────────────────────────────────────────
// 14 coins along a track, one per day, diameter carrying that day's
// outgoing weight (8px floor, 22px ceiling). Closest to the literal
// "penny" motif, so it carries the highest risk of being a sticker — it
// only earns its place because the coins are doing real work: today is
// marked with a ring (not colour alone, so it survives colour-blindness),
// the heaviest day gets its own named amount/date callout underneath
// rather than relying on eyeballing circle size, and a genuinely empty day
// renders as a small flat slate coin, not indigo — colour still means
// "money is due here", never decoration.
//
// Colour, computed against glass-card's fills, both ≥3:1:
//   filled coin  bg-indigo-600 / dark:bg-indigo-400 — 6.29:1 / 5.28:1
//   empty coin   bg-slate-600 / dark:bg-slate-400   — 7.58:1 / 6.14:1
//   track line   bg-slate-500 / dark:bg-slate-400   — 4.76:1 / 6.14:1
// The today ring sits in ink (slate-900 / slate-100), 17.85:1 / 14.37:1
// against their own cards. The heaviest-day ring is indigo-600 / indigo-400
// (6.29:1 / 5.28:1) instead, deliberately a different colour to "today" so
// the two meanings (temporal marker vs magnitude marker) don't collapse
// into one signifier when a day happens to be both.

function VariantF({ bills }: { bills: FixtureBill[] }) {
  const total = totalOut(bills);
  const today = dueToday(bills);
  const days = dailyTotals(bills);
  const maxAmt = Math.max(...days, 0.01);
  const heaviestIndex = days.reduce((best, amt, i) => (amt > days[best] ? i : best), 0);
  const heaviestBills = bills.filter((b) => b.daysAway === heaviestIndex);
  const heaviestBill = heaviestBills.reduce(
    (max, b) => (max === null || b.amount > max.amount ? b : max),
    heaviestBills[0] ?? null
  );
  const minD = 8;
  const maxD = 22;

  return (
    <button
      type="button"
      className="w-full glass-card rounded-2xl px-4 py-3.5 flex flex-col gap-2.5 active:scale-[0.99] transition-transform text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Coming up &middot; 14 days
          </p>
          <p className="mt-0.5 text-[19px] font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {fmtSum(total)}
          </p>
        </div>
        <ChevronRight size={18} className="text-slate-300 dark:text-slate-600 flex-shrink-0 mt-1" aria-hidden />
      </div>

      <div className="relative h-9 mt-1">
        <div className="absolute left-1 right-1 top-1/2 -translate-y-1/2 h-[1.5px] bg-slate-500 dark:bg-slate-400" aria-hidden />
        <div className="relative flex items-center justify-between h-full">
          {days.map((amt, i) => {
            const isToday = i === 0;
            const isHeaviest = i === heaviestIndex && amt > 0 && !isToday;
            const hasAmount = amt > 0;
            const d = hasAmount ? minD + (amt / maxAmt) * (maxD - minD) : minD;
            return (
              <div key={i} className="flex-1 flex items-center justify-center">
                <div
                  className={
                    "rounded-full flex-shrink-0 " +
                    (hasAmount ? "bg-indigo-600 dark:bg-indigo-400" : "bg-slate-600 dark:bg-slate-400") +
                    (isToday
                      ? " ring-2 ring-offset-1 ring-slate-900 dark:ring-slate-100 ring-offset-white dark:ring-offset-[#1a2334]"
                      : "") +
                    (isHeaviest
                      ? " ring-2 ring-offset-1 ring-indigo-600 dark:ring-indigo-400 ring-offset-white dark:ring-offset-[#1a2334]"
                      : "")
                  }
                  style={{ width: d, height: d }}
                  aria-hidden
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex justify-between">
        {days.map((amt, i) => (
          <div key={i} className="flex-1 text-center text-[9px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
            {i === 0 ? "today" : i === heaviestIndex && amt > 0 ? "peak" : ""}
          </div>
        ))}
      </div>

      {heaviestBill && (
        <p className="text-[12px] text-slate-500 dark:text-slate-400">
          Heaviest day &middot; {heaviestBill.name}
          {heaviestBills.length > 1 ? ` +${heaviestBills.length - 1} more` : ""},{" "}
          <span className="font-mono tabular-nums">{fmtSum(days[heaviestIndex])}</span>, {nextPaymentWhen(heaviestBill)}
        </p>
      )}

      <p className="flex items-center gap-1.5 text-[13px] text-slate-500 dark:text-slate-400">
        <AmberSignifier show={today.length > 0} />
        <span>
          {bills.length} bill{bills.length === 1 ? "" : "s"}, <NextPaymentCaption bills={bills} />
        </span>
      </p>
    </button>
  );
}

// ── G-shared data reading ────────────────────────────────────────────────
// computeHeadsUp / HeadsUpInsight / HeadsUpSentence now live in
// lib/comingUp.tsx, shared with the live card — the one fact-pair a
// heads-up card exists to answer: how long until money next leaves the
// account, and where the real damage in the fortnight sits.

// ── Variant G — Refined coin run ─────────────────────────────────────────
// F's diagnosis: asking 14 coins to each encode that day's magnitude by
// area asks the weakest perceptual channel to do a job it can't do at
// ~366px / 14 days — diameters differ by single-digit pixels, the row reads
// as near-uniform dots, and three lines of prose underneath had to explain
// what the picture failed to say. G stops doing that. The run now carries
// only RHYTHM (which days money actually leaves) plus two explicitly marked
// facts; everything else is quiet texture.
//
// Three independent, non-competing channels, deliberately kept in separate
// geometric zones so several can land on one coin without occluding each
// other. (F's fix for collision was to make "today" and "heaviest" mutually
// exclusive by construction, which quietly hides the fact that today can
// genuinely BE the heaviest day. G doesn't hide it — it stacks the marks.)
//   - SIZE (the dot itself). Presence vs absence is the only thing encoded
//     continuously, and even that isn't a ramp: an empty day is a small
//     flat slate tick (4px, quiet, still visible so the gap reads as
//     runway, not a broken chart); any day with money out is a FIXED 10px
//     indigo dot, full stop. Magnitude beyond "there's a hit here" gets
//     exactly one more step, never a ramp: the single heaviest day in the
//     window is a fixed 16px dot. Two sizes for hit days, never a smooth
//     scale — this is the direct fix for F's failure mode.
//   - RING (around the dot) — today, the axis anchor. Rendered in ink, not
//     a magnitude or caution colour, so "you are here" never gets confused
//     with "this is the big one."
//   - CARET (a small downward triangle above the dot, in its own reserved
//     row) — the next hit. Indigo, to keep the "this is about money" hue
//     family, but a different SHAPE from the ring so it survives colour-
//     blindness and stacks cleanly above whatever the dot/ring are already
//     showing, rather than fighting them for the same pixels.
// A day that is today AND the next hit AND the heaviest (common right after
// payday) renders all three at once: a 16px ringed dot with a caret sitting
// over it. Each mark keeps its own geometric lane so nothing has to be
// suppressed to avoid a clash.
//
// The quiet week (4 of 14 days carrying anything) is the harder case: nine
// or ten flat slate ticks in a row must read as reassurance, not as an
// unloaded chart. Two choices do that work: the ticks are small and inert,
// no colour, no motion, so the eye doesn't hunt them for meaning, and the
// axis line still runs the full 14 days unbroken, so the emptiness reads as
// "quiet stretch on a live timeline" rather than "nothing rendered." The one
// verdict line beneath then names the runway in words ("Next up ... in
// 8 days"), so calm is asserted, not just implied by absence.
//
// Colour: every fill below reuses D/F's already-verified pairs against
// glass-card's own fills (#ffffff light / #1a2334 dark) — no new colour is
// introduced, only geometry changes, and contrast ratio doesn't depend on
// size:
//   hit dot (ordinary + heaviest) bg-indigo-600 / dark:bg-indigo-400 — 6.29:1 / 5.28:1
//   empty tick                    bg-slate-600 / dark:bg-slate-400  — 7.58:1 / 6.14:1
//   axis line                     bg-slate-500 / dark:bg-slate-400  — 4.76:1 / 6.14:1
//   today ring                    ring-slate-900 / dark:ring-slate-100 — 17.85:1 / 14.37:1
//   next-hit caret (currentColor) text-indigo-600 / dark:text-indigo-400 — 6.29:1 / 5.28:1

function VariantG({ bills }: { bills: FixtureBill[] }) {
  const total = totalOut(bills);
  const today = dueToday(bills);
  const days = dailyTotals(bills);
  const nextHitIndex = days.findIndex((d) => d > 0);
  const heaviestIndex = days.reduce((best, amt, i) => (amt > days[best] ? i : best), 0);
  const heaviestHasAmount = days[heaviestIndex] > 0;
  const ORDINARY = 10;
  const HEAVY = 16;
  const EMPTY = 4;

  return (
    <button
      type="button"
      className="w-full glass-card rounded-2xl px-4 py-3.5 flex flex-col gap-1 active:scale-[0.99] transition-transform text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Coming up &middot; 14 days
          </p>
          <p className="mt-0.5 text-[19px] font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {fmtSum(total)}
          </p>
        </div>
        <ChevronRight size={18} className="text-slate-300 dark:text-slate-600 flex-shrink-0 mt-1" aria-hidden />
      </div>

      <div className="mt-2">
        {/* Reserved caret lane — the next hit, kept clear of the dot/ring below it */}
        <div className="flex items-end justify-between h-2.5">
          {days.map((amt, i) => (
            <div key={i} className="flex-1 flex justify-center">
              {i === nextHitIndex && amt > 0 && (
                <div
                  aria-hidden
                  className="text-indigo-600 dark:text-indigo-400"
                  style={{
                    width: 0,
                    height: 0,
                    borderLeft: "4px solid transparent",
                    borderRight: "4px solid transparent",
                    borderTop: "5px solid currentColor",
                  }}
                />
              )}
            </div>
          ))}
        </div>

        <div className="relative h-6 mt-0.5">
          <div
            className="absolute left-1 right-1 top-1/2 -translate-y-1/2 h-[1.5px] bg-slate-500 dark:bg-slate-400"
            aria-hidden
          />
          <div className="relative flex items-center justify-between h-full">
            {days.map((amt, i) => {
              const isToday = i === 0;
              const hasAmount = amt > 0;
              const isHeaviest = i === heaviestIndex && heaviestHasAmount;
              const size = hasAmount ? (isHeaviest ? HEAVY : ORDINARY) : EMPTY;
              return (
                <div key={i} className="flex-1 flex items-center justify-center">
                  <div
                    aria-hidden
                    className={
                      "rounded-full flex-shrink-0 " +
                      (hasAmount ? "bg-indigo-600 dark:bg-indigo-400" : "bg-slate-600 dark:bg-slate-400") +
                      (isToday
                        ? " ring-2 ring-offset-1 ring-slate-900 dark:ring-slate-100 ring-offset-white dark:ring-offset-[#1a2334]"
                        : "")
                    }
                    style={{ width: size, height: size }}
                  />
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between mt-1 text-[9px] font-medium text-slate-400 dark:text-slate-500">
          <span>today</span>
          <span>in 14 days</span>
        </div>
      </div>

      <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-slate-500 dark:text-slate-400">
        <AmberSignifier show={today.length > 0} />
        <span className="text-pretty">
          <HeadsUpSentence bills={bills} />
        </span>
      </p>
    </button>
  );
}

// ── G2-shared: day labels and plain-text mirrors for aria-valuetext ────────
// Screen readers need a plain string, not JSX, so every sentence component
// below (DaySelectionSentence, HeadsUpSentence) has a plain-text twin here
// built off the same computeX() data struct — never a hand-duplicated
// sentence that could drift from what's actually on screen.

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Matches fixtures.ts's own anchor ("today" = Wed 19 Aug 2026) so a
// computed label for an empty day never contradicts a named bill's own
// pre-formatted `date` string landing on the same index.
const ANCHOR_DATE = new Date(2026, 7, 19);

function dayLabel(index: number): string {
  const d = new Date(ANCHOR_DATE);
  d.setDate(d.getDate() + index);
  return `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}`;
}

// Same "today"/"tomorrow"/date convention as nextPaymentWhen, generalised to
// any day index rather than a specific bill.
function dayHeadingWord(index: number): string {
  return index === 0 ? "today" : index === 1 ? "tomorrow" : dayLabel(index);
}

function headsUpPlainText(bills: FixtureBill[]): string {
  const insight = computeHeadsUp(bills);
  if (insight.kind === "empty") return "Nothing due in the next 14 days.";
  const { sameDay, nextBill, heaviestLead, heaviestExtra, heaviestTotal } = insight;
  const heaviestName = heaviestLead.name + (heaviestExtra > 0 ? ` +${heaviestExtra} more` : "");
  if (sameDay) {
    return `Next up is also the heaviest hit: ${heaviestName}, ${fmtSum(heaviestTotal)}, ${nextPaymentWhen(nextBill)}.`;
  }
  return (
    `Next up ${nextBill.name}, ${fmt(nextBill.amount)}, ${nextPaymentWhen(nextBill)}. ` +
    `Heaviest hit is ${heaviestName}, ${fmtSum(heaviestTotal)}, ${nextPaymentWhen(heaviestLead)}.`
  );
}

// ── G2 day-selection reading ─────────────────────────────────────────────
// What's due on ONE tapped/dragged-to day: empty, one named bill, or several
// (with their own combined total). Computed straight from the fixture's
// existing per-bill `daysAway` field — fixtures.ts already carries full
// per-day detail (name + amount per bill), never just daily totals, so no
// fixture changes were needed for this variant.

type DaySelection =
  | { kind: "empty"; when: string }
  | { kind: "single"; when: string; bill: FixtureBill }
  | { kind: "multi"; when: string; bills: FixtureBill[]; total: number };

function computeDaySelection(bills: FixtureBill[], index: number): DaySelection {
  const when = dayHeadingWord(index);
  const dayBills = bills.filter((b) => b.daysAway === index);
  if (dayBills.length === 0) return { kind: "empty", when };
  if (dayBills.length === 1) return { kind: "single", when, bill: dayBills[0] };
  const total = dayBills.reduce((s, b) => s + b.amount, 0);
  return { kind: "multi", when, bills: dayBills, total };
}

function DaySelectionSentence({ bills, index }: { bills: FixtureBill[]; index: number }) {
  const sel = computeDaySelection(bills, index);
  if (sel.kind === "empty") {
    return <>Nothing&apos;s due {sel.when}. That&apos;s a confirmed gap.</>;
  }
  if (sel.kind === "single") {
    return (
      <>
        Due {sel.when}: {sel.bill.name}, <span className="font-mono tabular-nums">{fmt(sel.bill.amount)}</span>.
      </>
    );
  }
  return (
    <>
      Due {sel.when}:{" "}
      {sel.bills.map((b, i) => (
        <Fragment key={b.name}>
          {i > 0 ? "; " : ""}
          {b.name}, <span className="font-mono tabular-nums">{fmt(b.amount)}</span>
        </Fragment>
      ))}
      . <span className="font-mono tabular-nums">{fmtSum(sel.total)}</span> total.
    </>
  );
}

function daySelectionPlainText(bills: FixtureBill[], index: number): string {
  const sel = computeDaySelection(bills, index);
  if (sel.kind === "empty") return `Nothing's due ${sel.when}. That's a confirmed gap.`;
  if (sel.kind === "single") return `Due ${sel.when}: ${sel.bill.name}, ${fmt(sel.bill.amount)}.`;
  const list = sel.bills.map((b) => `${b.name}, ${fmt(b.amount)}`).join("; ");
  return `Due ${sel.when}: ${list}. ${fmtSum(sel.total)} total.`;
}

// ── Variant G2 — Interactive coin run ────────────────────────────────────
// G's track answers "when does money leave, and where's the damage" at a
// glance. Kevin's ask was the natural next question: tap a day, see what it
// is. Two constraints shaped the build:
//
// 1. Fourteen days cannot be fourteen tap targets — at 430px each day gets
//    ~26px, under the 44px floor. The whole track is ONE continuous scrub
//    control instead (role="slider", pointer capture + drag), the same
//    "imprecision is recoverable by sliding" contract as an iOS Health
//    chart scrubber, rather than fourteen buttons daring a mis-tap.
// 2. G's card was a <button> wrapping the whole thing (nav to Planning) —
//    that can't hold a second interactive region without nesting
//    interactive elements. G2 makes the CARD a plain div, the chevron a
//    real button with its own accessible name ("Open Planning"), and the
//    track owns its own gesture and keyboard surface. All three controls
//    are independently reachable and none is nested inside another.
//
// Selected-state collision: a day can be today AND the heaviest day AND
// the tapped day, all at once (common right after payday). Each mark keeps
// its own channel so none has to be suppressed —
//   today      → ink ring (box-shadow ring, unchanged from G)
//   heaviest   → size step (16px vs 10px, unchanged from G)
//   selected   → indigo OUTLINE (CSS outline, offset outside the ring, a
//                different rendering primitive so it never merges with the
//                today ring) PLUS a small indigo tick in its own lane
//                below the dot row — two reinforcing, independent signals
//                for the one state that most needs to be unambiguous.
// Colour reuses the already-verified indigo pair, no new hex introduced:
// bg/outline-indigo-600 (6.29:1) light, dark:indigo-400 (5.28:1) dark,
// both against glass-card's own fills.
//
// Empty-day selection is not a dead end: it states the gap plainly
// ("Nothing's due today. That's a confirmed gap.") — the reassurance this
// card exists to give, made explicit instead of left to be inferred from a
// row of quiet ticks.
//
// Clearing: no auto-clear timer. A reflow triggered by a timeout firing
// mid-read, on a card sitting in a scrolling feed under the user's thumb,
// is exactly the jarring behaviour the height-stability requirement exists
// to prevent — a random few seconds later is a worse trigger than never.
// Three deliberate, no-surprise ways back to the default sentence instead:
// an explicit "Clear" link inlined at the end of the detail sentence,
// Escape while the track is focused, and tapping the already-selected day
// again (tap-to-toggle, mirroring how the drag already snaps to "nearest").
//
// Height stability: both states render through the SAME <p>, sized to a
// `min-h` reserved for the longest realistic line (a 3-bill day on the
// heavy fixture, e.g. "Due Tue 25 Aug: Thames Water, £29.50; Home
// Insurance, £18.20; Credit Card Min Payment, £85.00. £132.70 total.
// Clear"). Measured empirically, not guessed — see verification notes.
//
// Keyboard: role="slider" (not listbox) because the model IS a single
// value moving along an ordered 0-13 range, exactly what a slider's
// contract describes, and it gets arrow/Home/End semantics for free.
// aria-valuenow always holds a real 0-13 number (ARIA requires one); while
// nothing is tapped yet it defaults to 0 but aria-valuetext overrides what
// gets announced to "No day selected." plus the same summary sentence
// sighted users see, so the unselected state is never mis-announced as
// "today selected" — a disclosed compromise, not an oversight.

function VariantG2({ bills }: { bills: FixtureBill[] }) {
  const total = totalOut(bills);
  const today = dueToday(bills);
  const days = dailyTotals(bills);
  const nextHitIndex = days.findIndex((d) => d > 0);
  const heaviestIndex = days.reduce((best, amt, i) => (amt > days[best] ? i : best), 0);
  const heaviestHasAmount = days[heaviestIndex] > 0;
  const ORDINARY = 10;
  const HEAVY = 16;
  const EMPTY = 4;

  const [selected, setSelected] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const gestureStartRef = useRef<{ x: number; index: number | null } | null>(null);

  function indexFromClientX(clientX: number): number {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    const clamped = Math.min(0.999999, Math.max(0, ratio));
    return Math.floor(clamped * 14);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const idx = indexFromClientX(e.clientX);
    gestureStartRef.current = { x: e.clientX, index: selected };
    draggingRef.current = true;
    setSelected(idx);
  }
  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    setSelected(indexFromClientX(e.clientX));
  }
  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    draggingRef.current = false;
    const start = gestureStartRef.current;
    gestureStartRef.current = null;
    if (!start) return;
    const moved = Math.abs(e.clientX - start.x) > 4;
    const idxNow = indexFromClientX(e.clientX);
    // A tap (no real drag) landing back on the day that was already
    // selected toggles it off, mirroring the "tap it again" convention
    // used elsewhere for selection state.
    if (!moved && start.index === idxNow) setSelected(null);
  }
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setSelected((s) => Math.min(13, (s ?? -1) + 1));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setSelected((s) => Math.max(0, (s ?? 14) - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setSelected(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setSelected(13);
    } else if (e.key === "Escape") {
      setSelected(null);
    }
  }

  const valueText =
    selected === null ? `No day selected. ${headsUpPlainText(bills)}` : daySelectionPlainText(bills, selected);

  return (
    <div className="w-full glass-card rounded-2xl px-4 py-3.5 flex flex-col gap-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Coming up &middot; 14 days
          </p>
          <p className="mt-0.5 text-[19px] font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {fmtSum(total)}
          </p>
        </div>
        <button
          type="button"
          aria-label="Open Planning"
          className="w-11 h-11 -m-2.5 flex-shrink-0 flex items-center justify-center rounded-full active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <ChevronRight size={18} className="text-slate-300 dark:text-slate-600" aria-hidden />
        </button>
      </div>

      <div
        ref={trackRef}
        role="slider"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={13}
        aria-valuenow={selected ?? 0}
        aria-valuetext={valueText}
        aria-label="Browse the next 14 days to see what's due"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
        className="mt-2 select-none touch-none rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#1a2334]"
      >
        {/* Reserved caret lane — the next hit, kept clear of the dot/ring below it */}
        <div className="flex items-end justify-between h-2.5">
          {days.map((amt, i) => (
            <div key={i} className="flex-1 flex justify-center">
              {i === nextHitIndex && amt > 0 && (
                <div
                  aria-hidden
                  className="text-indigo-600 dark:text-indigo-400"
                  style={{
                    width: 0,
                    height: 0,
                    borderLeft: "4px solid transparent",
                    borderRight: "4px solid transparent",
                    borderTop: "5px solid currentColor",
                  }}
                />
              )}
            </div>
          ))}
        </div>

        <div className="relative h-6 mt-0.5">
          <div
            className="absolute left-1 right-1 top-1/2 -translate-y-1/2 h-[1.5px] bg-slate-500 dark:bg-slate-400"
            aria-hidden
          />
          <div className="relative flex items-center justify-between h-full">
            {days.map((amt, i) => {
              const isToday = i === 0;
              const hasAmount = amt > 0;
              const isHeaviest = i === heaviestIndex && heaviestHasAmount;
              const isSelected = selected === i;
              const size = hasAmount ? (isHeaviest ? HEAVY : ORDINARY) : EMPTY;
              return (
                <div key={i} className="flex-1 flex items-center justify-center">
                  <div
                    aria-hidden
                    className={
                      "rounded-full flex-shrink-0 outline outline-2 outline-offset-2 transition-[outline-color] duration-200 motion-reduce:duration-0 " +
                      (hasAmount ? "bg-indigo-600 dark:bg-indigo-400" : "bg-slate-600 dark:bg-slate-400") +
                      (isToday
                        ? " ring-2 ring-offset-1 ring-slate-900 dark:ring-slate-100 ring-offset-white dark:ring-offset-[#1a2334]"
                        : "") +
                      (isSelected ? " outline-indigo-600 dark:outline-indigo-400" : " outline-transparent")
                    }
                    style={{ width: size, height: size }}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Selection lane — always present (never mounted/unmounted) so
            toggling selection never nudges the track's own height, and the
            tick can crossfade in/out via opacity instead of layout. */}
        <div className="flex items-center justify-between h-[7px] mt-1">
          {days.map((amt, i) => (
            <div key={i} className="flex-1 flex justify-center">
              <div
                aria-hidden
                className={
                  "h-[3px] w-3 rounded-full bg-indigo-600 dark:bg-indigo-400 transition-opacity duration-200 motion-reduce:duration-0 " +
                  (selected === i ? "opacity-100" : "opacity-0")
                }
              />
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between mt-1 text-[9px] font-medium text-slate-400 dark:text-slate-500">
          <span>today</span>
          <span>in 14 days</span>
        </div>
      </div>

      <p className="mt-1.5 flex items-start gap-1.5 text-[13px] text-slate-500 dark:text-slate-400 min-h-[54px] sm:min-h-0">
        <span className="mt-[3px]">
          <AmberSignifier show={today.length > 0} />
        </span>
        <span className="text-pretty">
          {selected === null ? (
            <HeadsUpSentence bills={bills} />
          ) : (
            <>
              <DaySelectionSentence bills={bills} index={selected} />{" "}
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="font-semibold text-indigo-600 dark:text-indigo-400 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
              >
                Clear
              </button>
            </>
          )}
        </span>
      </p>
    </div>
  );
}

// ── Variant H — Settling stack + heads-up ────────────────────────────────
// D's geometry read instantly at heavy density (29 bills, 14 days) because
// the middle bar visibly holds most of the money; G's rhythm-of-dots read
// instantly at quiet density but collapsed at heavy density, where 13 of 14
// days are hit days and the enlarged "heaviest" dot hides among a dozen
// ordinary ones. H keeps D's three-zone bars (the geometry that survives
// density) and swaps D's weaker footer ("29 bills, next Council Tax, £142,
// today") for G's computed verdict sentence, reusing computeHeadsUp /
// HeadsUpSentence verbatim rather than re-deriving it — the sentence is
// pure data-in, JSX-out and made no assumption about G's dot geometry, so
// it needed zero parameterising to sit under D's bars instead. One
// implementation, both variants; it cannot drift.
//
// Colour resolution — D's bars used tilt AND colour to encode zone
// distance (indigo near/mid, slate far), which contradicted itself on the
// quiet fixture: the longest bar (days 8-14, the far/grey zone) carried
// more money than a much shorter indigo bar. Grey reads as muted/inactive
// in this system, so the heaviest amount was wearing the least important
// colour. H resolves this via (a): colour is dropped as a second distance
// channel. All three bars share the one already-verified indigo tone
// (bg-indigo-600 / dark:bg-indigo-400, 6.29:1 / 5.28:1 against glass-card's
// own fills); tilt (the settle mark's own +6°/-3°/flat language) and width
// alone carry distance and magnitude, so nothing is asked to do two jobs at
// once and the longest bar is never dressed as the least important one.
// (b) was rejected: "subtle enough to never read as inactive" is a moving,
// unverifiable target, whereas removing the redundant channel is a one-time
// fix that cannot regress. The genuinely-empty-zone tick (amount = 0) keeps
// D's existing neutral slate treatment unchanged — that colour never meant
// "far", it meant "nothing here", so it isn't part of the contradiction and
// isn't touched.

function VariantH({ bills }: { bills: FixtureBill[] }) {
  const total = totalOut(bills);
  const today = dueToday(bills);
  const [near, mid, far] = settleClusters(bills);
  const maxAmount = Math.max(near.amount, mid.amount, far.amount, 0.01);

  return (
    <button
      type="button"
      className="w-full glass-card rounded-2xl px-4 py-3.5 flex flex-col active:scale-[0.99] transition-transform text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Coming up &middot; 14 days
          </p>
          <p className="mt-0.5 text-[19px] font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {fmtSum(total)}
          </p>
        </div>
        <ChevronRight size={18} className="text-slate-300 dark:text-slate-600 flex-shrink-0 mt-1" aria-hidden />
      </div>

      <div className="mt-2 flex flex-col">
        <SettleBar label={near.label} amount={near.amount} maxAmount={maxAmount} rotate={6} tone="bg-indigo-600 dark:bg-indigo-400" />
        <SettleBar label={mid.label} amount={mid.amount} maxAmount={maxAmount} rotate={-3} tone="bg-indigo-600 dark:bg-indigo-400" />
        <SettleBar label={far.label} amount={far.amount} maxAmount={maxAmount} rotate={0} tone="bg-indigo-600 dark:bg-indigo-400" />
      </div>

      <p className="mt-1 flex items-center gap-1.5 text-[13px] text-slate-500 dark:text-slate-400">
        <AmberSignifier show={today.length > 0} />
        <span className="text-pretty">
          <HeadsUpSentence bills={bills} />
        </span>
      </p>
    </button>
  );
}

// ── Page scaffold ─────────────────────────────────────────────────────────

function VariantSection({
  letter,
  name,
  Component,
  showHeavy = false,
}: {
  letter: string;
  name: string;
  Component: (props: { bills: FixtureBill[] }) => React.JSX.Element;
  showHeavy?: boolean;
}) {
  return (
    <section>
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
        {letter} &middot; {name}
      </p>
      <div className="mt-2 flex flex-col gap-4">
        <div>
          <p className="mb-1.5 text-[11px] text-slate-400 dark:text-slate-500">Busy week (real fixture)</p>
          <Component bills={BUSY_BILLS} />
        </div>
        <div>
          <p className="mb-1.5 text-[11px] text-slate-400 dark:text-slate-500">Quiet week (no caution)</p>
          <Component bills={QUIET_BILLS} />
        </div>
        {showHeavy && (
          <div>
            <p className="mb-1.5 text-[11px] text-slate-400 dark:text-slate-500">
              Heavy load (29 bills, real-world scale)
            </p>
            <Component bills={HEAVY_BILLS} />
          </div>
        )}
      </div>
    </section>
  );
}

export default function ComingUpClient() {
  const searchParams = useSearchParams();
  const mode: Mode = searchParams.get("mode") === "dark" ? "dark" : "light";
  const state = searchParams.get("state") ?? "everything";

  useEffect(() => {
    const t = setTimeout(() => {
      document.documentElement.classList.toggle("dark", mode === "dark");
      document
        .querySelector('meta[name="color-scheme"]')
        ?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    }, 0);
    return () => clearTimeout(t);
  }, [mode]);

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a]" style={{ colorScheme: mode }}>
        <div className="mx-auto w-full max-w-[430px] px-4 pt-6 pb-16">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
            Preview &middot; Coming up card &middot; {mode} &middot; {state}
          </p>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Coming up</h1>
          <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
            A to C: the busy 20-bill week that exposed the count bug, and a quiet week where nothing is a
            caution. D to F build on the brand&apos;s own settle mark (&quot;the penny drops&quot;) and add a
            third, heavier scenario, 29 bills and £4,173, matching what the real live card shows today.
          </p>

          <div className="mt-3 flex items-center gap-3">
            <a
              href={`?mode=light&state=${state}`}
              className="text-[11px] font-medium text-slate-400 dark:text-slate-500 underline underline-offset-2"
            >
              Light
            </a>
            <a
              href={`?mode=dark&state=${state}`}
              className="text-[11px] font-medium text-slate-400 dark:text-slate-500 underline underline-offset-2"
            >
              Dark
            </a>
          </div>

          <div className="mt-6 flex flex-col gap-8">
            <section className="pb-6 border-b border-slate-200 dark:border-slate-700/60">
              <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
                Squint test &middot; H vs G
              </p>
              <p className="mt-1.5 text-[12px] text-slate-500 dark:text-slate-400 text-pretty">
                Glance at each card for a second: which one tells you what&apos;s coming, and when, first, at
                both densities? H is D&apos;s three-zone bars with G&apos;s computed verdict sentence as its
                footer, in one indigo tone. Same two fixtures for both, the heavy load (29 bills,{" "}
                <span className="font-mono tabular-nums">£4,173</span>) and the quiet week.
              </p>
              <div className="mt-3 flex flex-col gap-4">
                <div>
                  <p className="mb-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                    H &middot; Settling stack + heads-up &middot; Heavy load
                  </p>
                  <VariantH bills={HEAVY_BILLS} />
                </div>
                <div>
                  <p className="mb-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                    G &middot; Refined coin run &middot; Heavy load
                  </p>
                  <VariantG bills={HEAVY_BILLS} />
                </div>
                <div>
                  <p className="mb-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                    H &middot; Settling stack + heads-up &middot; Quiet week
                  </p>
                  <VariantH bills={QUIET_BILLS} />
                </div>
                <div>
                  <p className="mb-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                    G &middot; Refined coin run &middot; Quiet week
                  </p>
                  <VariantG bills={QUIET_BILLS} />
                </div>
              </div>
            </section>

            <section className="pb-6 border-b border-slate-200 dark:border-slate-700/60">
              <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
                G2 &middot; Interactive coin run
              </p>
              <p className="mt-1.5 text-[12px] text-slate-500 dark:text-slate-400 text-pretty">
                Kevin&apos;s ask: tap a day on the coin run to see what&apos;s on it, &quot;useful at a
                glance.&quot; The track is one continuous scrub control (drag or tap, keyboard-operable), not
                fourteen tap targets. Default state reads exactly as G; tap or drag along the track to swap the
                verdict line for that day&apos;s detail. Same two fixtures, heavy load and quiet week.
              </p>
              <div className="mt-3 flex flex-col gap-4">
                <div>
                  <p className="mb-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                    G2 &middot; Interactive coin run &middot; Heavy load
                  </p>
                  <VariantG2 bills={HEAVY_BILLS} />
                </div>
                <div>
                  <p className="mb-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                    G2 &middot; Interactive coin run &middot; Quiet week
                  </p>
                  <VariantG2 bills={QUIET_BILLS} />
                </div>
              </div>
            </section>

            <section className="pb-6 border-b border-slate-200 dark:border-slate-700/60">
              <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
                Head-to-head &middot; G vs D
              </p>
              <p className="mt-1.5 text-[12px] text-slate-500 dark:text-slate-400 text-pretty">
                A squint test, not a walkthrough: glance at each card for a second and see which one tells you
                what&apos;s coming, and when, first. Same two fixtures for both, the heavy load (29 bills,{" "}
                <span className="font-mono tabular-nums">£4,173</span>) and the quiet week.
              </p>
              <div className="mt-3 flex flex-col gap-4">
                <div>
                  <p className="mb-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                    G &middot; Refined coin run &middot; Heavy load
                  </p>
                  <VariantG bills={HEAVY_BILLS} />
                </div>
                <div>
                  <p className="mb-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                    D &middot; Settling stack &middot; Heavy load
                  </p>
                  <VariantD bills={HEAVY_BILLS} />
                </div>
                <div>
                  <p className="mb-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                    G &middot; Refined coin run &middot; Quiet week
                  </p>
                  <VariantG bills={QUIET_BILLS} />
                </div>
                <div>
                  <p className="mb-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                    D &middot; Settling stack &middot; Quiet week
                  </p>
                  <VariantD bills={QUIET_BILLS} />
                </div>
              </div>
            </section>

            <VariantSection letter="A" name="Ledger line" Component={VariantA} />
            <VariantSection letter="B" name="Pressure timeline" Component={VariantB} />
            <VariantSection letter="C" name="Next three" Component={VariantC} />
            <VariantSection letter="D" name="Settling stack" Component={VariantD} showHeavy />
            <VariantSection letter="E" name="The drop" Component={VariantE} showHeavy />
            <VariantSection letter="F" name="Coin run" Component={VariantF} showHeavy />
            <VariantSection letter="G" name="Refined coin run" Component={VariantG} showHeavy />
          </div>
        </div>
      </div>
    </div>
  );
}
