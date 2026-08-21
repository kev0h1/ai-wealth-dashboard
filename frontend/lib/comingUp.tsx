// Shared "Coming up" helpers — single source of truth for both the live
// Home card (components/UpcomingBillsStrip.tsx, Variant H) and its design
// preview (app/design/coming-up/ComingUpClient.tsx). Everything here is
// pure data-in/JSX-out: no fetching, no router, no currency assumption
// baked in beyond a `£` default so the preview's call sites (which never
// pass a region) keep working unchanged. The live card always passes its
// own region symbol explicitly.
//
// Do not fork this file per call site — if a call site needs different
// behaviour, parameterise it here instead, otherwise the preview and the
// live card can silently drift apart again (the exact failure mode this
// port was meant to close off).

import { Fragment, type ReactNode } from "react";

export type ComingUpBill = {
  name: string;
  amount: number;
  daysAway: number; // 0 = today, 1 = tomorrow, up to 13 = the 14th day
  date: string; // pre-formatted display date, e.g. "Wed 19 Aug" (used when daysAway > 1)
  isoDate?: string; // YYYY-MM-DD, when available — used for deep-linking, never for display maths
  // "commitment" | "discretionary" | "movement", carried straight through
  // from api.ts's UpcomingBill.kind. Absent on design-preview fixtures and
  // on caches predating the field — see isSpend() for the fallback.
  kind?: "commitment" | "discretionary" | "movement";
};

export type Cluster = { label: string; amount: number };

// This card's job is the shape of money going OUT AS SPEND — a
// "movement" (transfer/savings/investment STO) still leaves the account,
// but it isn't consumed, so it must never be announced as a bill "due".
// Fail-safe fallback: a missing/unrecognised kind reads as spend (only an
// explicit "movement" is excluded) — the same direction api.ts's own
// fallback comment chooses, and the one categories.py calls "the dangerous
// direction to be wrong in" for undercounting spend.
export function isSpend(bill: ComingUpBill): boolean {
  return bill.kind !== "movement";
}

export function totalOut(bills: ComingUpBill[]): number {
  return bills.reduce((sum, b) => sum + b.amount, 0);
}

export function dueToday(bills: ComingUpBill[]): ComingUpBill[] {
  return bills.filter((b) => b.daysAway === 0);
}

/** Buckets bill amounts into 14 daily totals (index 0 = today). Computed
 *  from the bill list, not hand-authored, so per-day totals can never
 *  drift from the total shown elsewhere on the card. Anything at or past
 *  day 14 is out of this window's scope by construction. */
export function dailyTotals(bills: ComingUpBill[]): number[] {
  const days = new Array(14).fill(0) as number[];
  for (const b of bills) {
    if (b.daysAway >= 0 && b.daysAway < 14) days[b.daysAway] += b.amount;
  }
  return days;
}

// Buckets the 14-day window into the settle mark's own three-bar shape:
// near (today+tomorrow), mid (days 3-7), far (days 8-14). Not an arbitrary
// split — it mirrors the bar COUNT the brand glyph itself has.
export function settleClusters(bills: ComingUpBill[]): [Cluster, Cluster, Cluster] {
  const near = bills.filter((b) => b.daysAway <= 1).reduce((s, b) => s + b.amount, 0);
  const mid = bills.filter((b) => b.daysAway >= 2 && b.daysAway <= 6).reduce((s, b) => s + b.amount, 0);
  const far = bills.filter((b) => b.daysAway >= 7).reduce((s, b) => s + b.amount, 0);
  return [
    { label: "Next 2 days", amount: near },
    { label: "Days 3 to 7", amount: mid },
    { label: "Days 8 to 14", amount: far },
  ];
}

export function nextPaymentWhen(bill: ComingUpBill): string {
  return bill.daysAway === 0 ? "today" : bill.daysAway === 1 ? "tomorrow" : bill.date;
}

// The one fact-pair a heads-up card exists to answer: how long until money
// next leaves the account, and where the real damage in the fortnight sits.
export type HeadsUpInsight =
  | { kind: "empty" }
  | {
      kind: "insight";
      sameDay: boolean;
      nextBill: ComingUpBill;
      heaviestLead: ComingUpBill;
      heaviestExtra: number;
      heaviestTotal: number;
    };

/** `bills` must already be sorted by daysAway ascending (both the preview
 *  fixtures and the live /cashflow endpoint's upcoming_bills are) — bills[0]
 *  is read as "the very next hit". */
