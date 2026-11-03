"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SafeToSpend } from "@/lib/api";
import { usePreferences } from "@/components/PreferencesContext";
import { setPennyScreenView } from "@/components/PennySheetProvider";
import { formatSafeToSpendAmount, deriveSafeToSpendHeadline, buildSafeToSpendView } from "@/lib/pennyScreenViews";
import { homeForecastPresentation, FORECAST_INK } from "@/lib/cashForecastStatus";
import ForecastStatusBadge from "@/components/ForecastStatusBadge";
import {
  spendFromTreatmentPlan,
  type SpendFromAccount,
  type SpendFromResult,
  type SpendFromTreatmentKind,
  type SpendFromTreatmentPlan,
} from "@/lib/spendFromAccount";
import { BANK_META, bankKey, bankLogoSrc } from "@/components/AccountMiniCard";
import MoneyText from "@/components/MoneyText";
import SafeToSpendDisclosures from "@/components/SafeToSpendDisclosures";
import type { CoverMoveEvidence } from "@/lib/coverMoveEvidence";
import { buildLeftToSpendEvidence } from "@/lib/leftToSpendEvidence";
import PooledLedgerExplainer from "@/components/PooledLedgerExplainer";
import SpendFromAccountList from "@/components/SpendFromAccountList";
import { SyncGlyph, SyncLine, asOfLabel, syncChipClass, syncChipLabel, syncPhase, type SyncingInfo } from "@/components/SyncNote";

type SpendFromTreatment = {
  heroAside?: ReactNode;
  body: ReactNode;
  /** Preview-only redaction. Never reveals a figure or changes preferences. */
  hideBalances?: boolean;
};

/** G231: "Not counting 2 accounts" (singular "1 account"). */
export function notCountingLabel(count: number): string {
  return `Not counting ${count} ${count === 1 ? "account" : "accounts"}`;
}

interface SafeToSpendCardProps {
  data: SafeToSpend | null;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  // G110/G115 — ranked current accounts with real spendable headroom.
  // G148: absent is NOT a plain no-render any more. `undefined` here is
  // treated as `{ kind: "unavailable", reason: "missing" }`, which renders a
  // quiet placeholder and logs, because "the caller passed nothing" and
  // "the feature is working" must never look the same on screen again.
  spendFrom?: SpendFromResult | null;
  /**
   * True only while a cover-plan move card is visibly rendered above this
   * hero on Home. Lets the no-cash state point to the move as the next action
   * without pointing to a card after the user hides it.
   */
  coverMoveVisible?: boolean;
  /** Legacy presentation metadata. Reserves are already included in headroom. */
  coverMoveReserves?: Record<string, number>;
  coverMoveDestinations?: Record<string, string[]>;
  earmarkedMoves?: CoverMoveEvidence[];
  /**
   * Design-history seam. Production renders G320 approved B account rows
   * when absent. Other open design rounds may inject their own treatment.
   */
  spendFromPreview?: SpendFromTreatment;
  /**
   * G214: a non-first sync is running. The last known figure stays, in
   * neutral ink, marked "Last known amount · as of HH:MM" (G214, approved
   * treatment B). Absent, the card renders exactly as before.
   */
  syncing?: SyncingInfo;
  /** G214: "Try again" on a stalled or failed sync (POST /accounts/sync). */
  onSyncRetry?: () => void;
  /**
   * G218 preview seam. /design pages have no signed-in preferences, so the
   * default context masks every figure as `£••••`. Passing true shows the
   * fixture amounts. Production never passes it, so masking is unchanged.
   */
  previewBalancesVisible?: boolean;
}

