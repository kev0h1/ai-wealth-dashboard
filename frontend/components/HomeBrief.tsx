"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { RefreshCw, AlertTriangle, AlertCircle, TrendingDown, X, ChevronRight, UserRound } from "lucide-react";
import type { CompanionItem, PlanDest, SafeToSpend, UnfundedMoveEntry } from "@/lib/api";
import { api } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import PaydayPlanCard from "@/components/PaydayPlanCard";
import PennyMark from "@/components/PennyMark";
import { BRAND_GRADIENT } from "@/lib/brand";
import SettleMark from "@/components/SettleMark";
import { BankBadge, BANK_META, bankKey } from "@/components/AccountMiniCard";
import { useColours } from "@/components/ColourProvider";
import { useCategoryIcons } from "@/components/IconProvider";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { getCategoryColour } from "@/lib/categories";
import type { AttentionTarget } from "@/lib/attention";
import { isPaydayWindowActive } from "@/lib/paydayWindow";
import { readHomeDismissedAdvice, dismissOnHome, pruneHomeDismissedAdvice } from "@/lib/homeDismissedAdvice";
import { isActionableCompanionItem } from "@/lib/companionItems";
import MoneyText from "@/components/MoneyText";

// Window-scoped local dismiss for the Payday plan ENTRY ROW (the Home-only
// teaser, not the live PaydayPlanCard, which already dismisses itself
// server-side via api.dismissTodayItem — untouched here). A permanent
// dismiss on a recurring rhythm affordance would silently kill the feature
// forever, so this hides the row only for the CURRENT payday window: it's
// keyed on the upcoming payday's ISO date (safeToSpend.next_payday), and the
// moment that date rolls over to next period, the stored value no longer
// matches and the row returns on its own — no cleanup job needed.
// localStorage (not the server) is deliberate: this is a device-local "seen
// it" preference for a teaser, not user data worth syncing across devices.
const PAYDAY_ENTRY_DISMISS_KEY = "wealth_payday_entry_dismissed";

function readDismissedPaydayEntry(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(PAYDAY_ENTRY_DISMISS_KEY);
  } catch {
    return null;
  }
}

function writeDismissedPaydayEntry(nextPayday: string): void {
  try {
    window.localStorage.setItem(PAYDAY_ENTRY_DISMISS_KEY, nextPayday);
  } catch {
    // Storage unavailable (private mode / quota) — dismissal just won't
    // persist across reloads; the in-memory hide below still works this session.
  }
}

interface HomeBriefProps {
  items: CompanionItem[];
  firstName?: string;
  safeToSpend: SafeToSpend | null;
  loading: boolean;
  syncing: boolean;
  syncError: boolean;
  onSync: () => void;
  onHelp?: () => void;
  hideNetWorth?: boolean;
  onRefresh?: () => void;
  /** Which card, if any, should glow — resolved centrally in lib/attention.ts. */
  attnTarget?: AttentionTarget;
  /**
   * Home-only: advice/insight/ask cards get a quiet "hide on Home" control
   * that persists to localStorage (lib/homeDismissedAdvice.ts) instead of
   * the server-side /today/dismiss call, so the card disappears from Home
   * but keeps showing on Penny (the permanent archive). Omitted on Penny.
   */
  dismissible?: boolean;
  /**
   * Home-only: forwarded to PaydayPlanSection's `hasAccounts` guard so the
   * payday-plan entry row can never render once accounts have finished
   * loading and there are none. Leave undefined while accounts are still
   * loading.
   */
  hasAccounts?: boolean;
  /** Home-only: forwarded straight to BriefBody, see BriefBodyProps.onClearedChange. */
  onClearedChange?: (cleared: { count: number; type: CompanionItem["type"] } | null) => void;
  /** Home-only: forwarded straight to BriefBody, see BriefBodyProps.onInsightWinVisibleChange. */
  onInsightWinVisibleChange?: (visible: boolean) => void;
  /**
   * Home-only: rendered directly beneath the greeting row (avatar/"Good
   * morning"/refresh), above everything else the brief renders (sync-error
   * banner, brief body, the payday plan card). This is the one slot that's
   * guaranteed to sit at the very top of the visual stack on Home — a
   * caller that wants a "this outranks everything below it" banner (e.g.
   * HomePage's expired-provider reconnect banner) must pass it here rather
   * than rendering it as HomeBrief's sibling, since HomeBrief itself
   * (greeting + payday plan card) renders inline before any sibling
   * markup ever gets a chance to appear above the payday card. Renders
   * nothing when omitted.
   */
  banner?: React.ReactNode;
}

export function BriefSkeleton() {
  return (
    <div className="space-y-2">
      <div className="h-4 w-3/4 bg-slate-100 dark:bg-slate-700 rounded-lg animate-pulse" />
      <div className="h-4 w-1/2 bg-slate-100 dark:bg-slate-700 rounded-lg animate-pulse" />
    </div>
  );
}

function SyncErrorBanner({ glow }: { glow?: boolean }) {
  return (
    <div role="alert" className={`flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2${glow ? " needs-you" : ""}`}>
      <AlertTriangle size={13} aria-hidden="true" className="text-amber-500 dark:text-amber-400 flex-shrink-0" />
      <p className="text-sm text-slate-700 dark:text-slate-300 flex-1">Sync didn&apos;t complete, try again in a moment.</p>
    </div>
  );
}

function resolveBankChip(provider: string) {
  const key = bankKey({ provider });
  const meta = BANK_META[key];
  return {
    logoSrc: meta?.logoFile
      ? `/banks/${meta.logoFile}`
      : meta?.domain
      ? `https://www.google.com/s2/favicons?domain=${meta.domain}&sz=64`
      : null,
    initials: meta?.initials ?? (provider || "?").slice(0, 2).toUpperCase(),
    label: meta?.label ?? (provider || "Bank"),
    bg: meta?.bg,
    initialsSize: meta?.initialsSize,
  };
}

// Dismiss × — the ONE dismiss-x treatment for cards across the app (owner
// decision, Kevin 2026-08-27, /design/dismiss-x — V2 "Glass chip", lifted
// verbatim from that page's DismissV2). Replaces the old bare-ghost x that
// used to live at each of this file's six dismiss sites (previously
// undocumented/copy-pasted per site — factored here so the vocabulary can't
// drift again). Outer button keeps the 44px hit target, the aria-label and
// the focus-visible ring, and carries active:scale-95 + transition-transform
// (matches the design page: the press-scale sits on the outer button, not a
// nested span, even though it visually reads as "the tile scales"). The
// inner ~28px span is the actual glass chip: translucent fill only (no
// backdrop-filter — same glass-tile fill-only rule as globals.css), a
// hairline border, and a hover-capable-only deepened fill. `className`
// carries each call site's OWN positioning (flex-in-row offset vs absolute
// top-right), defaulting to the five sites that share the flex layout;
// PaydayPlanSection's entry-row dismiss passes its own absolute positioning.
function DismissChip({
  label,
  onClick,
  className = "flex-shrink-0 -mt-2 -mr-2",
}: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`${className} w-11 h-11 flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 active:scale-95 transition-transform duration-150`}
    >
      <span className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-900/[0.05] dark:bg-white/[0.06] border border-slate-900/[0.06] dark:border-white/10 [@media(hover:hover)]:hover:bg-slate-900/[0.09] dark:[@media(hover:hover)]:hover:bg-white/[0.11] transition-colors duration-150">
        <X size={14} aria-hidden="true" className="text-slate-500 dark:text-slate-300" />
      </span>
    </button>
  );
}

interface AskPaydayCardProps {
  item: CompanionItem;
  router: ReturnType<typeof useRouter>;
  hideNetWorth: boolean;
  maskAmounts: (text: string) => string;
  onRefresh?: () => void;
  /** Penny screen only — the page header already establishes Penny's voice,
   * so the per-card "✦ Penny" chip is redundant branding there. Home keeps
   * the chip exactly as before (prop omitted/false). */
  hideAttribution?: boolean;
}

function AskPaydayCard({ item, router, maskAmounts, onRefresh, hideAttribution }: AskPaydayCardProps) {
  const [busy, setBusy] = useState<null | "confirm" | "decline">(null);
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  async function handleConfirm() {
    if (busy) return;
    setBusy("confirm");
    try {
      await api.confirmPayday();
      setHidden(true);
      onRefresh?.();
    } catch {
      // On error: un-busy, leave card visible, no red/alarm
    } finally {
      setBusy(v => v === "confirm" ? null : v);
    }
  }

  async function handleDecline() {
    if (busy) return;
    setBusy("decline");
    try {
      await api.dismissTodayItem(item.id);
    } catch { /* swallow */ }
    if (typeof window !== "undefined") {
      sessionStorage.setItem("wealth_open_pay_period", "1");
    }
    setHidden(true);
    router.push("/planning");
  }

  return (
    <div className="glass-card rounded-2xl p-4">
      {/* Penny gradient chip — suppressed on the Penny screen itself */}
      {!hideAttribution && (
        <div className="flex items-center gap-2 mb-3">
          <span
            className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white rounded-full px-2.5 py-1"
            style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" }}
          >
            <PennyMark size={11} />
            Penny
          </span>
        </div>
      )}
      {/* Headline */}
      <p className="text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed mb-3 max-w-prose">
        <strong className="text-slate-900 dark:text-slate-100 font-semibold">{item.headline}</strong>
      </p>
      {/* Body */}
      <p lang="en-GB" className="text-pretty text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed mb-3 max-w-prose">
        <MoneyText text={maskAmounts(item.body ?? "")} />
      </p>
      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleConfirm}
          disabled={busy !== null}
          className="inline-flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-[transform,background-color] text-white text-sm font-semibold px-4 py-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 min-h-[44px]"
        >
          {busy === "confirm" ? "Confirming…" : (item.action?.label ?? "Yes, that's it")}
        </button>
        <button
          onClick={handleDecline}
          disabled={busy !== null}
          className="inline-flex items-center text-slate-500 dark:text-slate-400 text-sm font-semibold px-4 py-2 rounded-xl hover:opacity-80 active:opacity-70 transition-[transform,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 min-h-[44px]"
        >
          {item.secondary_action?.label ?? "No, set it myself"}
        </button>
      </div>
    </div>
  );
}