export function computeHeadsUp(bills: ComingUpBill[]): HeadsUpInsight {
  if (bills.length === 0) return { kind: "empty" };
  const days = dailyTotals(bills);
  const nextBill = bills[0];
  const heaviestIndex = days.reduce((best, amt, i) => (amt > days[best] ? i : best), 0);
  const heaviestBills = bills.filter((b) => b.daysAway === heaviestIndex);
  const heaviestLead = heaviestBills.reduce((max, b) => (b.amount > max.amount ? b : max), heaviestBills[0]);
  return {
    kind: "insight",
    sameDay: nextBill.daysAway === heaviestIndex,
    nextBill,
    heaviestLead,
    heaviestExtra: heaviestBills.length - 1,
    heaviestTotal: days[heaviestIndex],
  };
}

export function fmt(amount: number, sym = "£"): string {
  return `${sym}${amount.toLocaleString("en-GB", { minimumFractionDigits: amount % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}

// Rounding rule: a figure that SUMS more than one bill (a card's headline
// total, a zone aggregate) always rounds to whole units. A figure that is
// one NAMED bill's own amount keeps its pence (use `fmt`) because it's a
// precise number the user will recognise on their statement.
export function fmtSum(amount: number, sym = "£"): string {
  return `${sym}${amount.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-08-24" -> "Mon 24 Aug", the same convention the fixtures'
 *  pre-formatted `date` field already uses. Parsed as a local date (not
 *  UTC) so the label can't roll back a day for users west of UTC. */
export function formatShortDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`);
  return `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}`;
}

// Sole amber caution/urgency signifier. amber-500 was tried first and
// measured 2.15:1 against a white card, failing the 3:1 non-text/graphical-
// object floor, so it was rejected. This pairing passes in both themes:
// amber-600 on light (3.19:1), amber-400 on dark (9.43:1), computed with the
// WCAG relative-luminance formula against #ffffff / #1a2334 (glass-card's
// own fills), not eyeballed — do not revert to amber-500, it fails the floor.
export function AmberSignifier({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span
      aria-hidden
      className="inline-block w-1.5 h-1.5 rounded-full bg-amber-600 dark:bg-amber-400 flex-shrink-0"
    />
  );
}

// Variant D/H's settle-mark bar. A zone with nothing in it must not draw a
// coloured bar — that implies volume that isn't there. It still renders as
// the same thin minW sliver (so the row doesn't vanish and the three-zone
// rhythm holds), but recoloured to a flat neutral tick instead of the
// zone's own tone.
export function SettleBar({
  label,
  amount,
  maxAmount,
  rotate,
  tone,
  sym = "£",
}: {
  label: string;
  amount: number;
  maxAmount: number;
  rotate: number;
  tone: string;
  sym?: string;
}) {
  const minW = 28;
  const maxW = 168;
  const isEmpty = amount <= 0;
  const width = maxAmount > 0 ? minW + (amount / maxAmount) * (maxW - minW) : minW;
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="w-[168px] flex-shrink-0 flex items-center" style={{ height: 22 }}>
        <div
          className={`h-[13px] rounded-full ${isEmpty ? "bg-slate-200 dark:bg-slate-700/50" : tone}`}
          style={{ width, transform: `rotate(${rotate}deg)`, transformOrigin: "center" }}
        />
      </div>
      <div className="min-w-0">
        <p className="text-[12px] font-medium text-slate-700 dark:text-slate-300 truncate">{label}</p>
        <p className="text-[12px] font-mono tabular-nums text-slate-500 dark:text-slate-400">{fmtSum(amount, sym)}</p>
      </div>
    </div>
  );
}

// Renders the Variant G/H computed verdict: who's next, and where the real
// damage in the fortnight sits. Pure data-in, JSX-out off computeHeadsUp,
// so it cannot drift from the numbers underneath it the way a hand-authored
// sentence per scenario could.
export function HeadsUpSentence({ bills, sym = "£" }: { bills: ComingUpBill[]; sym?: string }): ReactNode {
  const insight = computeHeadsUp(bills);
  if (insight.kind === "empty") return <>Nothing due in the next 14 days.</>;
  const { sameDay, nextBill, heaviestLead, heaviestExtra, heaviestTotal } = insight;
  // Names are passed through humaniseBillName here (render layer, same
  // place fmt/fmtSum formatting happens), mirroring DropSentence — raw bank
  // descriptors (B/CARD, digit-run reference noise, ALL-CAPS) must never
  // reach the card.
  const heaviestName = humaniseBillName(heaviestLead.name) + (heaviestExtra > 0 ? ` +${heaviestExtra} more` : "");
  if (sameDay) {
    return (
      <Fragment>
        Next up is also the heaviest hit: {heaviestName},{" "}
        <span className="font-mono tabular-nums">{fmtSum(heaviestTotal, sym)}</span>, {nextPaymentWhen(nextBill)}.
      </Fragment>
    );
  }
  return (
    <Fragment>
      Next up {humaniseBillName(nextBill.name)},{" "}
      <span className="font-mono tabular-nums">{fmt(nextBill.amount, sym)}</span>, {nextPaymentWhen(nextBill)}.
      Heaviest hit is {heaviestName},{" "}
      <span className="font-mono tabular-nums">{fmtSum(heaviestTotal, sym)}</span>, {nextPaymentWhen(heaviestLead)}.
    </Fragment>
  );
}

// ── Humanising raw bank bill descriptors ─────────────────────────────────
// Ports backend/app/services/companion.py's _humanise_bill_name(name)
// (line ~65) into the frontend, scoped to the "Coming up" card's computed
// sentence only — Planning's own bill rows keep showing the raw provider
// descriptor unchanged, that may be deliberate. Mirrors the Python
// implementation's actual regex behaviour (verified against its own
// docstring examples), not just the comment summary: MTG-shorthand,
// mixed-case pass-through (only strips digit-run/card-fragment noise,
// never recases an already-human name), then for ALL-CAPS bank names —
// industry aliases (B/CARD, DDR, DD/STO suffixes), strip digit runs ≥4,
// strip card-fragment pairs, strip a trailing 1-2 char ALL-CAPS token,
// collapse whitespace/trim dangling separators, then title-case remaining
// ALL-CAPS words ≥3 chars. Do not "fix" apparent quirks (e.g. punctuation
// like `*`/`#` surviving, or a 2-char trailing token surviving when a
// digit-strip left a trailing space ahead of it) without re-checking the
// Python side first — those are its actual behaviour, not bugs here.
const BILL_NAME_ALIASES: [RegExp, string][] = [
  [/\bB\/CARD\b/gi, "Barclaycard"],
  [/\bDDR\b/gi, ""],
  [/\bDD\b(?=\s|$)/gi, ""],
  [/\bSTO\b(?=\s|$)/gi, ""],
];

function stripEdgeSeparators(s: string): string {
  return s.replace(/^[ \-–—_/·]+/, "").replace(/[ \-–—_/·]+$/, "");
}

/** Word-boundary-safe cap so one pathological descriptor (a long raw
 *  reference string) can't blow the card's sentence, and so its height,
 *  out. Cuts at the last space within the limit, never mid-word, and
 *  marks the cut with an ellipsis (never an em-dash, per copy rules). */
function capName(s: string, maxLen = 32): string {
  if (s.length <= maxLen) return s;
  let cut = s.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > 0) cut = cut.slice(0, lastSpace);
  return cut.trimEnd() + "…";
}

