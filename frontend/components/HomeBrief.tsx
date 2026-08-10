"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { RefreshCw, AlertTriangle, TrendingDown, X } from "lucide-react";
import type { CompanionItem, PlanDest, SafeToSpend } from "@/lib/api";
import { api } from "@/lib/api";
import TutorialTrigger from "@/components/TutorialTrigger";
import PaydayPlanCard from "@/components/PaydayPlanCard";
import { BankBadge, BANK_META, bankKey } from "@/components/AccountMiniCard";
import { useColours } from "@/components/ColourProvider";
import { useCategoryIcons } from "@/components/IconProvider";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { getCategoryColour } from "@/lib/categories";

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
}

function BriefSkeleton() {
  return (
    <div className="space-y-2">
      <div className="h-4 w-3/4 bg-slate-100 dark:bg-slate-700 rounded-lg animate-pulse" />
      <div className="h-4 w-1/2 bg-slate-100 dark:bg-slate-700 rounded-lg animate-pulse" />
    </div>
  );
}

function SyncErrorBanner() {
  return (
    <div role="alert" className="flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2">
      <AlertTriangle size={13} aria-hidden="true" className="text-amber-500 dark:text-amber-400 flex-shrink-0" />
      <p className="text-sm text-amber-700 dark:text-amber-300 flex-1">Sync didn&apos;t complete — try again in a moment.</p>
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

interface AskPaydayCardProps {
  item: CompanionItem;
  router: ReturnType<typeof useRouter>;
  hideNetWorth: boolean;
  maskAmounts: (text: string) => string;
  onRefresh?: () => void;
}

function AskPaydayCard({ item, router, maskAmounts, onRefresh }: AskPaydayCardProps) {
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
      {/* Penny gradient chip */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white rounded-full px-2.5 py-1"
          style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" }}
        >
          ✦ Penny
        </span>
      </div>
      {/* Headline */}
      <p className="text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed mb-3 max-w-prose">
        <strong className="text-slate-900 dark:text-slate-100 font-semibold">{item.headline}</strong>
      </p>
      {/* Body */}
      <p className="text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed mb-3 max-w-prose">
        {maskAmounts(item.body ?? "")}
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
          {item.secondary_action?.label ?? "No — set it myself"}
        </button>
      </div>
    </div>
  );
}

interface AskGenericCardProps {
  item: CompanionItem;
  router: ReturnType<typeof useRouter>;
  maskAmounts: (text: string) => string;
}

// Generic ask card — same visual family as the payday ask (glass card, Penny
// chip, headline + body ramp), but the primary action is a route push from
// item.action and "Not now" quietly dismisses server-side. Used for any ask
// item without bespoke handling (e.g. ask:card_terms).
function AskGenericCard({ item, router, maskAmounts }: AskGenericCardProps) {
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  function handleGo() {
    if (item.action) router.push(item.action.route);
  }

  async function handleNotNow() {
    if (busy) return;
    setBusy(true);
    try {
      await api.dismissTodayItem(item.id);
    } catch { /* card still hides locally; the backend will re-surface next run */ }
    setHidden(true);
  }

  return (
    <div className="glass-card rounded-2xl p-4">
      {/* Penny gradient chip */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white rounded-full px-2.5 py-1"
          style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" }}
        >
          ✦ Penny
        </span>
      </div>
      {/* Headline */}
      <p className="text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed mb-3 max-w-prose">
        <strong className="text-slate-900 dark:text-slate-100 font-semibold">{item.headline}</strong>
      </p>
      {/* Body */}
      <p className="text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed mb-3 max-w-prose">
        {maskAmounts(item.body ?? "")}
      </p>
      {/* Actions */}
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
        <button
          onClick={handleNotNow}
          disabled={busy}
          className="inline-flex items-center text-slate-500 dark:text-slate-400 text-sm font-semibold px-4 py-2 rounded-xl hover:opacity-80 active:opacity-70 transition-[transform,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 min-h-[44px]"
        >
          Not now
        </button>
      </div>
    </div>
  );
}

interface CelebrationCardProps {
  item: CompanionItem;
  router: ReturnType<typeof useRouter>;
  maskAmounts: (text: string) => string;
}

// "Sorted" reward card — a proper glass card, not a pill. Emerald lives ONLY on
// the ✦ mark (colour is information: verified-safe); the headline stays ink.
// Tapping the card opens the Mirror; the ✕ dismisses server-side then locally.
function CelebrationCard({ item, router, maskAmounts }: CelebrationCardProps) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation();
    setHidden(true);
    api.dismissTodayItem(item.id).catch(() => {
      /* card already removed locally; the backend will retry-surface next run */
    });
  }

  function handleOpen() {
    router.push("/mirror");
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
        <span aria-hidden="true" className="text-emerald-500 text-[15px] leading-6 flex-shrink-0">✦</span>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold text-slate-900 dark:text-white leading-6">
            {item.headline}
          </p>
          {item.body && (
            <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400 leading-snug">
              {maskAmounts(item.body)}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={handleDismiss}
          className="flex-shrink-0 -mt-2 -mr-2 w-11 h-11 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 active:scale-95 transition-[transform,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

interface CliffCardProps {
  item: CompanionItem;
  router: ReturnType<typeof useRouter>;
  maskAmounts: (text: string) => string;
}

// Informational fact-card family — covers promo-cliff and debt-trajectory items.
// NO Penny gradient (the indigo→violet gradient marks advice surfaces; these
// state facts). Amber mark only: approaching/projected risk, not materialised
// risk — red stays strictly reserved for materialised risk (Red-is-Risk rule).
// Icon varies by type: AlertTriangle for cliff, TrendingDown for trajectory.
function CliffCard({ item, router, maskAmounts }: CliffCardProps) {
  const Icon = item.type === "trajectory" ? TrendingDown : AlertTriangle;
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation();
    setHidden(true);
    api.dismissTodayItem(item.id).catch(() => {
      /* card already removed locally; the backend will re-surface next run */
    });
  }

  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-start gap-3">
        <Icon size={15} aria-hidden="true" className="text-amber-500 dark:text-amber-400 flex-shrink-0 mt-[5px]" />
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold text-slate-900 dark:text-white leading-6">
            {maskAmounts(item.headline)}
          </p>
          {item.body && (
            <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400 leading-snug">
              {maskAmounts(item.body)}
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
        <button
          type="button"
          aria-label="Dismiss"
          onClick={handleDismiss}
          className="flex-shrink-0 -mt-2 -mr-2 w-11 h-11 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 active:scale-95 transition-[transform,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

interface MoveCardProps {
  item: CompanionItem;
  router: ReturnType<typeof useRouter>;
  hideNetWorth: boolean;
  maskAmounts: (text: string) => string;
}

function MoveCard({ item, router, hideNetWorth, maskAmounts }: MoveCardProps) {
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
      {/* Penny gradient chip — marks this as a proactive advice surface */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white rounded-full px-2.5 py-1"
          style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" }}
        >
          ✦ Penny
        </span>
      </div>
      {item.plan_dest ? (
        <>
          {/* Headline */}
          <p className="text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed mb-3 max-w-prose">
            <strong className="text-slate-900 dark:text-slate-100 font-semibold">{item.headline}.</strong>
          </p>

          {/* a) Destination tile */}
          {(() => {
            const dest: PlanDest = item.plan_dest!;
            const destChip = resolveBankChip(dest.provider ?? "");
            const billCount = (dest.bills ?? []).length;
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
                    {maskAmounts(billCount === 1
                      ? `£${Math.round(dest.balance).toLocaleString("en-GB")} held · £${(dest.needs_total ?? 0).toLocaleString("en-GB")} payment lands ${dest.needs_by}`
                      : `£${Math.round(dest.balance).toLocaleString("en-GB")} held · £${(dest.needs_total ?? 0).toLocaleString("en-GB")} in ${billCount} payments before payday · first lands ${dest.needs_by}`)}
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
                  <span className="num text-sm font-semibold text-slate-900 dark:text-slate-100 flex-shrink-0">
                    {hideNetWorth ? "£••••" : `£${Math.round(leg.amount).toLocaleString("en-GB")}`}
                  </span>
                </div>
              );
            })}
            {/* Total row */}
            <div className="flex items-center justify-between gap-2.5 px-3 min-h-[44px]">
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Moving <span className="num">{hideNetWorth ? "£••••" : `£${Math.round(totalAmount).toLocaleString("en-GB")}`}</span>
              </span>
            </div>
          </div>

          {/* Footer — merged assurance line + residual */}
          {(() => {
            const destBillCount = (item.plan_dest?.bills ?? []).length;
            const clearClause = item.covered && destBillCount > 0
              ? (destBillCount === 1 ? "Clears the payment" : `Clears all ${destBillCount} payments`)
              : null;
            const safeClause = item.sources_safe
              ? (legs.length === 1 ? "the source still covers its own bills" : "every source still covers its own bills")
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
                  <p className="text-[12px] text-slate-400 dark:text-slate-500 leading-snug">{maskAmounts(String(item.residual))}</p>
                )}
                {item.income_note && (
                  <p className="text-[12px] text-slate-400 dark:text-slate-500 leading-snug">{maskAmounts(item.income_note)}</p>
                )}
                {item.overflow_note && (
                  <p className="text-[12px] text-slate-400 dark:text-slate-500 leading-snug">{item.overflow_note}</p>
                )}
              </div>
            );
          })()}
        </>
      ) : (
        <p className="text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed mb-3 max-w-prose">
          <strong className="text-slate-900 dark:text-slate-100 font-semibold">{item.headline}.</strong>{" "}
          {item.body}
        </p>
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
}

function RhythmCard({ item, router, maskAmounts, onRefresh }: RhythmCardProps) {
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState<null | "one_off" | "new_normal">(null);
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
    ? `${fmtSpent} in ${category} — way above your usual`
    : `${category} ran ${fmtMultiple} your usual`;

  // ONE supporting line — collapses the redundant triple to a single statement
  let supportLine: string | null = null;
  if (dominant) {
    const name = dominant.name.length > 24 ? dominant.name.slice(0, 23) + "…" : dominant.name;
    const amt = "£" + Math.round(dominant.amount).toLocaleString("en-GB");
    const d = new Date(dominant.date);
    const dateStr = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const dominantShare = spent > 0 ? dominant.amount / spent : 0;
    if (dominantShare >= 0.95) {
      // Dominant IS the spend — no need to repeat the £ figure
      supportLine = `One payment — ${name}, ${dateStr}.`;
    } else {
      // Dominant is notable but not everything
      supportLine = `Mostly one payment — ${name}, ${amt} on ${dateStr}.`;
    }
  } else {
    supportLine = `${fmtSpent} so far this period.`;
  }

  async function handleIntent(answer: "one_off" | "new_normal") {
    if (busy) return;
    setBusy(answer);
    setHidden(true);
    try {
      await api.recordTrendIntent(category, answer);
      onRefresh?.();
    } catch {
      // Card already removed locally; backend will re-surface next run
    }
  }

  function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation();
    setHidden(true);
    api.dismissTodayItem(item.id).catch(() => {});
  }

  function handleChangeThis() {
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
            {headline}
          </p>
          {/* One supporting line */}
          {supportLine && (
            <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400 leading-snug">
              {maskAmounts(supportLine)}
            </p>
          )}
        </div>

        {/* Dismiss button */}
        <button
          type="button"
          aria-label="Dismiss"
          onClick={handleDismiss}
          className="flex-shrink-0 -mt-2 -mr-2 w-11 h-11 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 active:scale-95 transition-[transform,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      {/* Answer pair — outside the icon-indented column, full width. The two
          real answers sit in a symmetric 50/50 grid; the softer "change this"
          escape hatch drops below as its own quiet, ghost-styled full-width row
          so it reads as subordinate to the pair. */}
      <div className="mt-3 flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => handleIntent("one_off")}
            disabled={busy !== null}
            className="inline-flex items-center justify-center text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 active:scale-95 transition-[transform,background-color] text-sm font-semibold px-3 py-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
          >
            A one-off
          </button>
          <button
            onClick={() => handleIntent("new_normal")}
            disabled={busy !== null}
            className="inline-flex items-center justify-center text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 active:scale-95 transition-[transform,background-color] text-sm font-semibold px-3 py-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
          >
            My new normal
          </button>
        </div>
        <button
          onClick={handleChangeThis}
          disabled={busy !== null}
          className="inline-flex items-center justify-center w-full text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100/50 dark:hover:bg-slate-700/40 active:scale-95 transition-[transform,background-color,color] text-sm font-semibold px-3 py-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
        >
          I&apos;d like to change this
        </button>
      </div>
    </div>
  );
}

interface BriefBodyProps {
  items: CompanionItem[];
  safeToSpend: SafeToSpend | null;
  router: ReturnType<typeof useRouter>;
  hideNetWorth?: boolean;
  onRefresh?: () => void;
}

function BriefBody({ items, safeToSpend, router, hideNetWorth = false, onRefresh }: BriefBodyProps) {
  if (items.length === 0) {
    let fallbackText: string;
    if (!safeToSpend || safeToSpend.status === "insufficient_data") {
      fallbackText = "Nothing needs you today. I'm keeping an eye on the bills — just check back later.";
    } else if (safeToSpend.state === "tight") {
      fallbackText = "Nothing needs you today — payday's close. The first week's bills are already mapped, so just cruise.";
    } else if (safeToSpend.state === "short") {
      fallbackText = "One thing's worth a look below — otherwise I've got the rest mapped.";
    } else {
      fallbackText = "Nothing needs you today. You've got headroom, and I'm watching the bills — enjoy it.";
    }
    return (
      <p className="text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed">{fallbackText}</p>
    );
  }

  const moveItems = items.filter(i => i.type === "move");
  const paydayPlanItems = items.filter(i => i.type === "payday_plan");
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
  const otherItems = items.filter(i => i.type !== "move" && i.type !== "payday_plan" && i.type !== "celebration" && i.type !== "needle" && i.type !== "ask" && i.type !== "cliff" && i.type !== "trajectory" && i.type !== "rhythm");

  // Mask £ figures in a string when hideNetWorth is on
  function maskAmounts(text: string): string {
    if (!hideNetWorth) return text;
    return text.replace(/£[\d,]+/g, "£••••");
  }

  return (
    <div className="space-y-3">
        {celebrationItems.map(item => (
          <CelebrationCard key={item.id} item={item} router={router} maskAmounts={maskAmounts} />
        ))}

        {cliffItems.map(item => (
          <CliffCard key={item.id} item={item} router={router} maskAmounts={maskAmounts} />
        ))}

        {trajectoryItems.map(item => (
          <CliffCard key={item.id} item={item} router={router} maskAmounts={maskAmounts} />
        ))}

        {rhythmItems.map(item => (
          <RhythmCard key={item.id} item={item} router={router} maskAmounts={maskAmounts} onRefresh={onRefresh} />
        ))}

        {/* Payload-less rhythm items (cliff/switch behaviour cards) — plain
            info card, no "× your usual" line and no intent buttons since
            there's no category/multiple/spent to anchor them to. Reuses the
            existing informational fact-card family (CliffCard). */}
        {rhythmInfoItems.map(item => (
          <CliffCard key={item.id} item={item} router={router} maskAmounts={maskAmounts} />
        ))}

        {/* Ask cards — payday keeps its bespoke confirm/decline; everything
            else (e.g. ask:card_terms) renders the generic route-push ask */}
        {askItem && (
          askItem.id === "ask:payday" ? (
            <AskPaydayCard
              item={askItem}
              router={router}
              hideNetWorth={hideNetWorth}
              maskAmounts={maskAmounts}
              onRefresh={onRefresh}
            />
          ) : (
            <AskGenericCard item={askItem} router={router} maskAmounts={maskAmounts} />
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
          <p key={item.id} className="text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed max-w-prose">
            <strong className="text-slate-900 dark:text-slate-100 font-semibold">{item.headline}.</strong>{" "}
            {item.body}
          </p>
        ))}

        {paydayPlanItems.map(item => (
          <PaydayPlanCard key={item.id} item={item} router={router} hideNetWorth={hideNetWorth} maskAmounts={maskAmounts} onRefresh={onRefresh} />
        ))}

        {moveItems.map(item => (
          <MoveCard key={item.id} item={item} router={router} hideNetWorth={hideNetWorth} maskAmounts={maskAmounts} />
        ))}
    </div>
  );
}

export default function HomeBrief({ items, firstName, safeToSpend, loading, syncing, syncError, onSync, hideNetWorth, onRefresh }: HomeBriefProps) {
  const router = useRouter();
  const name = firstName || "there";

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

  // TEMP — preview affordance for the payday_plan companion card, same spirit
  // as the old variant pills: fetches /today?payday_preview=1 directly (this
  // is where HomeBrief has fetch access, since items normally arrive as a
  // prop from HomePage) and renders the returned preview item locally without
  // touching server state. Remove once payday_plan is validated.
  const [previewItem, setPreviewItem] = useState<CompanionItem | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewCardRef = useRef<HTMLDivElement>(null);

  // TEMP — once the preview card loads, scroll it into view so the user
  // isn't left where they were (the card renders above BriefBody, at the
  // top of the section). Respects reduced-motion.
  useEffect(() => {
    if (!previewItem) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    previewCardRef.current?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
  }, [previewItem]);

  function maskAmountsTop(text: string): string {
    if (!hideNetWorth) return text;
    return text.replace(/£[\d,]+/g, "£••••");
  }

  async function handleTogglePreview() {
    if (previewItem) {
      setPreviewItem(null);
      return;
    }
    setPreviewLoading(true);
    try {
      const res = await api.getToday(true);
      setPreviewItem(res.items.find(i => i.type === "payday_plan") ?? null);
    } catch {
      // TEMP affordance — swallow; no error UI needed for a preview toggle
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <div className="rise-in" style={{ "--rise-index": 0 } as React.CSSProperties}>
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-[28px] font-bold tracking-tight text-slate-900 dark:text-slate-100 leading-tight">{greeting}</h1>
        <div className="flex items-center gap-2">
          <TutorialTrigger variant="dark-on-white" />
          <button
            onClick={onSync}
            disabled={syncing}
            aria-label={syncing ? "Syncing…" : "Sync accounts"}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700 active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <RefreshCw size={14} aria-hidden="true" className={`text-slate-500 dark:text-slate-400 ${syncing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Brief body */}
      <div className="space-y-3">
        {syncError && <SyncErrorBanner />}
        {/* TEMP preview render — sits at the top of the section, above whatever
            BriefBody renders, with its own "· preview" suffix (PaydayPlanCard
            reads item.preview). Not part of the real items list, so it isn't
            threaded through BriefBody's filters/props. */}
        {previewItem && (
          <div ref={previewCardRef}>
            <PaydayPlanCard
              item={previewItem}
              router={router}
              hideNetWorth={!!hideNetWorth}
              maskAmounts={maskAmountsTop}
              onRefresh={onRefresh}
            />
          </div>
        )}
        {loading ? (
          <BriefSkeleton />
        ) : (
          <BriefBody items={items} safeToSpend={safeToSpend} router={router} hideNetWorth={hideNetWorth} onRefresh={onRefresh} />
        )}
      </div>

      {/* TEMP — preview affordance for the payday_plan companion card, marked
          for removal once the feature is validated (mirrors the old variant-pill
          pattern of a tiny, clearly-temporary control). */}
      <div className="mt-2 text-right">
        <button
          type="button"
          onClick={handleTogglePreview}
          disabled={previewLoading}
          className="text-[10px] text-slate-400 dark:text-slate-500 underline underline-offset-2 disabled:opacity-50"
        >
          {previewItem ? "Hide preview" : previewLoading ? "Loading preview…" : "Preview payday plan"}
        </button>
      </div>
    </div>
  );
}