function fmt2(value: number): string {
  return `£${Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// (G148) The local `spendAccounts` helper that used to flatten a result into
// rows here is gone: `spendFromTreatmentPlan` in lib/spendFromAccount.ts does
// it, so the ranked entries this card renders and the ones a test can inspect
// are produced by the same code.

function localBank(account: SpendFromAccount["account"]) {
  const meta = BANK_META[bankKey(account)];
  const logoSrc = bankLogoSrc(meta);
  if (!meta || !logoSrc) return null;
  return {
    background: meta.bg,
    initials: meta.initials,
    initialsSize: meta.initialsSize,
    label: meta.label,
    logoSrc,
  };
}

// G340 plain-English wording. G324 B2 keeps the first sentence visible
// and places its exclusions in the adjacent scope disclosure.
export const COUNTS_LINE = "Based on your connected current accounts and the bills Sorted knows about. It doesn't include other accounts, payments still pending, or bills Sorted hasn't spotted yet.";
const COUNTS_INTRO = COUNTS_LINE.slice(0, COUNTS_LINE.indexOf(". ") + 1);
const ESTIMATE_DISCLAIMER = "An estimate from your bank data. It can be wrong, so check your bank for your latest balance. Not financial advice.";

/**
 * G148 (2026-09-23): the quiet placeholder for a rail that is absent rather
 * than empty.
 *
 * `unavailable` used to return `null` here, which is the only state in this
 * whole component that renders NOTHING: `account` draws the rail and `none`
 * draws the amber no-room line, so a client that never received
 * `account_eligibility` looked exactly like one where the feature was
 * working correctly. It sat that way on Kevin's live Home for a week while
 * the engine was returning 13 eligible accounts. A placeholder was chosen
 * over "log only" precisely because nobody reads a console they have no
 * reason to open: DESIGN.md's Safe-to-Spend section already says this card
 * never renders null or an empty shell, and the same standard has to reach
 * the rail inside it.
 *
 * What it is NOT: an alarm. This is a supporting figure, not a blocking
 * failure, so it stays in the muted Caption step with no dot, no amber and
 * no toast. Per DESIGN.md, error and unsupported states on this card "stay
 * neutral ink with no colour signal at all", and a retry appears only where
 * one applies, which is the failed-request branch.
 */
function SpendFromUnavailableNote({ kind, message, retryable, onRetry }: {
  kind: SpendFromTreatmentKind;
  message: string;
  retryable: boolean;
  onRetry?: () => void;
}) {
  return (
    <div
      data-g115-treatment={kind}
      className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[12px] leading-snug text-slate-500 dark:text-slate-400 text-pretty"
      role="status"
    >
      <p>{message}</p>
      {retryable && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          // 44px, the project's stated target size (DESIGN.md's thumb-sized
          // targets, and the same min-h-11 every other tappable control in
          // this round uses). `px-2` so the hit area is not just the width
          // of the word.
          className="-mx-2 min-h-11 rounded-lg px-2 text-[12px] font-semibold text-indigo-600 [-webkit-tap-highlight-color:transparent] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 active:scale-95 motion-reduce:transform-none dark:text-indigo-400"
        >
          Try again
        </button>
      )}
    </div>
  );
}

/** Exported for scripts/spend-from-render.test.mjs, which renders every
 *  plan kind through react-dom/server and asserts each one produces real
 *  markup. A source-text guard alone could not tell `return null` from
 *  `return { body: null }`, and both make the rail invisible. */
export function approvedSpendFromTreatment(
  plan: SpendFromTreatmentPlan,
  amount: (value: number) => string,
  coverMoveVisible: boolean,
  onLogoError: (logoSrc: string) => void,
  onRetry?: () => void,
  reserveByAccount?: Record<string, number>,
  destinationsByAccount?: Record<string, string[]>,
): SpendFromTreatment | null {
  switch (plan.kind) {
    // The one branch that still renders nothing. `pending` means the
    // request carrying this data has not settled, so there is nothing true
    // to say yet and a placeholder would flash on every cold load. It is
    // bounded by HomePage setting the status in the request's own
    // `.then`/`.catch`, so it cannot become the permanent silence the two
    // branches below replaced.
    case "pending":
      return null;

    case "check-failed":
    case "not-available":
      return {
        body: (
          <SpendFromUnavailableNote
            kind={plan.kind}
            message={plan.message ?? ""}
            retryable={plan.retryable}
            onRetry={onRetry}
          />
        ),
      };

    case "no-current":
      return {
        body: (
          <div data-g115-treatment="no-current" className="mt-2 flex items-start gap-2 text-[12px] leading-snug text-slate-500 dark:text-slate-400 text-pretty">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
            <p>
              No cash is available to spend from your current accounts right now.
              {coverMoveVisible ? " Use the move above first." : " Checked account by account."}
            </p>
          </div>
        ),
      };

    case "name-fallback":
    case "bank-rail":
    default:
      return {
        body: <SpendFromAccountList entries={plan.entries} pool={plan.pool} amount={amount} coverMoveVisible={coverMoveVisible} reserveByAccount={reserveByAccount} destinationsByAccount={destinationsByAccount} onLogoError={onLogoError} kind={plan.kind === "name-fallback" ? "name-fallback" : "bank-rail"} />,
      };
  }
}

function syncAgeLabel(isoString: string | null | undefined): string | null {
  if (!isoString) return null;
  const diffMs = Date.now() - new Date(isoString).getTime();
  if (diffMs < 0) return null;
  const diffH = diffMs / (1000 * 60 * 60);
  if (diffH < 3) return null;
  if (diffH < 24) return `Synced ${Math.floor(diffH)} hours ago`;
  if (diffH < 48) return "Synced yesterday";
  const diffD = diffMs / (1000 * 60 * 60 * 24);
  if (diffD < 7) return `Synced ${Math.floor(diffD)} days ago`;
  return `Synced on ${new Date(isoString).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
}

function listPhrase(items: string[]): string {
  if (items.length === 0) return "the cash forecast";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export default function SafeToSpendCard({ data, loading, error, onRetry, spendFrom, coverMoveVisible = false, coverMoveReserves, coverMoveDestinations, earmarkedMoves = [], spendFromPreview, syncing, onSyncRetry, previewBalancesVisible = false }: SafeToSpendCardProps) {
  const { hideNetWorth, preferencesReady } = usePreferences();
  const router = useRouter();
  const hidden = spendFromPreview?.hideBalances === true || (!previewBalancesVisible && (hideNetWorth || !preferencesReady));
  const [failedSpendFromLogos, setFailedSpendFromLogos] = useState<Set<string>>(() => new Set());
  const handleSpendFromLogoError = useCallback((logoSrc: string) => {
    setFailedSpendFromLogos((current) => {
      if (current.has(logoSrc)) return current;
      const next = new Set(current);
      next.add(logoSrc);
      return next;
    });
  }, []);

  // G148 — which spend-from treatment to render, decided in plain TypeScript
  // (lib/spendFromAccount.ts) so a plain-Node test can prove every state,
  // including the absent one this component used to render as nothing. Bank
  // marks are resolved here and injected, because the logo table lives in a
  // .tsx module the test runner cannot import.
  const hasBankMark = useCallback((account: SpendFromAccount["account"]) => {
    const bank = localBank(account);
    return bank != null && !failedSpendFromLogos.has(bank.logoSrc);
  }, [failedSpendFromLogos]);
  const pooledSafeToSpend = data && "safe_to_spend" in data && typeof data.safe_to_spend === "number" ? data.safe_to_spend : null;
  const spendFromPlan = useMemo(
    // G300: the pooled Safe to Spend travels in so the plan can tell when the
    // per-account figures would add up to more than it.
    () => spendFromTreatmentPlan(spendFrom, hasBankMark, pooledSafeToSpend),
    [spendFrom, hasBankMark, pooledSafeToSpend],
  );
  // The rail being absent must leave a trace even for the branch whose copy
  // is deliberately gentle: the user-facing line says the figure is not
  // there, this says WHY, and says it differently for a failed request than
  // for a successful one that carried no eligibility. Before G148 the two
  // were the same silence, which is why a feature that stopped arriving on
  // 2026-09-16 was only noticed on 2026-09-23. Keyed on the diagnostic
  // string so it logs once per state, not once per render.
  const spendFromDiagnostic = spendFromPlan.diagnostic;
  useEffect(() => {
    if (!spendFromDiagnostic) return;
    // Not while a refresh is in flight. The stated reason used to be that
    // `loading` returns before any treatment renders; that is wrong. The
    // early return below is `loading && !data`, so a WARM card refreshing
    // (exactly what onRetry produces: stsLoading true with data still
    // present) does render the full treatment, including the "not available"
    // line, while this warning is suppressed. Suppressing it is still right,
    // because a request that has not come back yet has nothing to report,
    // and nothing is lost: `loading` is in this effect's deps and always
    // clears, so the warning fires a moment later if the state persists.
    // It also keeps Home's own bare `<SafeToSpendCard data={null} loading />`
    // loading path from warning about a card that shows no rail at all.
    if (loading) return;
    console.warn(`[SafeToSpendCard] ${spendFromDiagnostic}`);
  }, [spendFromDiagnostic, loading]);

  // Penny screen context (B39) — published here via `buildSafeToSpendView`
  // (lib/pennyScreenViews.ts), the SAME function a node test pins against
  // fixture payloads, so what Penny can quote back for "why is this so
  // low" can never disagree with the hero figure this card renders below
  // (both ultimately call that module's `deriveSafeToSpendHeadline`). Must
  // be an unconditional hook call (every render, including the early
  // loading/error/insufficient-data/degraded returns below, where the
  // correct published view is "nothing to quote yet", not a stale figure
  // left over from a previous successful render) — placed above every
  // early `return` in this component for exactly that reason.
  useEffect(() => {
    if (loading || !data || syncing) {
      setPennyScreenView("home", null);
      return;
    }
    if (data.status === "ok" && data.calculation_status === "syncing") {
      // G210: no verdict yet, so nothing for Penny to quote.
      setPennyScreenView("home", null);
      return;
    }
    if (data.status !== "ok" || data.calculation_status === "degraded") {
      setPennyScreenView("home", { route: "/", scope: "Left to spend", figures: [], asOf: new Date().toISOString() });
      return;
    }
    setPennyScreenView("home", buildSafeToSpendView(data, { hidden }));
  }, [data, loading, hidden, syncing]);

  if (loading && !data) {
    return (
      <div className="rounded-2xl p-5 glass-hero" aria-busy="true" aria-label="Loading estimated left to spend">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">Estimated left to spend</p>
        <div className="mb-3 h-6 w-56 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-700" />
        <div className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-700" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <section className="rounded-2xl p-5 glass-hero" role="alert" aria-labelledby="safe-to-spend-unavailable">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">Estimated left to spend</p>
        <h2 id="safe-to-spend-unavailable" className="text-base font-bold text-slate-900 dark:text-slate-100">Your left to spend estimate is unavailable</h2>
        <p className="mt-1 text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-300">Your accounts may still be visible, but we can&apos;t calculate what is left to spend until payday.</p>
        {onRetry && <button type="button" onClick={onRetry} className="mt-3 min-h-11 rounded-xl px-3 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400 dark:hover:bg-indigo-500/10">Try again</button>}
      </section>
    );
  }

  if (!data || data.status === "insufficient_data") {
    return (
      <section className="rounded-2xl p-5 glass-hero" aria-labelledby="safe-to-spend-history">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">Estimated left to spend</p>
        <h2 id="safe-to-spend-history" className="text-base font-bold text-slate-900 dark:text-slate-100">Your figure isn’t ready yet</h2>
        <p className="mt-1 text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-300">We need a little more account history to map bills and work out what is left until payday.</p>
        {onRetry && <button type="button" onClick={onRetry} className="mt-3 min-h-11 rounded-xl px-3 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400 dark:hover:bg-indigo-500/10">Check again</button>}
      </section>
    );
  }

  if (data.calculation_status === "syncing") {
    // G210: a first bank sync is still running, so any verdict would come from
    // partial data. Not an error (so no alert role), never red, no amount.
    return (
      <section className="rounded-2xl p-5 glass-hero" aria-busy="true" aria-labelledby="safe-to-spend-syncing">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">Estimated left to spend</p>
        <h2 id="safe-to-spend-syncing" className="text-base font-bold text-slate-900 dark:text-slate-100">Your figure is on its way</h2>
        <p className="mt-1 text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-300">We are still fetching your transactions, so there is no verdict yet.</p>
      </section>
    );
  }

  if (data.calculation_status === "degraded") {
    return (
      <section className="rounded-2xl p-5 glass-hero" role="alert" aria-labelledby="safe-to-spend-incomplete">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">Estimated left to spend</p>
        <h2 id="safe-to-spend-incomplete" className="text-base font-bold text-slate-900 dark:text-slate-100">We could not check everything</h2>
        <p className="mt-1 text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-300">We are not showing a figure because part of the calculation could not be checked and it might be too high. Try again in a moment, or check your bank.</p>
        {onRetry && <button type="button" onClick={onRetry} className="mt-3 min-h-11 rounded-xl px-3 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400 dark:hover:bg-indigo-500/10">Try again</button>}
      </section>
    );
  }

  const cardReserve = data.card_growth_reserved ?? 0;
  // `state`/`stateLabel`/`isCardsUnconfirmedShort`/`heroAmount`/`paydayLabel`
  // now come from `deriveSafeToSpendHeadline` (this file, above) — the SAME
  // call the Penny screen-context effect above makes, not a second copy of
  // this maths (B39).
  const headline = deriveSafeToSpendHeadline(data);
  const { state, isCardsUnconfirmedShort, heroAmount, paydayLabel, plansOnly } = headline;
  const presentation = homeForecastPresentation(data, headline);

  const amount = (value: number) => hidden ? "£••••" : formatSafeToSpendAmount(value);
  const exactAmount = (value: number) => hidden ? "£••••" : fmt2(value);

  const sync = syncing ? { info: syncing, phase: syncPhase(syncing) } : null;
  const syncAsOf = sync ? asOfLabel(sync.info.asOf ?? data.last_synced) : null;


  const pace = data.pace;
  const showPace = pace != null && ["comfortable", "on_pace", "ahead", "early"].includes(pace.state) && pace.sustainable != null;
  const belowBuffer = !sync && presentation.status.label === "Below buffer";
  const heroCaption = sync
    ? `Last known cash figure until ${paydayLabel}`
    : presentation.caption ?? (plansOnly
    ? "short after plans and set-asides"
    : state === "short" && !isCardsUnconfirmedShort
    ? "short before payday"
    : `Cash left until ${paydayLabel}`);

  const calculationItems = [
    { label: "Plans reserved", shortLabel: "plans", value: data.commitments_reserved ?? 0 },
    { label: "Set-asides reserved", shortLabel: "set-asides", value: data.allocations_reserved ?? 0 },
  ].filter((item) => item.value > 0);
  const contextParts = [
    data.bills_total > 0 ? "upcoming bills" : "the cash forecast",
    ...calculationItems.map((item) => item.shortLabel),
    ...(data.buffer > 0 && !belowBuffer ? ["your buffer"] : []),
  ];
  // Say the scope once, using Spend's supporting-prose role. Card reserves
  // keep their separate cash explanation rather than implying a cash gap.
  const heroSupport = sync
    ? `${heroCaption}. After ${listPhrase(contextParts)}.`
    : isCardsUnconfirmedShort
    ? data.safe_to_spend < 0
      ? `${amount(cardReserve)} held while a card bill is unconfirmed, leaving a ${amount(Math.abs(data.safe_to_spend))} safety shortfall.`
      : `${amount(cardReserve)} held while a card bill is unconfirmed. Nothing left to spend before ${paydayLabel}.`
    : heroAmount === 0
    ? `Nothing left to spend before ${paydayLabel}, after ${listPhrase(contextParts)}.`
    : belowBuffer
    ? `After ${listPhrase(contextParts)}, this is below your ${amount(data.buffer)} safety buffer.`
    : plansOnly
    ? `Short after ${listPhrase(contextParts)}.`
    : state === "short"
    ? `After ${listPhrase(contextParts)}, you are short before payday.`
    : cardReserve > 0
    ? `${amount(cardReserve)} held while a card bill is unconfirmed, after ${listPhrase(contextParts)}.`
    : showPace
    ? `About ${amount(Math.round(pace!.sustainable!))} a day until ${paydayLabel}, after ${listPhrase(contextParts)}.`
    : `${heroCaption}, after ${listPhrase(contextParts)}.`;

  // G324 approved B2: the existing ranked account treatment stays visible
  // beneath the scope inside the hero. No eligibility or cash calculation
  // changes; independent account ceilings are never addends.
  const approvedSpendFrom = approvedSpendFromTreatment(
    spendFromPlan,
    amount,
    coverMoveVisible,
    handleSpendFromLogoError,
    onRetry,
    coverMoveReserves,
    coverMoveDestinations,
  );
  const spendFromTreatment = spendFromPreview ?? approvedSpendFrom;

  // G231: accounts the user chose not to count towards Safe to Spend. A quiet
  // ink line under the Spend from scope note, linking to Accounts.
  const excludedCount = data.excluded_accounts_count ?? 0;

  const freshnessLabel = sync ? null : syncAgeLabel(data.last_synced);
  const evidence = buildLeftToSpendEvidence(data, presentation.signed ? -heroAmount : Math.abs(heroAmount));
  const formatEvidence = (value: number, exact = false) => {
    const sign = value < 0 ? "−" : "";
    return hidden ? `${sign}£••••` : `${sign}${exact ? fmt2(value) : formatSafeToSpendAmount(value)}`;
  };
  const recovery = sync ? null : state === "short"
    ? isCardsUnconfirmedShort ? { label: "Review card bill", href: "/cards" } : { label: "See what’s due", href: "/upcoming" }
    : null;
  // G397 moves this existing action beside the card explanation. Its
  // eligibility stays unchanged, including when this period has no activity.
  const showCardsLink = !sync && state === "tight" && (data.card_debt ?? 0) >= 1000;
  const heroFigureClass = sync ? "text-slate-700 dark:text-slate-200" : FORECAST_INK;
  const heroHeading = (
    <h2 id="safe-to-spend-heading" aria-describedby="safe-to-spend-scope" className={spendFromTreatment?.heroAside ? "min-w-0 flex-1" : "mt-5"}>
      <span className={`money block text-[30px] font-bold leading-[1.2] tracking-[-0.025em] ${heroFigureClass}`}>{presentation.signed ? "−" : ""}{amount(heroAmount)}</span>
    </h2>
  );

  return (
    <div data-g324-surface>
    <section data-g324-hero className="hero-arrive sts-card relative rounded-2xl p-5 glass-hero" aria-labelledby="safe-to-spend-label safe-to-spend-heading">
      <div className="flex items-center justify-between gap-3">
        <p id="safe-to-spend-label" className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">{sync ? "Estimated left to spend" : presentation.eyebrow}</p>
        {sync ? (
          <span data-sync-chip={sync.phase} className={`inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold ${syncChipClass}`}>
            <SyncGlyph phase={sync.phase} />
            {syncChipLabel(sync.info)}
          </span>
        ) : (
          <ForecastStatusBadge status={presentation.status} />
        )}
      </div>
      {error && <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-950/30" role="status"><p className="text-xs text-slate-700 dark:text-slate-200">Couldn&apos;t refresh. Showing your last figure.</p>{onRetry && <button type="button" onClick={onRetry} className="min-h-11 shrink-0 rounded-lg px-2 text-xs font-semibold text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400">Retry</button>}</div>}

      {spendFromTreatment?.heroAside ? (
        <div className="mt-5 flex items-start justify-between gap-4">
          {heroHeading}
          <div className="shrink-0">{spendFromTreatment.heroAside}</div>
        </div>
      ) : heroHeading}

      {sync ? (
        <>
          <p data-sync-asof className="mt-2 text-xs text-slate-600 dark:text-slate-300">{syncAsOf ? `Last known amount · as of ${syncAsOf}` : "Last known amount"}</p>
          {sync.phase !== "syncing" ? <SyncLine info={sync.info} onRetry={onSyncRetry} className="mt-2" /> : null}
        </>
      ) : null}

      <p id="safe-to-spend-scope" className="mt-3 text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-300"><MoneyText text={data.estimated ? heroSupport.replace(/\.$/, "") : heroSupport} />{data.estimated && <span className="text-xs text-slate-500 dark:text-slate-400"> · early estimate</span>}</p>

      <p data-sts-counts className="mt-2 text-pretty text-[12px] leading-[1.45] text-slate-700 dark:text-slate-200">{COUNTS_INTRO}</p>

      {sync && state !== "short" && heroAmount > 0 && ["bank-rail", "name-fallback"].includes(spendFromPlan.kind) && <p className="mt-3 text-[12px] text-slate-600 dark:text-slate-300">Last known account figures.</p>}
      {(state !== "short" && heroAmount > 0) || !["bank-rail", "name-fallback"].includes(spendFromPlan.kind) ? spendFromTreatment?.body : null}

      {excludedCount > 0 && (
        <Link
          href="/accounts"
          data-g231-not-counting
          className="-mx-1 mt-1 flex min-h-11 items-center rounded-lg px-1 text-[12px] font-medium text-slate-600 underline decoration-slate-300 underline-offset-4 transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-300 dark:decoration-slate-600 dark:hover:text-slate-100 [-webkit-tap-highlight-color:transparent]"
        >
          {notCountingLabel(excludedCount)}
        </Link>
      )}

      {recovery && (
        <div data-g219-action-row className="mt-4 flex flex-wrap items-center gap-x-3">
          <button type="button" onClick={() => router.push(recovery.href)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-50 px-3 text-sm font-semibold text-indigo-700 transition-[transform,background-color] hover:bg-indigo-100 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-indigo-400/10 dark:text-indigo-300 dark:hover:bg-indigo-400/15">{recovery.label}<ArrowRight size={15} aria-hidden="true" /></button>
        </div>
      )}
    </section>
    <SafeToSpendDisclosures
      disclaimer={ESTIMATE_DISCLAIMER}
      data={data}
      evidence={evidence}
      format={formatEvidence}
      paydayLabel={paydayLabel}
      syncing={!!sync}
      showCardsLink={showCardsLink}
      freshnessLabel={freshnessLabel}
      earmarkedMoves={coverMoveVisible && !sync ? earmarkedMoves : []}
      reservationDetails={<PooledLedgerExplainer
        pooled={spendFromPlan.entries.length > 1}
        envelope={{ amount: data.allocations_reserved ?? 0, count: data.allocations_count }}
        plan={{ amount: data.commitments_reserved ?? 0, count: data.commitments_count }}
        format={exactAmount}
      />}
    />
    </div>
  );
}