export function humaniseBillName(name: string): string {
  const raw = (name ?? "").trim();
  if (!raw) return "bill";

  // Rule 1: mortgage shorthand
  if (/^MTG[\s-]*\d+$/i.test(raw)) return "mortgage payment";

  // Rule 2: mixed-case pass-through — only strip noise, don't recase
  const hasLower = /[a-z]/.test(raw);
  const hasUpper = /[A-Z]/.test(raw);
  if (hasLower && hasUpper) {
    let cleaned = raw.replace(/\d{4,}/g, "");
    cleaned = cleaned.replace(/\b\d{4}[\s\-–—]\d{2,}\b/g, "");
    cleaned = cleaned.replace(/\s+/g, " ").trim();
    cleaned = stripEdgeSeparators(cleaned).trim();
    return capName(cleaned || "bill");
  }

  // Rule 3: ALL-CAPS bank names — full normalisation pipeline
  let cleaned = raw;
  for (const [pattern, replacement] of BILL_NAME_ALIASES) {
    cleaned = cleaned.replace(pattern, replacement);
  }
  cleaned = cleaned.replace(/\d{4,}/g, "");
  cleaned = cleaned.replace(/\b\d{4}[\s\-–—]\d{2,}\b/g, "");
  cleaned = cleaned.replace(/\s+[A-Z]{1,2}$/, "");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  cleaned = stripEdgeSeparators(cleaned).trim();
  cleaned = cleaned.replace(/[A-Za-z]+/g, (w) =>
    w.length >= 3 && w === w.toUpperCase() ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w
  );
  return capName(cleaned || "bill");
}

