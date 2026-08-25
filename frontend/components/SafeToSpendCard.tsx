"use client";

import { ShieldCheck, AlertCircle, AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { SafeToSpend } from "@/lib/api";
import { usePreferences } from "@/components/PreferencesContext";
import { useCountUp } from "@/lib/useCountUp";
import MoneyText from "@/components/MoneyText";

interface SafeToSpendCardProps {
  data: SafeToSpend | null;
  loading?: boolean;
  suppressCTA?: boolean;
  /** Net card growth since payday (GET /needle/summary → current.card_delta_so_far). */
  cardDeltaSoFar?: number | null;
}

function fmt(n: number): string {
  return `£${Math.abs(n).toLocaleString("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function fmt2(n: number): string {
  return `£${Math.abs(n).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Returns a human-readable freshness string, or null if data is fresh (< 3 h old).
 *  Guards against negative diffs from clock skew by treating them as fresh. */
function syncAgeLabel(isoString: string | null | undefined): string | null {
  if (!isoString) return null;
  const diffMs = Date.now() - new Date(isoString).getTime();
  if (diffMs < 0) return null; // clock skew — treat as fresh
  const diffH = diffMs / (1000 * 60 * 60);
  if (diffH < 3) return null; // fresh — render nothing
  if (diffH < 24) return `Synced ${Math.floor(diffH)} hours ago`;
  if (diffH < 48) return "Synced yesterday";
  const diffD = diffMs / (1000 * 60 * 60 * 24);
  if (diffD < 7) return `Synced ${Math.floor(diffD)} days ago`;
  const d = new Date(isoString);
  return `Synced on ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
}

export default function SafeToSpendCard({ data, loading, suppressCTA, cardDeltaSoFar }: SafeToSpendCardProps) {
  const { hideNetWorth: hidden } = usePreferences();
  const router = useRouter();

  // Tiny negative floats (rounding/float artefacts, e.g. -£0.03) must never
  // render as "−£0" or flip a verdict into the alarm state. Widened to < 1
  // (not < 0.5) so it lines up exactly with the "genuine shortfall" remap
  // threshold below (freeAmount > -1 ⇒ comfortable) — otherwise the
  // (-1,-0.5] band survives zeroSafe as a small negative number, which
  // fmt()'s Math.abs+round then displays as a positive "£1 to spare" on a
  // GREEN comfortable card for a user who is actually short. Accepted side
  // effect: raw values in +0.5..0.99 now also normalise to £0 instead of £1.
  // Applied before every sign check, colour choice, and verdict branch.
  const zeroSafe = (v: number) => (Math.abs(v) < 1 ? 0 : v);

  // Count-up targets for the NOW / BILLS / FREE tiles — computed unconditionally
  // (before any early return) since hooks can't be called conditionally. Falls
  // back to 0 when there's no "ok" data yet; the hook itself no-ops until the
  // card actually renders these values.
  const okData = data?.status === "ok" ? data : null;
  // Keyed off the raw backend fields on `okData`, not the locally remapped
  // `state` computed further down: the rounding guard down there (freeAmount
  // > -1 ⇒ "comfortable") exists to swallow float noise, not a real card
  // reserve, so a "short"/"cards" pair must never get laundered into
  // "comfortable" — see that remap's own comment. Computed this early so it
  // can also gate the FREE tile's colour/word choice below.
  const isCardsShort = okData?.state === "short" && okData?.short_reason === "cards";
  const nowTarget = okData?.spendable_now ?? 0;
  const billsTarget = zeroSafe(okData?.bills_total ?? 0);
  const freeTarget = okData ? Math.abs(zeroSafe(okData.safe_to_spend)) : 0;
  const nowCounted = useCountUp(nowTarget);
  const billsCounted = useCountUp(billsTarget);
  const freeCounted = useCountUp(freeTarget);

  // Loading skeleton — only while this card's own data hasn't arrived yet;
  // once data exists we render it even if a background refresh is in flight
  if (loading && !data) {
    return (
      <div className="rounded-3xl p-5 glass-hero">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-3">
          Safe to Spend
        </p>
        <div className="h-6 w-56 bg-slate-100 dark:bg-slate-700 rounded-lg animate-pulse mb-3" />
        <div className="grid grid-cols-3 gap-2">
          <div className="h-14 bg-slate-100 dark:bg-slate-700 rounded-xl animate-pulse" />
          <div className="h-14 bg-slate-100 dark:bg-slate-700 rounded-xl animate-pulse" />
          <div className="h-14 bg-slate-100 dark:bg-slate-700 rounded-xl animate-pulse" />
        </div>
      </div>
    );
  }

  // Render nothing when data is absent or insufficient
  if (!data || data.status === "insufficient_data") return null;

  const {
    safe_to_spend,
    state: rawState,
    next_payday,
    estimated,
    spendable_now,
    payday_income,
    card_debt,
    short_reason,
    card_growth_reserved,
    safe_to_spend_cash,
  } = data;

  // Normalised free-cash figure — see zeroSafe above. A backend "short"
  // state only earns the alarm verdict/colour when the shortfall is real
  // (≥ £1 after normalisation); anything smaller is rounding noise and
  // falls through to the normal on-track ("comfortable") verdict path.
  // Exception: a "short"/"cards" pair (isCardsShort, computed above) is
  // never rounding noise, it's a real reserve the backend has already
  // priced in, so it's excluded from the remap regardless of how small the
  // sub-£1 gap looks.
  const freeAmount = zeroSafe(safe_to_spend);
  const state: "comfortable" | "tight" | "short" =
    rawState === "short" && !isCardsShort && freeAmount > -1 ? "comfortable" : rawState;

  const gap = Math.abs(freeAmount); // used when short (guaranteed >= 1 here)

  // Distance-aware label for next payday — today/tomorrow/weekday name (2–6
  // days away)/short date (7+ days away). Prevents "Tight until Friday"
  // misreading as "this Friday" when payday is actually weeks out.
  const paydayDate = new Date(next_payday);
  paydayDate.setHours(0, 0, 0, 0);
  const _today0 = new Date();
  _today0.setHours(0, 0, 0, 0);
  const daysAway = Math.round((paydayDate.getTime() - _today0.getTime()) / 86400000);
  const paydayLabel =
    daysAway <= 0 ? "today"
    : daysAway === 1 ? "tomorrow"
    : daysAway < 7 ? new Date(next_payday).toLocaleDateString("en-GB", { weekday: "long" })
    : new Date(next_payday).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  // Non-colour state cue: distinct icon per state for colour-blind users.
  // Cards-short reads AMBER, the same signifier `tight` uses — bills are
  // covered, nothing is genuinely at risk, so this must never render the
  // red AlertTriangle (Red Is Risk Rule).
  const StateIcon =
    state === "comfortable" ? ShieldCheck
    : state === "tight" || isCardsShort ? AlertCircle
    : AlertTriangle;

  const stateIconClass =
    state === "comfortable"
      ? "text-emerald-600 dark:text-emerald-400"
      : state === "tight" || isCardsShort
      ? "text-amber-500 dark:text-amber-400"
      : "text-red-500 dark:text-red-400";

  // Card growth reserved this period, used by the verdict headline when
  // isCardsShort. `cardDeltaSoFar` is a fallback only, for callers still on
  // the older GET /needle/summary prop wiring; `card_growth_reserved` from
  // this endpoint is the real source.
  const cardGrowthAmount = card_growth_reserved ?? cardDeltaSoFar ?? gap;

  // ── 1. Verdict headline ───────────────────────────────────────────────────
  // `safe_to_spend` is already net of unpaid card growth (single source of
  // truth), so the headline never does its own arithmetic on it. The only
  // extra branch is "short because of cards" — bills are covered, the spare
  // just went on plastic — which reads AMBER (isCardsShort, defined above),
  // not the red genuine-shortfall case reserved for `short_reason ===
  // "bills"`.
  let verdictText: string;
  if (state === "comfortable") {
    verdictText = `You're okay. ${fmt(freeAmount)} to spare this pay period.`;
  } else if (state === "tight") {
    verdictText = `Tight until your pay period ends. ${fmt(freeAmount)} in hand.`;
  } else if (isCardsShort) {
    verdictText = `Bills are covered, but ${fmt(cardGrowthAmount)} has gone on cards this period. Nothing spare until payday.`;
  } else {
    // Only reached when state === "short" AND short_reason === "bills" (or
    // freeAmount <= -1 with no reason at all) — see the remap above.
    verdictText = `Short this pay period. ${fmt(gap)} to cover.`;
  }

  // ── Bridge figure colour ─────────────────────────────────────────────────
  const freeClass =
    state === "comfortable"
      ? "text-emerald-600 dark:text-emerald-400"
      : state === "tight" || isCardsShort
      ? "text-slate-900 dark:text-slate-100"
      : "text-red-500 dark:text-red-400";

  const hasSpendableNow = spendable_now != null;
  const hasPaydayIncome = (payday_income ?? 0) > 0;
  const hasCardDebt = (card_debt ?? 0) >= 1000;
  const freshnessLabel = data.status === "ok" ? syncAgeLabel(data.last_synced) : null;

  // ── Cash-vs-cards balance line ──────────────────────────────────────────
  // The card's whole card story lives here, alongside the NOW/BILLS/FREE
  // tiles: one verdict frame, cash in hand vs bills vs what's gone on
  // cards. (No second, period-to-date flow frame on this card any more —
  // that in/out review question belongs to Spend, whose header already
  // shows OUT/IN pills.) Legitimate arithmetic (unlike the old equation
  // strip this replaces, which subtracted a flow from a runway):
  // chainBeforeCards minus the card reserve is exactly the FREE tile's
  // figure, so this line spells out the sum the tile above no longer shows.
  // Renders whenever the reserve is material, independent of state — it
  // reads as a shortfall ("... short") or as headroom that survives the
  // reserve ("... free"), whichever direction the balance actually lands.
  //
  // `safe_to_spend_cash` is NOT raw cash: compute_safe_to_spend walks the
  // timeline from the spendable-account balance through upcoming bills and
  // pre-payday income, takes the MINIMUM running balance, then subtracts
  // safe_to_spend_buffer and commitments_reserved — all of that has already
  // happened by the time this figure is captured, right before the card
  // reserve is applied. It only equals `spendable_now` (the NOW tile) when
  // bills, the buffer and commitments are all zero, which is why the label
  // below describes its relationship to the card reserve ("before cards"),
  // never claims to be a raw balance, and must never be swapped for
  // `spendable_now` — that would silently break the arithmetic whenever
  // bills or commitments are non-zero.
  const showChainLine = (card_growth_reserved ?? 0) >= 10;
  const chainBeforeCards = safe_to_spend_cash ?? nowTarget;
  const chainWord = freeAmount < 0 ? "short" : "free";

  // ── CTA logic ────────────────────────────────────────────────────────────
  // If tight+card_debt: show "See your cards ›" CTA — taps through to /cards story.
  // If short: CTA goes to /planning.
  // If comfortable: no CTA.
  const showDebtCTA = state === "tight" && hasCardDebt;
  const showSpendCTA = state === "short";
  // The chain line above is already a card-relevant explanation whenever it
  // renders (same >= £10 condition, `showChainLine`) — stacking a second
  // "go look at cards" affordance directly under it reads as two competing
  // taps rather than one calm verdict, so this CTA is suppressed in that
  // case. When the chain line isn't showing, this CTA is the only card
  // pointer and stays.
  const debtCTAVisible = showDebtCTA && !suppressCTA && !showChainLine;

  return (
    <div className="hero-arrive sts-card relative rounded-3xl p-5 glass-hero">
      {/* Whisper label + state icon */}
      <div className="flex items-center gap-1.5 mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Safe to Spend
        </p>
        <StateIcon
          size={14}
          className={`${stateIconClass} flex-shrink-0`}
          aria-hidden="true"
        />
      </div>

      {/* ── 1–4. Content stack ── */}
      <div className="space-y-3">
      {/* ── 1. Verdict headline ── */}
      <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 leading-snug">
        <MoneyText text={verdictText} />
        {estimated && (
          <span className="text-slate-400 dark:text-slate-500 font-normal text-sm"> · estimated</span>
        )}
      </h2>

      <div className="space-y-2">
      {/* ── 2. 3-column instrument readout ── */}
      {hasSpendableNow && (
        <div className="grid grid-cols-3 gap-2">
          {/* NOW */}
          <div className="flex flex-col gap-0.5 items-start rounded-xl glass-tile px-3 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 text-left">Now</span>
            <span className="text-base font-semibold text-slate-800 dark:text-slate-100 money text-left">{hidden ? "£••••" : fmt(nowCounted)}</span>
          </div>
          {/* BILLS — minus sign only when there's a real bills figure to
              subtract; a zero-normalised total never renders "−£0". */}
          <div className="flex flex-col gap-0.5 items-start rounded-xl glass-tile px-3 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 text-left">Bills</span>
            <span className="text-base font-semibold text-slate-800 dark:text-slate-100 money text-left">{billsTarget > 0 ? "−" : ""}{hidden ? "£••••" : fmt(billsCounted)}</span>
          </div>
          {/* FREE — the real net figure, negative and all. A cards-driven
              shortfall (isCardsShort) stays ink, not red — bills are
              covered, the amber signifier lives on the state icon above,
              not here — while a bills-driven shortfall keeps the red minus,
              the only genuine-risk case (freeClass already encodes this).
              NOW − BILLS no longer equals FREE once a card or commitments
              reserve is in play; the chain line below carries that
              explanation instead of the tiles pretending to sum. */}
          <div className="flex flex-col gap-0.5 items-start rounded-xl glass-tile px-3 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 text-left">Free</span>
            <span className={`text-base font-semibold money text-left ${freeClass}`}>
              {state === "short" ? `−${hidden ? "£••••" : fmt(freeCounted)}` : (hidden ? "£••••" : fmt(freeCounted))}
            </span>
          </div>
        </div>
      )}
      {/* Cash-vs-cards balance line — see showChainLine's own comment. Plain
          supporting text, not a tile or a button: it explains the FREE
          figure above, it isn't a separate verdict. The amber dot is the
          only caution signifier (DESIGN.md "Figures Are Ink"): the figures
          themselves never take amber or red. */}
      {showChainLine && (
        <p className="text-[13px] text-slate-500 dark:text-slate-400 num text-pretty flex items-center gap-1.5">
          {chainWord === "short" && (
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-400 flex-shrink-0" aria-hidden="true" />
          )}
          <MoneyText
            text={`${hidden ? "£••" : fmt(chainBeforeCards)} before cards · ${hidden ? "£••" : fmt(card_growth_reserved ?? 0)} on cards · ${hidden ? "£••" : fmt(freeCounted)} ${chainWord}`}
          />
        </p>
      )}
      </div>
      <div className="space-y-1">
      {/* Pace + payday line — merges the daily-rate pace and the pay-period-end/
          expected-income facts into one muted line. Degrades gracefully: rate
          and expected income are each independently optional; the period-end
          date is always available for "ok" status, so it anchors the line. */}
      {(() => {
        const pace = data.status === "ok" ? data.pace : undefined;
        const showPace = pace != null &&
          (pace.state === "comfortable" || pace.state === "on_pace" || pace.state === "ahead" || pace.state === "early") &&
          pace.sustainable != null;
        const leadText = showPace
          ? `${hidden ? "£••" : fmt2(pace!.sustainable!)}/day until ${paydayLabel}`
          : `Pay period ends ${paydayLabel}`;
        const incomeText = hasPaydayIncome ? `~${hidden ? "••" : fmt(payday_income!)} expected` : null;
        return (
          <p className="text-[13px] text-slate-500 dark:text-slate-400 num text-pretty">
            <MoneyText text={`${leadText}${incomeText ? ` · ${incomeText}` : ""}`} />
          </p>
        );
      })()}
      {/* Commitments reserved — one muted line, tappable through to Planning */}
      {(data.commitments_reserved ?? 0) > 0 && (
        <button
          onClick={() => router.push("/planning")}
          className="min-h-[44px] flex items-center gap-1 text-left text-[13px] text-slate-500 dark:text-slate-400 num hover:opacity-80 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
          aria-label="See the plans this is reserved for"
        >
          <span>
            <MoneyText
              text={`${hidden ? "£••" : fmt(data.commitments_reserved!)} ${
                data.commitments_reserved_period_label
                  ? `each pay period (${data.commitments_reserved_period_label})`
                  : "a period"
              } reserved for ${data.commitments_count ?? 1} plan${(data.commitments_count ?? 1) === 1 ? "" : "s"}`}
            />
          </span>
          <span className="text-slate-400 dark:text-slate-500 text-sm flex-shrink-0" aria-hidden="true">›</span>
        </button>
      )}
      {/* Freshness caveat — only when sync is older than 3 hours */}
      {freshnessLabel && (
        <p className="text-sm text-slate-400 dark:text-slate-500">{freshnessLabel}</p>
      )}
      </div>

      {/* ── 3. Single CTA ── */}
      {showSpendCTA && !suppressCTA && (
        <button
          onClick={() => router.push("/planning")}
          className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:opacity-80 active:scale-[0.98] transition-[transform,opacity] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
        >
          See what&apos;s due ›
        </button>
      )}
      {debtCTAVisible && (
        <button
          onClick={() => router.push("/cards")}
          className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:opacity-80 active:scale-[0.98] transition-[transform,opacity] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
        >
          See your cards ›
        </button>
      )}
      </div>
      </div>
  );
}