interface AskGenericCardProps {
  item: CompanionItem;
  router: ReturnType<typeof useRouter>;
  maskAmounts: (text: string) => string;
  /** Home-only "hide on Home" mode — see BriefBodyProps.dismissible. */
  dismissible?: boolean;
  onHomeDismiss?: (id: string) => void;
  /** Penny screen only — see AskPaydayCardProps.hideAttribution. */
  hideAttribution?: boolean;
}

// Generic ask card — same visual family as the payday ask (glass card, Penny
// chip, headline + body ramp), but the primary action is a route push from
// item.action. "Not now" only renders when `dismissible` (Home): it hides
// the card Home-only via localStorage, so it keeps showing on Penny's
// archive. Penny never renders "Not now" at all — for asks like
// ask:card_terms the backend id is static with no time component, so the
// server-side dismiss "Not now" used to trigger there was genuinely
// permanent (one dismissible ask, never a nag); the user can still decline
// from Home instead. The primary action button is unaffected and still
// renders on both screens; if an item has neither a primary action nor
// `dismissible`, the whole actions row is skipped so Penny never shows an
// empty, actionless strip. Used for any ask item without bespoke handling
// (e.g. ask:card_terms).
function AskGenericCard({ item, router, maskAmounts, dismissible, onHomeDismiss, hideAttribution }: AskGenericCardProps) {
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  function handleGo() {
    if (item.action) router.push(item.action.route);
  }

  async function handleNotNow() {
    if (busy) return;
    setBusy(true);
    if (dismissible && onHomeDismiss) {
      onHomeDismiss(item.id);
    } else {
      try {
        await api.dismissTodayItem(item.id);
      } catch { /* card still hides locally; the backend will re-surface next run */ }
    }
    setHidden(true);
  }

  return (
    <div className="glass-card rounded-2xl p-4">
      {/* Penny gradient chip — suppressed on the Penny screen itself */}
      {!hideAttribution && (
        <div className="flex items-center gap-2 mb-3">
          <span
            className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white rounded-full px-2.5 py-1"
            style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" }}
          >
            <PennyMark size={11} />
            Penny
          </span>
        </div>
      )}
      {/* Headline */}
      <p className="text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed mb-3 max-w-prose">
        <strong className="text-slate-900 dark:text-slate-100 font-semibold">{item.headline}</strong>
      </p>
      {/* Body */}
      <p lang="en-GB" className="text-pretty text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed mb-3 max-w-prose">
        <MoneyText text={maskAmounts(item.body ?? "")} />
      </p>
      {/* Actions — skipped entirely when there'd be nothing to show (no
          primary action AND not on Home), so Penny never gets an empty row. */}
      {(item.action || dismissible) && (
        <div className="flex items-center gap-2">
          {item.action && (
            <button
              onClick={handleGo}
              disabled={busy}
              className="inline-flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-[transform,background-color] text-white text-sm font-semibold px-4 py-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 min-h-[44px]"
            >
              {item.action.label}
            </button>
          )}
          {dismissible && (
            <button
              onClick={handleNotNow}
              disabled={busy}
              className="inline-flex items-center text-slate-500 dark:text-slate-400 text-sm font-semibold px-4 py-2 rounded-xl hover:opacity-80 active:opacity-70 transition-[transform,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 min-h-[44px]"
            >
              Not now
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface CelebrationCardProps {
  item: CompanionItem;
  router: ReturnType<typeof useRouter>;
  maskAmounts: (text: string) => string;
  /** Home-only "hide on Home" mode — see BriefBodyProps.dismissible. */
  dismissible?: boolean;
  onHomeDismiss?: (id: string) => void;
}

// "Sorted" reward card — a proper glass card, not a pill. Emerald lives ONLY on
// the SettleMark (colour is information: verified-safe); the headline stays
// ink. This is a resolution state ("Sorted: X is covered"), not Penny
// speaking, so it wears SettleMark rather than PennyMark. Tapping the card
// opens Planning, not the Mirror: this celebrates upcoming bills being
// covered, and Planning is where upcoming bills live. The ✕ only renders when
// `dismissible` (Home) — a local, Home-only hide (localStorage). Penny never
// renders the ✕ at all, so it has no way to dismiss the card away for good.
function CelebrationCard({ item, router, maskAmounts, dismissible, onHomeDismiss }: CelebrationCardProps) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation();
    setHidden(true);
    if (dismissible && onHomeDismiss) {
      onHomeDismiss(item.id);
    } else {
      api.dismissTodayItem(item.id).catch(() => {
        /* card already removed locally; the backend will retry-surface next run */
      });
    }
  }

  function handleOpen() {
    router.push("/planning");
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={e => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          handleOpen();
        }
      }}
      className="glass-card rounded-2xl p-4 cursor-pointer active:scale-[0.99] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <div className="flex items-start gap-3">
        <span className="flex-shrink-0 flex items-center justify-center w-4 h-6">
          <SettleMark size={16} className="text-emerald-500" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold text-slate-900 dark:text-white leading-6">
            <MoneyText text={item.headline} />
          </p>
          {item.body && (
            <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400 leading-snug text-pretty">
              <MoneyText text={maskAmounts(item.body)} />
            </p>
          )}
        </div>
        {dismissible && (
          <DismissChip label="Hide on Home" onClick={handleDismiss} />
        )}
      </div>
    </div>
  );
}

interface CliffCardProps {
  item: CompanionItem;
  router: ReturnType<typeof useRouter>;
  maskAmounts: (text: string) => string;
  /** Home-only "hide on Home" mode — see BriefBodyProps.dismissible. */
  dismissible?: boolean;
  onHomeDismiss?: (id: string) => void;
}

// Informational fact-card family — covers promo-cliff, debt-trajectory AND
// payload-less rhythm info items. NO Penny gradient (the indigo→violet
// gradient marks advice surfaces; these state facts). Amber mark only:
// approaching/projected risk, not materialised risk — red stays strictly
// reserved for materialised risk (Red-is-Risk rule). Icon varies by type:
// AlertTriangle for cliff, TrendingDown for trajectory. The ✕ only renders
// when `dismissible` (Home) — a local, Home-only hide; Penny never renders it.
function CliffCard({ item, router, maskAmounts, dismissible, onHomeDismiss }: CliffCardProps) {
  const Icon = item.type === "trajectory" ? TrendingDown : AlertTriangle;
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation();
    setHidden(true);
    if (dismissible && onHomeDismiss) {
      onHomeDismiss(item.id);
    } else {
      api.dismissTodayItem(item.id).catch(() => {
        /* card already removed locally; the backend will re-surface next run */
      });
    }
  }

  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-start gap-3">
        <Icon size={15} aria-hidden="true" className="text-amber-500 dark:text-amber-400 flex-shrink-0 mt-[5px]" />
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold text-slate-900 dark:text-white leading-6">
            <MoneyText text={maskAmounts(item.headline)} />
          </p>
          {item.body && (
            <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400 leading-snug text-pretty">
              <MoneyText text={maskAmounts(item.body)} />
            </p>
          )}
          {item.action && (
            <button
              onClick={() => router.push(item.action!.route)}
              className="mt-3 inline-flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-[transform,background-color] text-white text-sm font-semibold px-4 py-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              {item.action.label}
            </button>
          )}
        </div>
        {dismissible && (
          <DismissChip label="Hide on Home" onClick={handleDismiss} />
        )}
      </div>
    </div>
  );
}

interface UnfundedMoveCardProps {
  item: CompanionItem;
  router: ReturnType<typeof useRouter>;
  hideNetWorth: boolean;
  maskAmounts: (text: string) => string;
  /** Penny screen only — see AskPaydayCardProps.hideAttribution. */
  hideAttribution?: boolean;
  /** Home-only "hide on Home" mode — see BriefBodyProps.dismissible. */
  dismissible?: boolean;
  onHomeDismiss?: (id: string) => void;
}