// ── Variant E computed reading: "the penny drops" ────────────────────────
// Is this fortnight front-loaded (a majority of the money lands in the
// first half of the window) or genuinely spread out/quiet? Computed fresh
// from the bill list every render, never a hand-authored sentence per
// scenario, so it can't drift from the numbers underneath it.
//
// Every branch below that names a "heaviest"/"lead" day also carries how
// many bills share that day (`*Extra`, i.e. "N payments"). A day can carry
// several payments (the owner's real fortnight had 8 land on the same
// Tuesday, only £139 of which was the single largest one) — a sentence
// that names one bill's own amount for a day it shares with others
// understates that day's real damage by omission. The rule held everywhere
// in this file: if a figure describes a day, it is that day's sum
// (`fmtSum`); a bill's own amount (`fmt`, keeps pence) is only ever used
// when nothing else lands the same day.
//
// Deliberately does NOT carry a merchant name for the heaviest-day clause
// (naming the largest bill there is explicitly optional per the copy
// brief). A named merchant can be up to 32 chars after capName, and
// "led by <name>" pushed the owner's real 8-payment Tuesday to 3 lines at
// 430px on every construction tried — day + total + count reads cleanly in
// 2 regardless of merchant name length, which a name-carrying sentence
// can't guarantee. See computeHeadsUp/HeadsUpSentence for the sibling
// verdict that DOES name a bill, where it's the only fact in the sentence
// and has the room.
export type DropInsight =
  | { kind: "empty" }
  | {
      kind: "concentrated";
      days: number;
      pct: number;
      leadExtra: number; // other bills sharing leadWhen's date
      leadDayTotal: number; // leadWhen's own day total
      leadWhen: string;
      total: number;
    }
  // A runway genuinely worth naming — nothing lands for at least 2 days.
  // (See MIN_RUNWAY_DAYS below for why 2, not 1 or 0.)
  | {
      kind: "calm";
      gapDays: number;
      heavyExtra: number; // other bills sharing heavyWhen's date
      heavyDayTotal: number; // heavyWhen's own day total
      heavyWhen: string;
      total: number;
    }
  // Not front-loaded overall, but something is due today or tomorrow — the
  // "nothing's due" story would be false, so lead with what's landing now
  // instead, same as `calm` leads with the runway.
  | {
      kind: "landing";
      when: "today" | "tomorrow";
      landingAmount: number; // the landing day's own total, already a sum
      sameDay: boolean; // the landing day IS the heaviest day in the window
      heavyExtra: number; // other bills sharing heavyWhen's date
      heavyDayTotal: number; // heavyWhen's own day total
      heavyWhen: string;
      total: number;
    };

// A 1-day gap isn't a runway worth a sentence ("nothing's due tomorrow" reads
// as filler, not reassurance), and a 0-day gap is a contradiction (bills[]
// wouldn't be empty on day 0). 2 days is the shortest gap that still reads as
// genuine breathing room. Below this, `calm` is unreachable — `landing`
// covers it instead.
const MIN_RUNWAY_DAYS = 2;

export function computeDrop(bills: ComingUpBill[]): DropInsight {
  const total = totalOut(bills);
  if (bills.length === 0 || total <= 0) return { kind: "empty" };

  const days = dailyTotals(bills);
  // Number of OTHER bills sharing a given day, beyond the one used to read
  // that day's date/when. Shared by every branch below so "how many
  // payments make up this day" can never drift from the bill list.
  const otherBillsOnDay = (dayIndex: number) => bills.filter((b) => b.daysAway === dayIndex).length - 1;

  let cum = 0;
  let crossDay = -1;
  for (let i = 0; i < days.length; i++) {
    cum += days[i];
    if (cum / total >= 0.5) {
      crossDay = i;
      break;
    }
  }
  const frontLoaded = crossDay >= 0 && crossDay <= 6; // majority lands in the window's first half

  if (frontLoaded) {
    const windowBills = bills.filter((b) => b.daysAway <= crossDay);
    const lead = windowBills.reduce((max, b) => (b.amount > max.amount ? b : max), windowBills[0]);
    const cumAmt = days.slice(0, crossDay + 1).reduce((s, a) => s + a, 0);
    return {
      kind: "concentrated",
      days: crossDay + 1,
      pct: Math.round((cumAmt / total) * 100),
      leadExtra: otherBillsOnDay(lead.daysAway),
      leadDayTotal: days[lead.daysAway],
      leadWhen: nextPaymentWhen(lead),
      total,
    };
  }

  // Spread out / back-loaded: name the single heaviest day, instead of
  // forcing a front-load story onto a fortnight that doesn't have one.
  const gapDays = bills.reduce((min, b) => Math.min(min, b.daysAway), 13);
  const heaviestDayIndex = days.reduce((best, amt, i) => (amt > days[best] ? i : best), 0);
  const heavyBillsOnDay = bills.filter((b) => b.daysAway === heaviestDayIndex);
  const heavy = heavyBillsOnDay.reduce((max, b) => (b.amount > max.amount ? b : max), heavyBillsOnDay[0]);

  if (gapDays < MIN_RUNWAY_DAYS) {
    // Something is due today or tomorrow — lead with that fact rather than
    // a false "nothing's due" claim. `landingAmount` is the day's own total
    // (may be several bills, e.g. today's four small hits), read straight
    // off `days[]` so it can never drift from the daily buckets.
    return {
      kind: "landing",
      when: gapDays === 0 ? "today" : "tomorrow",
      landingAmount: days[gapDays],
      sameDay: gapDays === heaviestDayIndex,
      heavyExtra: otherBillsOnDay(heaviestDayIndex),
      heavyDayTotal: days[heaviestDayIndex],
      heavyWhen: nextPaymentWhen(heavy),
      total,
    };
  }

  return {
    kind: "calm",
    gapDays,
    heavyExtra: otherBillsOnDay(heaviestDayIndex),
    heavyDayTotal: days[heaviestDayIndex],
    heavyWhen: nextPaymentWhen(heavy),
    total,
  };
}

// "8 payments" / "1 payment" — the explicit count a heaviest-day clause
// names, so the reader never has to do "+N more" arithmetic to see how many
// payments are behind a day's total.
function paymentCount(n: number): string {
  return `${n} payment${n === 1 ? "" : "s"}`;
}

// Renders the Variant E computed verdict sentence off computeDrop. No
// merchant name here (see the DropInsight comment above for why) — dates,
// totals and counts only, so the sentence's length never depends on how
// long a merchant's name happens to be.
export function DropSentence({ bills, sym = "£" }: { bills: ComingUpBill[]; sym?: string }): ReactNode {
  const insight = computeDrop(bills);
  if (insight.kind === "empty") {
    return <>Nothing due in the next 14 days.</>;
  }
  if (insight.kind === "concentrated") {
    if (insight.days === 1) {
      // The front-loaded window is exactly one day (today) — that IS the
      // heaviest day, so don't restate "today" as two separate facts.
      // Mirrors landing's sameDay fold below.
      return (
        <Fragment>
          <span className="font-mono tabular-nums">{fmtSum(insight.leadDayTotal, sym)}</span> due {insight.leadWhen}{" "}
          across {paymentCount(insight.leadExtra + 1)}, {insight.pct}% of this fortnight.
        </Fragment>
      );
    }
    return (
      <Fragment>
        The next {insight.days} days carry {insight.pct}%. Heaviest: {insight.leadWhen},{" "}
        <span className="font-mono tabular-nums">{fmtSum(insight.leadDayTotal, sym)}</span> across{" "}
        {paymentCount(insight.leadExtra + 1)}.
      </Fragment>
    );
  }
  if (insight.kind === "landing") {
    if (insight.sameDay) {
      // The day something lands is also the fortnight's heaviest day —
      // don't restate the same total twice, just fold it into one clause.
      return (
        <Fragment>
          <span className="font-mono tabular-nums">{fmtSum(insight.landingAmount, sym)}</span> due {insight.when}{" "}
          across {paymentCount(insight.heavyExtra + 1)}, the heaviest hit of the fortnight.
        </Fragment>
      );
    }
    return (
      <Fragment>
        <span className="font-mono tabular-nums">{fmtSum(insight.landingAmount, sym)}</span> due {insight.when}. The
        heaviest day is {insight.heavyWhen},{" "}
        <span className="font-mono tabular-nums">{fmtSum(insight.heavyDayTotal, sym)}</span> across{" "}
        {paymentCount(insight.heavyExtra + 1)}.
      </Fragment>
    );
  }
  // insight.kind === "calm" — gapDays is guaranteed >= MIN_RUNWAY_DAYS (2)
  // here, so the "day"/"days" split is defensive, not reachable at 1 today,
  // but kept in case that guard ever changes.
  return (
    <Fragment>
      Nothing&apos;s due for {insight.gapDays} day{insight.gapDays === 1 ? "" : "s"}. Then the heaviest day is{" "}
      {insight.heavyWhen},{" "}
      <span className="font-mono tabular-nums">{fmtSum(insight.heavyDayTotal, sym)}</span> across{" "}
      {paymentCount(insight.heavyExtra + 1)}.
    </Fragment>
  );
}