// Owner decision (Kevin, 2026-08-27): due-but-unfunded OWN transfers get a
// quiet Penny flag with a skip affordance — "there is a call to action
// here". AlertCircle/amber-500 (SafeToSpendCard's "tight" convention, not
// CliffCard's AlertTriangle) is the ONE amber signifier on the whole card;
// a missed movement has no fee/cut-off/credit damage, so it reads as a soft
// attention cue, never the materialised-risk red treatment (Figures Are
// Ink, Red Is Risk — a movement never takes red anywhere). Headline, body
// and every money figure stay plain ink. Each row's "Skip this month"
// button calls the exact same dismiss-occurrence endpoint PlanningPage's
// "Dismiss for this month" button uses (api.skipUpcomingOccurrence) — no
// second dismissal path. Skipping is optimistic (row removed immediately);
// when the last move is skipped the whole card quietly resolves
// (setHidden(true), the same no-animation pattern every sibling card in
// this file uses for a resolved/dismissed state).
function UnfundedMoveCard({ item, router, hideNetWorth, maskAmounts, hideAttribution, dismissible, onHomeDismiss }: UnfundedMoveCardProps) {
  // `item.moves` is declared PlanMove[] on CompanionItem (MoveCard's own
  // field) since the two item types can't share a TS-narrowable shape
  // under one flat interface — see the field's doc comment in lib/api.ts.
  // `item.type === "unfunded_move"` (this component only ever renders for
  // that type) is the real runtime discriminant, so the cast is sound.
  const [moves, setMoves] = useState<UnfundedMoveEntry[]>(
    (item.moves as unknown as UnfundedMoveEntry[] | undefined) ?? []
  );
  const [hidden, setHidden] = useState(false);

  if (hidden || moves.length === 0) return null;

  function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation();
    setHidden(true);
    if (dismissible && onHomeDismiss) {
      onHomeDismiss(item.id);
    } else {
      api.dismissTodayItem(item.id).catch(() => {
        /* card already removed locally; the backend will re-surface next run */
      });
    }
  }

  function handleSkip(move: UnfundedMoveEntry) {
    const remaining = moves.filter(m => !(m.key === move.key && m.expected_date === move.expected_date));
    const collapses = remaining.length === 0;
    setMoves(remaining);
    if (collapses) setHidden(true);
    // Same per-occurrence override endpoint Planning's "Dismiss for this
    // month" button already calls (backend comment, companion.py) — `key`
    // is the series identifier, `expected_date` is already the original
    // due date, so no new dismiss path exists for this card.
    api.skipUpcomingOccurrence(move.key, move.expected_date ?? "").catch(() => {
      // Revert: restore the move (and the card, if skipping it collapsed
      // the last one) — same fail-safe-visible approach as PlanningPage's
      // own skipOccurrence.
      setMoves(prev =>
        prev.some(m => m.key === move.key && m.expected_date === move.expected_date) ? prev : [...prev, move]
      );
      if (collapses) setHidden(false);
    });
  }

  const route = item.action?.route ?? "/planning";
  const actionLabel = item.action?.label ?? "See it in Planning ›";

  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-start gap-3">
        <AlertCircle size={15} aria-hidden="true" className="text-amber-500 dark:text-amber-400 flex-shrink-0 mt-[5px]" />
        <div className="flex-1 min-w-0">
          {/* Penny gradient chip — same convention as sibling advice cards,
              suppressed on the Penny screen itself (its header already
              establishes Penny's voice there). */}
          {!hideAttribution && (
            <div className="flex items-center gap-2 mb-2">
              <span
                className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white rounded-full px-2.5 py-1"
                style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" }}
              >
                <PennyMark size={11} />
                Penny
              </span>
            </div>
          )}
          <p className="text-[15px] font-semibold text-slate-900 dark:text-white leading-6">
            <MoneyText text={maskAmounts(item.headline)} />
          </p>
          {item.body && (
            <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400 leading-snug text-pretty">
              <MoneyText text={maskAmounts(item.body)} />
            </p>
          )}
          {/* Per-move list — name, mono money figure (DESIGN.md's Money Is
              Mono rule, .money = --font-mono), due date, quiet skip.
              `amount` arrives pre-rounded to whole pounds from the backend
              (int(round(...)) server-side), so no decimal places here. */}
          <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-700/60">
            {moves.map(m => {
              const dateStr = m.expected_date
                ? new Date(m.expected_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
                : "recently";
              return (
                <div key={m.key} className="flex items-center gap-2.5 py-2 first:pt-0 last:pb-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-slate-700 dark:text-slate-200 truncate">{m.label}</p>
                    <p className="text-[12px] text-slate-400 dark:text-slate-500">{dateStr}</p>
                  </div>
                  <span className="money text-[13px] font-semibold text-slate-900 dark:text-slate-100 flex-shrink-0">
                    {hideNetWorth ? "£••••" : `£${m.amount.toLocaleString("en-GB")}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleSkip(m)}
                    className="flex-shrink-0 text-[12px] font-medium text-slate-500 dark:text-slate-400 hover:underline underline-offset-2 focus:outline-none focus-visible:underline"
                  >
                    Skip this month
                  </button>
                </div>
              );
            })}
          </div>
          <button
            onClick={() => router.push(route)}
            className="mt-3 inline-flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-[transform,background-color] text-white text-sm font-semibold px-4 py-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {actionLabel}
          </button>
        </div>
        {dismissible && (
          <DismissChip label="Hide on Home" onClick={handleDismiss} />
        )}
      </div>
    </div>
  );
}

interface IntentPaceCardProps {
  item: CompanionItem;
  maskAmounts: (text: string) => string;
  /** Home-only "hide on Home" mode — see BriefBodyProps.dismissible. */
  dismissible?: boolean;
  onHomeDismiss?: (id: string) => void;
}

// Quiet pace note for a category the user chose to change in the Mirror.
// Pure information — headline + body in ink/muted, no accent colour, no CTA
// (the aim already lives in the Mirror). The ✕ only renders when
// `dismissible` (Home) — a local, Home-only hide; Penny never renders it, so
// the note can't be dismissed away for good from there.
// NO red: pace against a self-chosen aim is never materialised risk.
function IntentPaceCard({ item, maskAmounts, dismissible, onHomeDismiss }: IntentPaceCardProps) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation();
    setHidden(true);
    if (dismissible && onHomeDismiss) {
      onHomeDismiss(item.id);
    } else {
      api.dismissTodayItem(item.id).catch(() => {
        /* card already removed locally; the backend will re-surface next run */
      });
    }
  }

  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold text-slate-900 dark:text-white leading-6">
            <MoneyText text={maskAmounts(item.headline)} />
          </p>
          {item.body && (
            <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400 leading-snug text-pretty">
              <MoneyText text={maskAmounts(item.body)} />
            </p>
          )}
        </div>
        {dismissible && (
          <DismissChip label="Hide on Home" onClick={handleDismiss} />
        )}
      </div>
    </div>
  );
}

interface MoveCardProps {
  item: CompanionItem;
  router: ReturnType<typeof useRouter>;
  hideNetWorth: boolean;
  maskAmounts: (text: string) => string;
  /** Penny screen only — see AskPaydayCardProps.hideAttribution. */
  hideAttribution?: boolean;
  /** Home-only "hide on Home" mode — see BriefBodyProps.dismissible. */
  dismissible?: boolean;
  onHomeDismiss?: (id: string) => void;
}

function MoveCard({ item, router, hideNetWorth, maskAmounts, hideAttribution, dismissible, onHomeDismiss }: MoveCardProps) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation();
    setHidden(true);
    if (dismissible && onHomeDismiss) {
      onHomeDismiss(item.id);
    } else {
      api.dismissTodayItem(item.id).catch(() => {
        /* card already removed locally; the backend will re-surface next run */
      });
    }
  }

  type LegEntry = { provider: string; name: string; amount: number };
  const legs: LegEntry[] =
    item.moves && item.moves.length > 0
      ? item.moves.map(m => ({
          provider: (m.move_map.from as any)?.provider,
          name: (m.move_map.from as any)?.name,
          amount: m.amount ?? 0,
        }))
      : item.move_map
      ? [{ provider: (item.move_map.from as any)?.provider, name: (item.move_map.from as any)?.name, amount: item.amount ?? 0 }]
      : [];
  const totalAmount = legs.reduce((s, l) => s + l.amount, 0);

  return (
    <div className="glass-card rounded-2xl p-4">
      {/* Penny gradient chip — marks this as a proactive advice surface;
          suppressed on the Penny screen itself. The dismiss control is
          Home-only: dismissing here is local ("Hide on Home", localStorage)
          and the card keeps showing on Penny's permanent archive. Penny
          itself must never be able to dismiss the card away for good, so no
          dismiss control renders there at all — and with the chip also
          suppressed on Penny, the whole header row is skipped rather than
          leaving an empty strip above the headline. */}
      {(dismissible || !hideAttribution) && (
        <div className={`flex items-center gap-2 mb-3 ${hideAttribution ? "justify-end" : "justify-between"}`}>
          {!hideAttribution && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white rounded-full px-2.5 py-1"
              style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" }}
            >
              <PennyMark size={11} />
              Penny
            </span>
          )}
          {dismissible && (
            <DismissChip label="Hide on Home" onClick={handleDismiss} />
          )}
        </div>
      )}
      {item.plan_dest ? (
        <>
          {/* Headline */}
          <p className="text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed mb-3 max-w-prose">
            <strong className="text-slate-900 dark:text-slate-100 font-semibold"><MoneyText text={item.headline} />.</strong>
          </p>

          {/* a) Destination tile */}
          {(() => {
            const dest: PlanDest = item.plan_dest!;
            const destChip = resolveBankChip(dest.provider ?? "");
            const billCount = (dest.bills ?? []).length;
            // Overdraft destination: no bill drove this card, the account is
            // simply negative right now (a live balance read, not a
            // projection). needs_total/needs_by carry no meaning here, so
            // state the real thing instead of the usual "held · payment
            // expected" sentence.
            const overdrawnAmt = Math.abs(dest.balance);
            const overdrawnStr = Math.abs(overdrawnAmt - Math.round(overdrawnAmt)) < 0.005
              ? Math.round(overdrawnAmt).toLocaleString("en-GB")
              : overdrawnAmt.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const tileText = dest.is_overdraft
              ? `£${overdrawnStr} overdrawn right now`
              : billCount === 1
              ? `£${Math.round(dest.balance).toLocaleString("en-GB")} held · £${(dest.needs_total ?? 0).toLocaleString("en-GB")} payment expected ${dest.needs_by}`
              : `£${Math.round(dest.balance).toLocaleString("en-GB")} held · £${(dest.needs_total ?? 0).toLocaleString("en-GB")} in ${billCount} payments before period end · first expected ${dest.needs_by}`;
            return (
              <div className="glass-tile rounded-xl px-3 py-2.5 mb-2">
                <div className="flex items-center gap-2.5">
                  <span className="flex-shrink-0">
                    <BankBadge
                      logoSrc={destChip.logoSrc}
                      initials={destChip.initials}
                      initialsSize={destChip.initialsSize}
                      altText={destChip.label}
                      brandBg={destChip.bg}
                    />
                  </span>
                  <span className="text-[13px] text-slate-600 dark:text-slate-300 leading-snug flex-1 min-w-0">
                    {maskAmounts(tileText)}
                  </span>
                </div>
              </div>
            );
          })()}

          {/* b+c) Sources ledger tile */}
          <div className="glass-tile rounded-xl divide-y divide-slate-100 dark:divide-slate-700/60 mb-2">
            {legs.map((leg, idx) => {
              const chip = resolveBankChip(leg.provider);
              return (
                <div key={idx} className="flex items-center gap-2.5 px-3 py-1.5 min-h-[44px]">
                  <BankBadge
                    logoSrc={chip.logoSrc}
                    initials={chip.initials}
                    initialsSize={chip.initialsSize}
                    altText={chip.label}
                    brandBg={chip.bg}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate block">{leg.name}</span>
                  </span>
                  <span className="money text-sm font-semibold text-slate-900 dark:text-slate-100 flex-shrink-0">
                    {hideNetWorth ? "£••••" : `£${Math.round(leg.amount).toLocaleString("en-GB")}`}
                  </span>
                </div>
              );
            })}
            {/* Total row */}
            <div className="flex items-center justify-between gap-2.5 px-3 min-h-[44px]">
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Moving <span className="money">{hideNetWorth ? "£••••" : `£${Math.round(totalAmount).toLocaleString("en-GB")}`}</span>
              </span>
            </div>
          </div>

          {/* Footer — merged assurance line + residual */}
          {(() => {
            const destBillCount = (item.plan_dest?.bills ?? []).length;
            const clearClause = !item.covered
              ? null
              : item.plan_dest?.is_overdraft
              ? "Clears the overdrawn balance"
              : destBillCount > 0
              ? (destBillCount === 1 ? "Clears the payment" : `Clears all ${destBillCount} payments`)
              : null;
            // "...and envelopes" only appended when true (owner fix,
            // 2026-08-31): an envelope reservation actually reduced a
            // source's contribution here — see item.envelope_reserved /
            // MoveMap.from.reserved_for_allocations.
            const safeSuffix = item.envelope_reserved ? " and envelopes" : "";
            const safeClause = item.sources_safe
              ? (legs.length === 1
                  ? `the source still covers its own bills${safeSuffix}`
                  : `every source still covers its own bills${safeSuffix}`)
              : null;
            const assurance =
              clearClause && safeClause ? `${clearClause}; ${safeClause}.`
              : clearClause ? `${clearClause}.`
              : safeClause ? `${safeClause.charAt(0).toUpperCase()}${safeClause.slice(1)}.`
              : null;
            return (
              <div className="mt-3 space-y-1.5">
                {assurance && (
                  <p className="text-[12px] text-slate-500 dark:text-slate-400 leading-snug">{assurance}</p>
                )}
                {item.residual && (
                  <p className="text-[12px] text-slate-400 dark:text-slate-500 leading-snug"><MoneyText text={maskAmounts(String(item.residual))} /></p>
                )}
                {item.income_note && (
                  <p className="text-[12px] text-slate-400 dark:text-slate-500 leading-snug"><MoneyText text={maskAmounts(item.income_note)} /></p>
                )}
                {item.overflow_note && (
                  <p className="text-[12px] text-slate-400 dark:text-slate-500 leading-snug">{item.overflow_note}</p>
                )}
              </div>
            );
          })()}
        </>
      ) : (
        <>
          {/* Headline */}
          <p className="text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed mb-3 max-w-prose text-pretty">
            <strong className="text-slate-900 dark:text-slate-100 font-semibold"><MoneyText text={item.headline} /></strong>
          </p>
          {/* Body */}
          <p lang="en-GB" className="text-pretty text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed mb-3 max-w-prose">
            <MoneyText text={item.body ?? ""} />
          </p>
        </>
      )}
      {item.action && (
        <button
          onClick={() => router.push(item.action!.route)}
          className="mt-4 inline-flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-[transform,background-color] text-white text-sm font-semibold px-4 py-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          {item.action.label}
        </button>
      )}
    </div>
  );
}

interface RhythmCardProps {
  item: CompanionItem;
  router: ReturnType<typeof useRouter>;
  maskAmounts: (text: string) => string;
  onRefresh?: () => void;
  /** Home-only "hide on Home" mode — see BriefBodyProps.dismissible. The
   * quiet ✕ only renders when this is true (Home); it never renders on
   * Penny at all, leaving the one_off/new_normal intent buttons and the
   * "See the payments" row completely untouched either way. */
  dismissible?: boolean;
  onHomeDismiss?: (id: string) => void;
}

function RhythmCard({ item, router, maskAmounts, onRefresh, dismissible, onHomeDismiss }: RhythmCardProps) {
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState<null | "one_off" | "new_normal">(null);
  const [confirmed, setConfirmed] = useState<null | "one_off" | "new_normal">(null);
  const [intentError, setIntentError] = useState(false);
  // Hooks that resolve per-user overrides — must be above any conditional return (React #310)
  const { colours } = useColours();
  const { icons: iconOverrides } = useCategoryIcons();

  if (hidden) return null;

  const category = item.payload?.category ?? "";
  const multiple = item.payload?.multiple ?? 0;
  const spent = item.payload?.spent ?? 0;
  const dominant = item.payload?.dominant ?? null;

  // Resolve icon + colour exactly as the Spend category tiles do
  const colour = colours[category] ?? getCategoryColour(category);
  const Icon = getCategoryIcon(category, iconOverrides);

  // Headline: amount-led form for very large multiples (≥20), otherwise multiple-led
  const fmtMultiple = multiple.toFixed(1) + "×";
  const fmtSpent = "£" + Math.round(spent).toLocaleString("en-GB");
  const isLarge = multiple >= 20;

  const headline = isLarge
    ? `${fmtSpent} in ${category}, way above your usual`
    : `${category} ran ${fmtMultiple} your usual`;

  // ONE supporting line — collapses the redundant triple to a single statement.
  // When a dominant transaction exists, this is `{ prefix, name, suffix }`
  // rather than one flat string: the render below CSS-truncates just the
  // `name` span at its real available width (flex row, shrink-0 prefix/
  // suffix either side) instead of the old fixed 24-char slice. That slice
  // cut mid-word at a character count with no relation to the rendered
  // width, so on a phone-width card the "…" it produced routinely wrapped
  // onto its own line ahead of the date (owner report, 2026-09-02: "the
  // format on the card of the text seems a bit off" for a long bank
  // descriptor like "AMZNMKTPLACE*NJ0X14124…, 30 Aug."). Keeping the date in
  // its own shrink-0 span means it can never be separated from the name by
  // a mid-sentence wrap. No copy rewrite — same two sentences, same wording.
  let supportLine: { prefix: string; name: string; suffix: string } | string | null = null;
  if (dominant) {
    const amt = "£" + Math.round(dominant.amount).toLocaleString("en-GB");
    const d = new Date(dominant.date);
    const dateStr = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const dominantShare = spent > 0 ? dominant.amount / spent : 0;
    if (dominantShare >= 0.95) {
      // Dominant IS the spend — no need to repeat the £ figure
      supportLine = { prefix: "One payment: ", name: dominant.name, suffix: `, ${dateStr}.` };
    } else {
      // Dominant is notable but not everything
      supportLine = { prefix: "Mostly one payment: ", name: dominant.name, suffix: `, ${amt} on ${dateStr}.` };
    }
  } else {
    supportLine = `${fmtSpent} so far this period.`;
  }

  async function handleIntent(answer: "one_off" | "new_normal") {
    if (busy || confirmed) return;
    setIntentError(false);
    setBusy(answer);
    try {
      await api.recordTrendIntent(category, answer);
      setConfirmed(answer);
      onRefresh?.();
    } catch {
      setIntentError(true);
    } finally {
      setBusy(null);
    }
  }

  function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation();
    setHidden(true);
    if (dismissible && onHomeDismiss) {
      onHomeDismiss(item.id);
    } else {
      api.dismissTodayItem(item.id).catch(() => {});
    }
  }

  function handleSeePayments() {
    if (typeof window !== "undefined") {
      sessionStorage.setItem("wealth_open_category", category);
    }
    router.push("/spend");
  }

  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-start gap-3">
        {/* Category icon chip — same size/treatment as Spend tile chips */}
        <span
          aria-hidden="true"
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
          style={{ backgroundColor: `${colour}26` }}
        >
          <Icon size={16} style={{ color: colour }} />
        </span>

        <div className="flex-1 min-w-0">
          {/* Headline */}
          <p className="text-[15px] font-semibold text-slate-900 dark:text-white leading-6">
            <MoneyText text={headline} />
          </p>
          {/* One supporting line. Plain string (no dominant transaction):
              same single-paragraph MoneyText render as every other card's
              body copy. Structured `{ prefix, name, suffix }` (dominant
              transaction present): a flex row instead, so the merchant name
              alone truncates at its real available width and the trailing
              date — `suffix`, `shrink-0` — can never wrap away from it onto
              its own line. See the `supportLine` comment above for why. */}
          {typeof supportLine === "string" ? (
            supportLine && (
              <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400 leading-snug text-pretty">
                <MoneyText text={maskAmounts(supportLine)} />
              </p>
            )
          ) : (
            supportLine && (
              <p className="mt-1 flex items-baseline text-[13px] text-slate-500 dark:text-slate-400 leading-snug min-w-0">
                <span className="shrink-0 whitespace-nowrap">{supportLine.prefix}</span>
                <span className="truncate min-w-0" title={supportLine.name}>
                  {supportLine.name}
                </span>
                <span className="shrink-0 whitespace-nowrap">
                  <MoneyText text={maskAmounts(supportLine.suffix)} />
                </span>
              </p>
            )
          )}
        </div>

        {/* Dismiss button — Home-only, see the dismissible docstring above */}
        {dismissible && (
          <DismissChip label="Hide on Home" onClick={handleDismiss} />
        )}
      </div>

      {/* Answer pair — outside the icon-indented column, full width. The two
          real answers sit in a symmetric 50/50 grid; the softer "See the
          payments" deep link drops below as its own quiet, ghost-styled
          full-width row so it reads as subordinate to the pair. On success,
          the pair is replaced by a quiet confirmation line (card stays
          mounted, no instant-hide reflow); on failure, the buttons stay
          visible/enabled with an inline error so the user can retry. "See
          the payments" stays available regardless of confirm state — it's a
          deep link to Spend, not an intent-recording action. */}
      <div className="mt-3 flex flex-col gap-2">
        {confirmed ? (
          <p className="text-[13px] font-semibold text-slate-600 dark:text-slate-300">
            {confirmed === "one_off" ? "Noted, one-off." : "Noted, new normal."}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleIntent("one_off")}
                disabled={busy !== null}
                className="inline-flex items-center justify-center text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 active:scale-95 transition-[transform,background-color] text-sm font-semibold px-3 py-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
              >
                {busy === "one_off" ? "Saving…" : "A one-off"}
              </button>
              <button
                onClick={() => handleIntent("new_normal")}
                disabled={busy !== null}
                className="inline-flex items-center justify-center text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 active:scale-95 transition-[transform,background-color] text-sm font-semibold px-3 py-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
              >
                {busy === "new_normal" ? "Saving…" : "My new normal"}
              </button>
            </div>
            {intentError && (
              <p className="mt-2 text-[12px] font-semibold text-red-600 dark:text-red-400" role="alert">
                Couldn&apos;t save that, try again.
              </p>
            )}
          </>
        )}
        <button
          onClick={handleSeePayments}
          disabled={busy !== null}
          className="inline-flex items-center justify-center gap-0.5 w-full text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100/50 dark:hover:bg-slate-700/40 active:scale-95 transition-[transform,background-color,color] text-sm font-semibold px-3 py-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
        >
          See the payments
          <ChevronRight size={14} className="flex-shrink-0" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/**
 * Home-only dismissal — hydrates the localStorage store (lib/homeDismissedAdvice.ts)
 * on mount, prunes stale/expired entries against the live (unfiltered) feed
 * whenever it changes, and exposes a `dismiss` callback that persists +
 * updates local state so a dismissed card disappears immediately and stays
 * gone across remounts (e.g. navigating away and back to Home).
 * No-ops entirely when `enabled` is false (Penny never calls dismiss).
 */
function useHomeDismissedAdvice(items: CompanionItem[], enabled: boolean) {
  // Lazy-init straight from localStorage — BriefBody only ever mounts after
  // `loading` has flipped false client-side (see HomeBrief's
  // `{loading ? <BriefSkeleton /> : <BriefBody .../>}`), so there's no SSR
  // markup to mismatch here. Reading synchronously on first render (instead
  // of only in the effect below) avoids a one-frame flash of a previously
  // hidden card before the effect catches up.
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() =>
    enabled && typeof window !== "undefined" ? readHomeDismissedAdvice() : new Set()
  );

  // Belt-and-braces re-hydrate on mount/enable — covers the case where
  // `enabled` flips from false to true after first render (e.g. a future
  // caller toggling `dismissible` dynamically).
  useEffect(() => {
    if (!enabled) return;
    setDismissedIds(readHomeDismissedAdvice());
  }, [enabled]);

  // Prune entries that are expired or no longer present in the live feed.
  // Must run against the raw/unfiltered `items` — filtering already removes
  // dismissed ids from the rendered list, so pruning against the filtered
  // list would erase every dismissal the instant it's made. Guarded against
  // an empty feed (a failed/still-settling /today fetch) so that can never
  // wipe the whole dismissal store — the 7-day expiry already handles
  // genuinely-empty feeds over time.
  useEffect(() => {
    if (!enabled) return;
    if (items.length === 0) return;
    pruneHomeDismissedAdvice(new Set(items.map(i => i.id)));
  }, [enabled, items]);

  const dismiss = useCallback((id: string) => {
    dismissOnHome(id);
    setDismissedIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  return { dismissedIds, dismiss };
}

// `isPennyVisible` (owner's original 2026-08-18 Penny hub IA rule: only
// cash-move recs, payday plans, and the payday-detection ask are "primary"
// on Penny, backed by a "cleared from Home" archive for everything else a
// user dismissed on Home) is RETIRED (owner rule, 2026-09-01): that archive
// is exactly what let purely informational cards ("X is covered", "£X/mo
// staying in your pocket") linger on the Penny hub after a Home dismissal,
// which is the incoherence the owner flagged. It's replaced by
// `isActionableCompanionItem` (lib/companionItems.ts), the actionable/
// informational split PennyPage.tsx now uses directly: actionable items
// show on Penny regardless of Home-dismissal, informational items show only
// while not dismissed anywhere, and there is no separate archive any more.

export interface BriefBodyProps {
  items: CompanionItem[];
  safeToSpend: SafeToSpend | null;
  router: ReturnType<typeof useRouter>;
  hideNetWorth?: boolean;
  onRefresh?: () => void;
  attnTarget?: AttentionTarget;
  /**
   * Home-only: filters out advice/insight/ask items the user has hidden on
   * Home (localStorage, 7-day expiry) and renders a "Hide on Home" control
   * on those cards instead of the default server-side Dismiss. Penny omits
   * this prop entirely, so it always shows the full, unfiltered feed.
   */
  dismissible?: boolean;
  /**
   * Penny-screen-only: suppresses the per-card "✦ Penny" gradient chip on
   * the ask/move cards (the payday ask, the generic ask, and the move-money
   * recommendation) — Penny's own page header already establishes whose
   * voice this is, so the chip is redundant branding there. Home omits this
   * prop entirely, so its chips render exactly as before.
   */
  hideAttribution?: boolean;
  /**
   * Home-only: reports the "everything's hidden, not actually done" cleared
   * state up to HomePage, which renders HomeBriefClearedRow's actual row
   * below SafeToSpendCard. `null` means "nothing cleared to point at"
   * (either items are genuinely showing, or nothing's been dismissed).
   * Undefined on Penny — see the callback's own effect guard below, which
   * no-ops entirely when this is omitted rather than computing for nothing.
   * No stability requirement on the function you pass — BriefBody reads it
   * through a ref rather than an effect dependency, so a fresh inline
   * function every render is fine and won't cause a re-render loop.
   */
  onClearedChange?: (cleared: { count: number; type: CompanionItem["type"] } | null) => void;
  /**
   * Home-only: reports whether a LIVE insight_win celebration ("£49/mo is
   * staying in your pocket", type "celebration", id prefixed
   * `insight_win:`) is currently visible on Home — present in the
   * dismissed-filtered `items` this component actually renders, i.e. the
   * SAME set CelebrationCard below reads from. Owner decision A1, Home
   * dedup review 2026-08-31: while that card is live, ValueDeliveredStat's
   * "£X/mo saved" chip hides (one voice at a time, story before ledger);
   * the moment it lapses or is dismissed on Home, this flips false in the
   * SAME render pass and the chip reappears. Undefined on Penny — the
   * effect below no-ops entirely when this is omitted, same convention as
   * onClearedChange above.
   */
  onInsightWinVisibleChange?: (visible: boolean) => void;
}

export function BriefBody({ items: rawItems, safeToSpend, router, hideNetWorth = false, onRefresh, attnTarget, dismissible = false, hideAttribution = false, onClearedChange, onInsightWinVisibleChange }: BriefBodyProps) {
  // Hooks must run unconditionally, before the items.length early return below.
  const { dismissedIds, dismiss: homeDismiss } = useHomeDismissedAdvice(rawItems, dismissible);
  const items = dismissible ? rawItems.filter(i => !dismissedIds.has(i.id)) : rawItems;
  const onHomeDismiss = dismissible ? homeDismiss : undefined;

  // Same dismissed-filtered `items` CelebrationCard renders from below —
  // narrowed to the insight_win kind specifically (type "celebration" is
  // shared with the payday-plan "Sorted" card and the saving-streak card,
  // neither of which gates ValueDeliveredStat under owner decision A1).
  const hasInsightWinCelebration = items.some(
    i => i.type === "celebration" && i.id.startsWith("insight_win:")
  );

  // Latest-ref, not a dep: onClearedChange is public on BriefBodyProps, so
  // nothing stops a future caller passing a fresh inline function every
  // render. If that identity sat in the effect's own dep array, an unstable
  // caller would re-fire the effect every render, which calls onClearedChange
  // with a new object, which (for HomePage's setState caller) triggers a
  // re-render, which changes the identity again — an infinite loop that only
  // fails to happen today because HomePage happens to pass the stable
  // `setClearedAdvice` setter directly. Reading the callback through a ref
  // (written on every render, but not depended on) makes correctness
  // independent of what the caller passes in.
  const onClearedChangeRef = useRef(onClearedChange);
  onClearedChangeRef.current = onClearedChange;

  // Reports the cleared state up to HomePage so HomeBriefClearedRow (a
  // sibling mounted below SafeToSpendCard, not a child here) can render it.
  // Deliberately depends on primitives (lengths + the first item's type)
  // rather than the `rawItems`/`items` array references, which are fresh
  // objects on every render (`items` is a `.filter()` result) — depending on
  // those would re-fire this effect every render.
  useEffect(() => {
    if (!onClearedChangeRef.current) return;
    if (dismissible && rawItems.length > 0 && items.length === 0) {
      // Only ACTIONABLE items are guaranteed to still be reachable on Penny
      // once every Home card is hidden (owner rule, 2026-09-01: the Penny
      // hub only keeps actionable items regardless of Home-dismissal — an
      // informational one disappears from the hub entirely). Pointing at
      // Penny for a batch that was purely informational (e.g. two
      // celebration cards) would be a promise Penny can't keep, so the
      // pointer counts/labels only the actionable survivors and stays
      // silent when there aren't any.
      const stillOnPenny = rawItems.filter(isActionableCompanionItem);
      if (stillOnPenny.length > 0) {
        onClearedChangeRef.current({ count: stillOnPenny.length, type: stillOnPenny[0].type });
      } else {
        onClearedChangeRef.current(null);
      }
    } else {
      onClearedChangeRef.current(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismissible, rawItems.length, items.length, rawItems[0]?.type]);

  // Same ref pattern as onClearedChange above, same reason: no stability
  // requirement on the callback identity. Reports in the SAME render pass
  // a dismiss (or a natural 7-day lapse dropping the item from the feed)
  // flips `hasInsightWinCelebration` — see BriefBodyProps' doc comment.
  // useLayoutEffect (not useEffect): BriefBody first mounts on the same
  // render `loading` flips to false, so a plain effect would let
  // ValueDeliveredStat paint for one frame with the stale `false` default
  // before this fires. The layout effect flushes HomePage's state update
  // synchronously before that paint, so the chip and the card never both
  // show, even for a frame.
  const onInsightWinVisibleChangeRef = useRef(onInsightWinVisibleChange);
  onInsightWinVisibleChangeRef.current = onInsightWinVisibleChange;

  useLayoutEffect(() => {
    onInsightWinVisibleChangeRef.current?.(hasInsightWinCelebration);
  }, [hasInsightWinCelebration]);

  if (items.length === 0) {
    // Home-only: everything that existed got hidden via "Hide on Home", not
    // genuinely absent (rawItems is non-empty but the dismissed-filtered
    // `items` came back empty). Whether "Nothing needs you today" would be a
    // lie the user could disprove by opening Penny now depends on WHAT got
    // dismissed (owner rule, 2026-09-01): Penny keeps only actionable items
    // regardless of Home-dismissal, so if at least one dismissed item was
    // actionable, it genuinely is still there — defer to the pointer row
    // (HomeBriefClearedRow, mounted by HomePage below SafeToSpendCard) and
    // render nothing here. If every dismissed item was purely informational,
    // it disappeared from Penny too (see lib/companionItems.ts), so there is
    // nothing left anywhere to point at — fall through to the ordinary
    // fallback text below instead of silently rendering a blank Brief.
    if (dismissible && rawItems.length > 0 && rawItems.some(isActionableCompanionItem)) {
      return null;
    }

    let fallbackText: string;
    if (!safeToSpend || safeToSpend.status === "insufficient_data") {
      fallbackText = "Nothing needs you today. I'm keeping an eye on the bills, just check back later.";
    } else if (safeToSpend.state === "tight" && safeToSpend.days_until_payday <= 3) {
      fallbackText = "Nothing needs you today. Your pay period ends in a couple of days. The first week's bills are already mapped, so just cruise.";
    } else if (safeToSpend.state === "tight") {
      fallbackText = "Nothing needs you today. Cash is tight for the rest of this pay period, but the bills are mapped. I'll flag anything that needs you.";
    } else if (safeToSpend.state === "short" && safeToSpend.safe_to_spend <= -1) {
      // Same genuine-shortfall threshold as SafeToSpendCard's remap — a
      // near-zero "short" from the backend must not claim anything's worth
      // a look above a hero that's about to render as comfortable. There is
      // no separate Brief item to point at here: the "thing worth a look"
      // IS the Safe to Spend card rendered directly below this paragraph,
      // so the copy names what it actually is (card spend vs a genuine
      // bills gap, mirroring SafeToSpendCard's own short_reason branch)
      // instead of sending the user hunting for a card that doesn't exist.
      fallbackText = safeToSpend.short_reason === "cards"
        ? "Nothing new needs you. The one thing worth a look is the card spending this period, shown in Safe to Spend below."
        : "Nothing new needs you. You're short this pay period, the gap is shown in Safe to Spend below.";
    } else {
      fallbackText = "Nothing needs you today. You've got headroom, and I'm watching the bills, enjoy it.";
    }
    return (
      <p lang="en-GB" className="text-pretty text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed"><MoneyText text={fallbackText} /></p>
    );
  }

  const moveItems = items.filter(i => i.type === "move");
  // payday_plan items are NOT rendered here — PaydayPlanSection (below) owns
  // that exclusively (live full card + entry/preview state) so a live plan
  // never renders twice. otherItems still excludes the type explicitly so a
  // payday_plan item never falls through to the bare-paragraph fallback.
  const needleItem = items.find(i => i.type === "needle");
  const askItem = items.find(i => i.type === "ask");
  const celebrationItems = items.filter(i => i.type === "celebration");
  const cliffItems = items.filter(i => i.type === "cliff");
  const trajectoryItems = items.filter(i => i.type === "trajectory");
  // "rhythm" is overloaded: only items with a real anomaly payload (multiple
  // >= 1.5, matching the CategorySheet/SpendPage ask-threshold convention)
  // get the interactive card with intent buttons. Payload-less rhythm items
  // (e.g. cliff/switch behaviour cards) render as plain info cards instead —
  // they have no category/multiple/spent to show and no intent to record.
  const rhythmItems = items.filter(
    i => i.type === "rhythm" && i.payload?.multiple != null && i.payload.multiple >= 1.5
  );
  const rhythmInfoItems = items.filter(
    i => i.type === "rhythm" && !(i.payload?.multiple != null && i.payload.multiple >= 1.5)
  );
  // "intent_pace" — quiet pace note against a Mirror-chosen aim; own bucket so
  // it never falls into otherItems' bare-paragraph rendering.
  const intentPaceItems = items.filter(i => i.type === "intent_pace");
  // "unfunded_move" — own bucket so a due-but-unfunded transfer's per-move
  // list/skip affordance never falls into otherItems' bare-paragraph
  // rendering (owner, 2026-08-27).
  const unfundedMoveItems = items.filter(i => i.type === "unfunded_move");
  const otherItems = items.filter(i => i.type !== "move" && i.type !== "payday_plan" && i.type !== "celebration" && i.type !== "needle" && i.type !== "ask" && i.type !== "cliff" && i.type !== "trajectory" && i.type !== "rhythm" && i.type !== "intent_pace" && i.type !== "unfunded_move");

  // Mask £ figures in a string when hideNetWorth is on
  function maskAmounts(text: string): string {
    if (!hideNetWorth) return text;
    return text.replace(/£[\d,]+/g, "£••••");
  }

  return (
    <div className="space-y-3">
        {celebrationItems.map(item => (
          <CelebrationCard key={item.id} item={item} router={router} maskAmounts={maskAmounts} dismissible={dismissible} onHomeDismiss={onHomeDismiss} />
        ))}

        {cliffItems.map(item => (
          <CliffCard key={item.id} item={item} router={router} maskAmounts={maskAmounts} dismissible={dismissible} onHomeDismiss={onHomeDismiss} />
        ))}

        {trajectoryItems.map(item => (
          <CliffCard key={item.id} item={item} router={router} maskAmounts={maskAmounts} dismissible={dismissible} onHomeDismiss={onHomeDismiss} />
        ))}

        {rhythmItems.map(item => (
          <RhythmCard key={item.id} item={item} router={router} maskAmounts={maskAmounts} onRefresh={onRefresh} dismissible={dismissible} onHomeDismiss={onHomeDismiss} />
        ))}

        {/* Payload-less rhythm items (cliff/switch behaviour cards) — plain
            info card, no "× your usual" line and no intent buttons since
            there's no category/multiple/spent to anchor them to. Reuses the
            existing informational fact-card family (CliffCard). */}
        {rhythmInfoItems.map(item => (
          <CliffCard key={item.id} item={item} router={router} maskAmounts={maskAmounts} dismissible={dismissible} onHomeDismiss={onHomeDismiss} />
        ))}

        {/* Intent-pace notes — quiet info cards, no accent, no CTA */}
        {intentPaceItems.map(item => (
          <IntentPaceCard key={item.id} item={item} maskAmounts={maskAmounts} dismissible={dismissible} onHomeDismiss={onHomeDismiss} />
        ))}

        {/* Unfunded moves — Penny's quiet flag for a due-but-unfunded own
            transfer (owner, 2026-08-27); see UnfundedMoveCard's docstring */}
        {unfundedMoveItems.map(item => (
          <UnfundedMoveCard key={item.id} item={item} router={router} hideNetWorth={hideNetWorth} maskAmounts={maskAmounts} hideAttribution={hideAttribution} dismissible={dismissible} onHomeDismiss={onHomeDismiss} />
        ))}

        {/* Ask cards — payday keeps its bespoke confirm/decline (unaffected
            by Home-only dismissal — it's a one-time detected-payday
            confirmation, not archived advice); everything else (e.g.
            ask:card_terms) renders the generic route-push ask, which does
            respect Home-only dismissal so it can still be found on Penny. */}
        {askItem && (
          askItem.id === "ask:payday" ? (
            <AskPaydayCard
              item={askItem}
              router={router}
              hideNetWorth={hideNetWorth}
              maskAmounts={maskAmounts}
              onRefresh={onRefresh}
              hideAttribution={hideAttribution}
            />
          ) : (
            <AskGenericCard item={askItem} router={router} maskAmounts={maskAmounts} dismissible={dismissible} onHomeDismiss={onHomeDismiss} hideAttribution={hideAttribution} />
          )
        )}

        {/* Needle item — invitation to review the closed month */}
        {needleItem && (
          <div className="glass-card rounded-2xl p-4">
            <p className="text-[15px] font-semibold text-slate-700 dark:text-slate-300 leading-snug mb-2">
              {needleItem.headline}
            </p>
            {needleItem.action && (
              <button
                onClick={() => router.push(needleItem.action!.route)}
                className="text-[14px] text-indigo-600 dark:text-indigo-400 font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
              >
                {needleItem.action.label}
              </button>
            )}
          </div>
        )}

        {otherItems.map(item => (
          <div key={item.id}>
            {/* Headline */}
            <p className="text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed mb-3 max-w-prose text-pretty">
              <strong className="text-slate-900 dark:text-slate-100 font-semibold"><MoneyText text={item.headline} /></strong>
            </p>
            {/* Body */}
            <p lang="en-GB" className="text-pretty text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed max-w-prose">
              <MoneyText text={item.body ?? ""} />
            </p>
          </div>
        ))}

        {moveItems.map(item => (
          <MoveCard key={item.id} item={item} router={router} hideNetWorth={hideNetWorth} maskAmounts={maskAmounts} hideAttribution={hideAttribution} dismissible={dismissible} onHomeDismiss={onHomeDismiss} />
        ))}
    </div>
  );
}

export interface HomeBriefClearedRowProps {
  /** From BriefBody's onClearedChange (see BriefBodyProps) — `null` means
   * render nothing, this state doesn't apply right now. Purely
   * presentational: BriefBody owns the one dismissedIds source of truth
   * (its useHomeDismissedAdvice instance) and reports the derived count/type
   * up here, rather than this component re-deriving its own copy from
   * localStorage. A second independent hook instance would go stale the
   * moment the user dismisses the last card on Home — its mount-only
   * localStorage read has no way to learn about a sibling's later
   * dismiss() call, so the row wouldn't appear until a full remount. */
  cleared: { count: number; type: CompanionItem["type"] } | null;
  router: ReturnType<typeof useRouter>;
}

// Naming just the TYPE of the first cleared item (not its headline) is
// enough to judge whether the tap is worth it, and it's safe under
// hideNetWorth — no figures, nothing to mask. Keys are the real
// CompanionItem["type"] union (lib/api.ts) as actually emitted by
// backend/app/services/companion.py; "info" is declared in the type but not
// currently produced, so it's left unmapped and falls through to "something"
// rather than guessing a label for a state that doesn't exist yet.
const CLEARED_TYPE_LABEL: Record<string, string> = {
  move: "a money move",
  cliff: "an upcoming bill",
  trajectory: "an upcoming bill",
  rhythm: "a spending change",
  intent_pace: "a pace note",
  celebration: "a win",
  ask: "a question",
  needle: "last month's review",
  payday_plan: "your payday plan",
  unfunded_move: "a planned move",
};

// The "everything's hidden, but not actually done" pointer — see the
// comment on BriefBody's `items.length === 0` branch for why this state has
// to exist at all (Penny's archive keeps it real; "nothing needs you" would
// be a lie the user could disprove there). Pulled out as its own component,
// rather than rendered inline by BriefBody, so HomePage can mount it below
// SafeToSpendCard instead of above it: Home's top slot answers "am I okay",
// and a routing pointer to Penny isn't that answer.
export function HomeBriefClearedRow({ cleared, router }: HomeBriefClearedRowProps) {
  if (!cleared) return null;

  const lead = CLEARED_TYPE_LABEL[cleared.type] ?? "something";
  // One sentence, one idea: something still needs the user, and where it
  // lives. No backward-narration of the dismiss action itself ("You
  // cleared…") — that's bookkeeping the user already knows, not information.
  const stillLabel =
    cleared.count === 1
      ? `${lead.charAt(0).toUpperCase()}${lead.slice(1)} is still on Penny.`
      : `${lead.charAt(0).toUpperCase()}${lead.slice(1)} and ${cleared.count - 1} more are still on Penny.`;

  return (
    <button
      type="button"
      onClick={() => router.push("/penny")}
      className="mt-3 w-full glass-card rounded-2xl px-3.5 py-3 min-h-[52px] flex items-center gap-2 text-left active:scale-[0.99] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      {/* Gradient square + PennyMark — attribution and wayfinding (whose
          voice this is, and that it rhymes with where the tap goes), not
          branding: no uppercase PENNY chip here, this row says nothing in
          Penny's voice. Matches PennyPage.tsx's own header mark (~line 165). */}
      <span
        className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: BRAND_GRADIENT }}
      >
        <PennyMark size={11} className="text-white" />
      </span>
      <span lang="en-GB" className="flex-1 min-w-0 text-[14px] text-slate-600 dark:text-slate-300 leading-snug text-pretty">
        {stillLabel}
      </span>
      <ChevronRight size={16} aria-hidden="true" className="flex-shrink-0 text-slate-500 dark:text-slate-400" />
    </button>
  );
}

export default function HomeBrief({ items, firstName, safeToSpend, loading, syncing, syncError, onSync, hideNetWorth, onRefresh, attnTarget, dismissible, hasAccounts, onClearedChange, onInsightWinVisibleChange, banner }: HomeBriefProps) {
  const router = useRouter();
  const { user } = useAuth();
  const name = firstName || "there";

  // Avatar initials — derived from the full account name (not just firstName),
  // up to two initials from the first two words. Falls back to a generic
  // person icon when there's no name to work with yet.
  const avatarInitials = (() => {
    const full = user?.name?.trim();
    if (!full) return null;
    const words = full.split(/\s+/).filter(Boolean);
    const initials = words
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("");
    return initials || null;
  })();

  // Hydration guard: render a neutral greeting on first paint to avoid SSR/client
  // mismatch from new Date().getHours(), then swap to the time-aware version after mount.
  const [greeting, setGreeting] = useState(`Hi, ${name}`);
  useEffect(() => {
    const hour = new Date().getHours();
    setGreeting(
      hour < 12
        ? `Good morning, ${name}`
        : hour < 18
        ? `Good afternoon, ${name}`
        : `Good evening, ${name}`
    );
  }, [name]);

  return (
    <div className="rise-in" style={{ "--rise-index": 0 } as React.CSSProperties}>
      {/* Header row */}
      <div className="flex items-center gap-2 mb-3">
        {/* Avatar — relocated off the bottom nav (Nav A redesign dropped the
            5th tab); this top-left avatar on Home is now the primary mobile
            entry point to /settings. Visible circle is 36px but the tap
            target is padded out to the 44px HIG minimum. */}
        <Link
          href="/settings"
          aria-label="Account and settings"
          className="lg:hidden shrink-0 -ml-1 w-11 h-11 flex items-center justify-center rounded-full active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <span className="w-9 h-9 flex items-center justify-center rounded-full bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 text-[13px] font-semibold">
            {avatarInitials ?? <UserRound size={16} aria-hidden="true" />}
          </span>
        </Link>
        <h1 className="flex-1 min-w-0 truncate text-[28px] font-bold tracking-tight text-slate-900 dark:text-slate-100 leading-tight">{greeting}</h1>
        <button
          onClick={onSync}
          disabled={syncing}
          aria-label={syncing ? "Syncing…" : "Sync accounts"}
          className="shrink-0 -mr-1 w-11 h-11 flex items-center justify-center rounded-full active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <span className="w-9 h-9 flex items-center justify-center rounded-full bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700">
            <RefreshCw size={14} aria-hidden="true" className={`text-slate-500 dark:text-slate-400 ${syncing ? "animate-spin" : ""}`} />
          </span>
        </button>
      </div>

      {/* Caller-supplied banner — see HomeBriefProps.banner. Sits directly
          under the greeting row and above everything else this component
          renders, so it can never end up below the payday plan card. The
          banner itself carries no outer margin (slot spacing is the slot's
          job, not the content's) — this mb-3 is what gives it the same 12px
          rhythm as the greeting's own mb-3 above it and the body's
          space-y-3 below it. */}
      {banner && <div className="mb-3">{banner}</div>}

      {/* Brief body */}
      <div className="space-y-3">
        {syncError && <SyncErrorBanner glow={attnTarget === "sync"} />}
        {loading ? (
          <BriefSkeleton />
        ) : (
          <BriefBody items={items} safeToSpend={safeToSpend} router={router} hideNetWorth={hideNetWorth} onRefresh={onRefresh} attnTarget={attnTarget} dismissible={dismissible} onClearedChange={onClearedChange} onInsightWinVisibleChange={onInsightWinVisibleChange} />
        )}
      </div>

      {/* Payday plan — live full card, or the quiet entry/preview affordance
          when there's no live plan. Home-only: gated to the last 5 days
          before period end (or the live execution window itself) so it
          doesn't sit here year-round — that's Penny's job now (its permanent
          home, ungated: PaydayPlanSection is reused there with `gate`
          omitted). See lib/paydayWindow.ts for the shared rule. */}
      <PaydayPlanSection
        items={items}
        safeToSpend={safeToSpend}
        hideNetWorth={hideNetWorth}
        onRefresh={onRefresh}
        gate
        hasAccounts={hasAccounts}
      />
    </div>
  );
}

export interface PaydayPlanSectionProps {
  items: CompanionItem[];
  safeToSpend: SafeToSpend | null;
  hideNetWorth?: boolean;
  onRefresh?: () => void;
  /**
   * Home-only: also require the last-5-days-before-period-end/live-execution
   * window (lib/paydayWindow.ts) before showing the (non-live) entry row.
   * Omitted on Penny — the plan's permanent home — so the affordance is
   * always available there, exactly like this used to behave unconditionally
   * for everyone before the Home gating requirement.
   */
  gate?: boolean;
  /**
   * Home-only: when explicitly `false` (accounts have finished loading and
   * there are none), this section renders nothing at all — no entry row,
   * no live plan — regardless of what safeToSpend/items say. Leave
   * `undefined` while accounts are still loading, or on Penny (which never
   * passes it), to fall back to the normal gate/windowActive logic.
   */
  hasAccounts?: boolean;
}

// Third state (2026-08-29 FIX A): the window's live payday_plan has already
// auto-verified ("done") — nothing left to forecast, only to report. A
// quiet, single tap target ("Already split: £600 to 2 accounts ›") that
// expands IN PLACE into the same full PaydayPlanCard using the item's own
// (already-fetched) data — never a fresh preview fetch, and no glow (the
// attention rung was removed app-wide, 2026-08-29 — this state is calm,
// not something that needs eyes on it).
//
// FIX D (2026-08-29, owner report): passes `onClose` (never `dismissible`)
// to the expanded PaydayPlanCard below, on BOTH Home and Penny. Before
// PaydayPlanCard's `showCloseButton`/`onClose` fix, its × branched on
// `item.preview` — false for an executed item — so this expand's × fell
// into `handleDismiss`: the row looked like it "disappeared" on click
// (rather than collapsing) and silently persisted a backend dismiss that
// didn't even suppress regeneration (companion.py's executed-item path
// never consulted the dismissed set), hence "clears but comes back on
// refresh". Now the × here only ever collapses back to the summary row —
// never a real dismiss — so it's safe to keep on Penny too, which per the
// owner's rule (payday plan is Penny's permanent, non-dismissible content)
// must never let this report be dismissed away, only shown or collapsed.
function ExecutedPaydayRow({
  item, router, hideNetWorth, maskAmounts, onRefresh,
}: {
  item: CompanionItem;
  router: ReturnType<typeof useRouter>;
  hideNetWorth: boolean;
  maskAmounts: (text: string) => string;
  onRefresh?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const moveCount = (item.dests ?? []).filter(d => d.move > 0).length;
  const total = Math.round(item.total ?? 0);
  const summary = hideNetWorth
    ? `Already split: £•••• to ${moveCount} ${moveCount === 1 ? "account" : "accounts"}`
    : `Already split: £${total.toLocaleString("en-GB")} to ${moveCount} ${moveCount === 1 ? "account" : "accounts"}`;

  if (expanded) {
    return (
      <PaydayPlanCard
        item={item}
        router={router}
        hideNetWorth={hideNetWorth}
        maskAmounts={maskAmounts}
        onRefresh={onRefresh}
        onClose={() => setExpanded(false)}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setExpanded(true)}
      aria-expanded={false}
      className="glass-card rounded-2xl w-full min-h-[44px] px-4 py-3 flex items-center justify-between gap-3 text-left active:scale-[0.99] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold text-slate-900 dark:text-slate-100 leading-snug">
          {maskAmounts(summary)}
        </span>
      </span>
      <ChevronRight size={16} aria-hidden="true" className="flex-shrink-0 text-slate-400 dark:text-slate-500" />
    </button>
  );
}

// Extracted out of HomeBrief/BriefBody so both Home (gated to a timely
// window) and the Penny screen (its permanent, ungated home) render the
// exact same live-card + entry/preview logic — no forked copy to drift.
export function PaydayPlanSection({ items, safeToSpend, hideNetWorth = false, onRefresh, gate, hasAccounts }: PaydayPlanSectionProps) {
  const router = useRouter();

  // Payday plan preview — fetches /today?payday_preview=1 directly and
  // renders the returned preview item locally without touching server state.
  // Toggled from the entry row below; opens in place, no scroll-jump.
  const [previewItem, setPreviewItem] = useState<CompanionItem | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // No-accounts guard — Home-only (gate is only ever true on Home). Once
  // accounts have loaded and there genuinely are none, this section must
  // never render, no matter what a stale/edge-case safeToSpend response says.
  const noAccountsBlock = !!gate && hasAccounts === false;

  const paydayPlanItems = items.filter(i => i.type === "payday_plan");
  // Hide the entry row entirely once a real payday_plan item is already
  // surfaced in items (payday itself) — no duplication on payday. An
  // `executed` item (2026-08-29 FIX A: the window's live plan has already
  // auto-verified) still counts as "there's a plan here" for this purpose —
  // it renders its own quiet row below rather than the entry row reopening
  // a preview that, inside an already-paid window, has nothing left to
  // forecast.
  const hasLivePlan = paydayPlanItems.length > 0;
  // Third state (window active + plan executed): a quiet "Already split"
  // row, expandable in place into the SAME full PaydayPlanCard using data
  // already on hand — never a fresh `/today?payday_preview=1` fetch, which
  // is exactly the call FIX A's gate now knows to answer with this same
  // executed summary anyway.
  const executedPlanItems = paydayPlanItems.filter(i => i.executed);
  const activePlanItems = paydayPlanItems.filter(i => !i.executed);

  const windowActive = isPaydayWindowActive({
    hasLivePlan,
    daysUntilPayday: safeToSpend?.status === "ok" ? safeToSpend.days_until_payday : null,
  });

  // Entry-row dismiss — Home-only (gate). On Penny (gate undefined) the
  // section IS the page's own permanent content, not an interjection, so no
  // dismiss control renders there and canDismissEntry is simply false.
  // Guard: without an ok safeToSpend there's no payday date to key the
  // dismissal on, so canDismissEntry stays false and the row behaves
  // exactly as it did before dismiss existed (shown whenever the
  // window/live-plan logic says so, nothing stored, nothing to crash on).
  const nextPayday = safeToSpend?.status === "ok" ? safeToSpend.next_payday : null;
  const canDismissEntry = !!gate && !!nextPayday;
  // Read straight from localStorage during render rather than mirroring it
  // into state via an effect — it's a plain derived value (no fetch, no
  // subscription to sync), and `dismissOverride` below gives the click an
  // instant local echo without waiting on a render round-trip.
  const [dismissOverride, setDismissOverride] = useState<string | null>(null);
  const entryDismissed =
    canDismissEntry && (dismissOverride === nextPayday || readDismissedPaydayEntry() === nextPayday);

  const showEntryRow = !noAccountsBlock && !hasLivePlan && (!gate || windowActive) && !entryDismissed;

  function handleDismissEntry(e: React.MouseEvent) {
    e.stopPropagation();
    if (!nextPayday) return; // guard: nothing to key the dismissal on
    writeDismissedPaydayEntry(nextPayday);
    setDismissOverride(nextPayday);
    // Close the expanded preview too — dismissing the row shouldn't leave an
    // orphaned preview card floating with nothing to collapse it into.
    setPreviewItem(null);
    setPreviewError(null);
  }

  function maskAmounts(text: string): string {
    if (!hideNetWorth) return text;
    return text.replace(/£[\d,]+/g, "£••••");
  }

  const paydaySubline = (() => {
    if (!safeToSpend || safeToSpend.status !== "ok") return "See how I'd split your next salary";
    const d = new Date(safeToSpend.next_payday);
    d.setHours(0, 0, 0, 0);
    const today0 = new Date();
    today0.setHours(0, 0, 0, 0);
    const daysAway = Math.round((d.getTime() - today0.getTime()) / 86400000);
    // Distance-aware date convention (mirrors SafeToSpendCard.tsx): today/tomorrow/weekday/short-date.
    if (daysAway <= 0) return "Pay period ends today. See how I'd split your next pay cheque";
    if (daysAway === 1) return "Pay period ends tomorrow. See how I'd split your next pay cheque";
    if (daysAway < 7) {
      const wd = new Date(safeToSpend.next_payday).toLocaleDateString("en-GB", { weekday: "long" });
      return `Pay period ends ${wd}. See how I'd split your next pay cheque`;
    }
    const short = new Date(safeToSpend.next_payday).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    return `Pay period ends ${short}. See how I'd split your next pay cheque`;
  })();

  async function handleTogglePreview() {
    if (previewItem) {
      setPreviewItem(null);
      setPreviewError(null);
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await api.getToday(true);
      const found = res.items.find(i => i.type === "payday_plan") ?? null;
      if (found) {
        setPreviewItem(found);
      } else {
        setPreviewError("No payday plan to show yet.");
      }
    } catch {
      setPreviewError("Couldn't build the plan just now, try again after a sync.");
    } finally {
      setPreviewLoading(false);
    }
  }

  // With zero accounts, never render — not the entry row, not a (spurious)
  // live plan either.
  if (noAccountsBlock) return null;
  if (!hasLivePlan && !showEntryRow) return null;

  return (
    <div className="mt-3 space-y-3">
      {activePlanItems.map(item => (
        <PaydayPlanCard key={item.id} item={item} router={router} hideNetWorth={hideNetWorth} maskAmounts={maskAmounts} onRefresh={onRefresh} dismissible={!!gate} />
      ))}

      {executedPlanItems.map(item => (
        <ExecutedPaydayRow key={item.id} item={item} router={router} hideNetWorth={hideNetWorth} maskAmounts={maskAmounts} onRefresh={onRefresh} />
      ))}

      {showEntryRow && (
        <div className="space-y-2">
          {/* Wrapper, not a nested button — HTML forbids button-in-button.
              The row itself stays one full-width tap target for the preview
              toggle; the dismiss X is a sibling control absolutely
              positioned over its right edge, matching PaydayPlanCard's
              top-right X sizing (44px hit target) for visual consistency. */}
          <div className="relative">
            <button
              type="button"
              onClick={handleTogglePreview}
              disabled={previewLoading}
              aria-expanded={!!previewItem}
              className={`glass-card rounded-2xl w-full min-h-[44px] px-4 py-3${canDismissEntry ? " pr-14" : ""} flex items-center justify-between gap-3 text-left active:scale-[0.99] transition-transform disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`}
            >
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                  Payday plan
                </span>
                <span className="block text-[13px] text-slate-500 dark:text-slate-400 leading-snug">
                  {paydaySubline}
                </span>
              </span>
              <ChevronRight
                size={16}
                aria-hidden="true"
                className={`flex-shrink-0 text-slate-400 dark:text-slate-500 transition-transform duration-200 ${previewItem ? "rotate-90" : ""}`}
              />
            </button>

            {/* Dismiss — Home-only. Window-scoped (see handleDismissEntry):
                hides this teaser until next payday's window, never for
                good. Not rendered on Penny, where this section is the
                page's own permanent content rather than an interjection. */}
            {canDismissEntry && (
              <DismissChip
                label="Dismiss until next payday"
                onClick={handleDismissEntry}
                className="absolute top-1/2 right-1 -translate-y-1/2"
              />
            )}
          </div>

          {previewLoading && (
            <p className="text-[13px] text-slate-500 dark:text-slate-400 px-1">Working it out…</p>
          )}

          {previewError && (
            <p className="text-[13px] text-slate-500 dark:text-slate-400 px-1">{previewError}</p>
          )}

          {previewItem && (
            <PaydayPlanCard
              item={previewItem}
              router={router}
              hideNetWorth={!!hideNetWorth}
              maskAmounts={maskAmounts}
              onRefresh={onRefresh}
              onClose={() => setPreviewItem(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}
