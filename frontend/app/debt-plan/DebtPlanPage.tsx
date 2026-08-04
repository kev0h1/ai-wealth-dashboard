// impeccable-disable design-system-font-size: all literal px sizes here (12px, 13px, 15px) are project-approved in .impeccable/config.json ignoreValues
"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { api, DebtPlanView, DebtPlanViewCard, CardTermsCard } from "@/lib/api";
import { goBack } from "@/lib/goBack";
import { usePreferences } from "@/components/PreferencesContext";
import { BANK_META, BankBadge, bankKey } from "@/components/AccountMiniCard";
import CardTermsSheet from "@/components/CardTermsSheet";
import BottomNav from "@/components/BottomNav";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtMoney(n: number, hide: boolean): string {
  if (hide) return "••••";
  return "£" + Math.round(Math.abs(n)).toLocaleString("en-GB");
}

const THIS_YEAR = new Date().getFullYear();

function fmtMonth(ym: string): string {
  const y = parseInt(ym.slice(0, 4), 10);
  const m = parseInt(ym.slice(5, 7), 10);
  const d = new Date(y, m - 1, 1);
  if (y === THIS_YEAR) return d.toLocaleDateString("en-GB", { month: "short" });
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

/** Is the given "YYYY-MM" promo end-month within 60 days of today?
 *  Convention: the promo runs to the last day of that month. */
function isCliff(until: string): boolean {
  const y = parseInt(until.slice(0, 4), 10);
  const m = parseInt(until.slice(5, 7), 10);
  const lastDay = new Date(y, m, 0); // last day of that month
  const now = Date.now();
  return (lastDay.getTime() - now) / 86_400_000 <= 60;
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
    label: meta?.label ?? (provider || "Card"),
    bg: meta?.bg,
    initialsSize: meta?.initialsSize,
  };
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="rounded-2xl glass-card p-4 animate-pulse">
      <div className="space-y-2">
        <div className="h-4 w-32 bg-slate-200 dark:bg-slate-700 rounded" />
        <div className="h-3 w-full bg-slate-100 dark:bg-slate-700/60 rounded" />
        <div className="h-3 w-3/4 bg-slate-100 dark:bg-slate-700/60 rounded" />
      </div>
    </div>
  );
}

// ── Whisper label ──────────────────────────────────────────────────────────────

function WhisperLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-3">
      {children}
    </p>
  );
}

// ── Verdict block ──────────────────────────────────────────────────────────────

function VerdictBlock({ plan, hide }: { plan: DebtPlanView; hide: boolean }) {
  const { totals } = plan;

  let sentence: React.ReactNode;
  const amberDot = (
    <span className="inline-block w-2 h-2 rounded-full bg-amber-500 mr-2 align-middle" aria-hidden />
  );

  if (totals.verdict === "bad") {
    if (!totals.debt_free_month) {
      sentence = <>{amberDot}At your current pace the cards aren&apos;t coming down.</>;
    } else {
      sentence = (
        <>{amberDot}At your current pace the cards clear in {fmtMonth(totals.debt_free_month)} — further out than five years.</>
      );
    }
  } else if (totals.verdict === "drifting") {
    sentence = (
      <>{amberDot}At your current pace the cards clear in {fmtMonth(totals.debt_free_month!)} — {fmtMoney(totals.total_interest, hide)} of that will be interest.</>
    );
  } else {
    // good
    if (totals.debt < 50 || !totals.debt_free_month) {
      sentence = <>Nothing material on the cards right now.</>;
    } else {
      sentence = (
        <>At your current pace the cards clear in {fmtMonth(totals.debt_free_month)}, with {fmtMoney(totals.total_interest, hide)} interest.</>
      );
    }
  }

  return (
    <div className="glass-hero rounded-3xl p-5">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        ACROSS YOUR CARDS
      </p>
      <p className="text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-100 leading-tight mt-1">
        {hide ? "••••" : "£" + Math.round(totals.debt).toLocaleString("en-GB")}
      </p>
      <p className="text-[15px] leading-relaxed mt-2 text-slate-700 dark:text-slate-200">
        {sentence}
      </p>
    </div>
  );
}

// ── Missing-rates callout ─────────────────────────────────────────────────────

function MissingRatesCallout({
  plan,
  onAddRates,
}: {
  plan: DebtPlanView;
  onAddRates: () => void;
}) {
  const n = plan.cards.filter(c => c.flags.terms_missing && c.debt > 0).length;
  if (n === 0) return null;

  const primary =
    n === 1
      ? "1 card has no rate on file, so its interest isn't counted."
      : `${n} cards have no rate on file, so their interest isn't counted.`;

  return (
    <div className="glass-card rounded-2xl p-4">
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{primary}</p>
      <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1">
        Add them once and the plan can count every pound of interest.
      </p>
      <button
        onClick={onAddRates}
        className="mt-3 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl active:scale-95 transition-[transform,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        Add rates
      </button>
    </div>
  );
}

// ── Two-trajectory block ──────────────────────────────────────────────────────

function TwoTrajectoryBlock({ plan, hide }: { plan: DebtPlanView; hide: boolean }) {
  const { scenario_b, totals, cards } = plan;

  // Degenerate: has `note` key
  const isDegenerate = "note" in scenario_b;
  if (isDegenerate) return null;
  if (!("months_sooner" in scenario_b)) return null;
  if (scenario_b.months_sooner === 0 && scenario_b.interest_saved < 1) return null;

  const pool = Math.round(
    cards
      .filter(c => c.debt > 0 && c.movement.monthly != null && c.movement.monthly! > 0)
      .reduce((sum, c) => sum + c.movement.monthly!, 0)
  );

  return (
    <div className="glass-card rounded-2xl p-4 space-y-3">
      <div className="flex justify-between items-baseline">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          As it stands
        </p>
        <div className="text-right">
          {totals.debt_free_month && (
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{fmtMonth(totals.debt_free_month)}</p>
          )}
          <p className="text-[12px] text-slate-500 dark:text-slate-400">{fmtMoney(totals.total_interest, hide)} interest</p>
        </div>
      </div>
      <div className="flex justify-between items-baseline">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          Dearest card first
        </p>
        <div className="text-right">
          {scenario_b.debt_free_month && (
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{fmtMonth(scenario_b.debt_free_month)}</p>
          )}
          <p className="text-[12px] text-slate-500 dark:text-slate-400">{fmtMoney(scenario_b.total_interest, hide)} interest</p>
        </div>
      </div>
      <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
        Same {hide ? "••••" : "£" + pool.toLocaleString("en-GB")} a month, pointed at the dearest card first — debt-free {scenario_b.months_sooner} months sooner, {fmtMoney(scenario_b.interest_saved, hide)} less interest.
      </p>
      {"assumption" in scenario_b && scenario_b.assumption && (
        <p className="text-[12px] text-slate-500 dark:text-slate-400 italic">{scenario_b.assumption}</p>
      )}
    </div>
  );
}

// ── Rate pill for a card ──────────────────────────────────────────────────────

function RatePill({
  card,
  onClick,
}: {
  card: DebtPlanViewCard;
  onClick: () => void;
}) {
  const seg = card.rate_schedule[0];

  if (card.flags.terms_missing || !seg) {
    return (
      <button
        onClick={onClick}
        aria-label={`Add rate for ${card.name}`}
        className="rounded-full text-[12px] font-semibold px-2.5 py-2 border active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800"
      >
        Add rate
      </button>
    );
  }

  if (seg.source === "promo") {
    const cliff = seg.until ? isCliff(seg.until) : false;
    const label = seg.until
      ? `${seg.apr_pct ?? 0}% until ${fmtMonth(seg.until)}`
      : `${seg.apr_pct ?? 0}%`;

    if (cliff) {
      return (
        <button
          onClick={onClick}
          aria-label={`Edit rate for ${card.name}: ${label} — ending soon`}
          className="rounded-full text-[12px] font-semibold px-2.5 py-2 border active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800"
        >
          {label}
        </button>
      );
    }

    return (
      <button
        onClick={onClick}
        aria-label={`Edit rate for ${card.name}: ${label}`}
        className="rounded-full text-[12px] font-semibold px-2.5 py-2 border active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600"
      >
        {label}
      </button>
    );
  }

  // standard or unknown
  const rateLabel = seg.apr_pct != null ? `${seg.apr_pct}%` : "Rate on file";
  return (
    <button
      onClick={onClick}
      aria-label={`Edit rate for ${card.name}: ${rateLabel}`}
      className="rounded-full text-[12px] font-semibold px-2.5 py-2 border active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600"
    >
      {rateLabel}
    </button>
  );
}

// ── Per-card section ──────────────────────────────────────────────────────────

function CardRows({
  cards,
  hide,
  onOpenSheet,
}: {
  cards: DebtPlanViewCard[];
  hide: boolean;
  onOpenSheet: (accountId: string) => void;
}) {
  return (
    <div>
      <WhisperLabel>THE CARDS</WhisperLabel>
      <div className="glass-card rounded-2xl divide-y divide-slate-100 dark:divide-slate-700/60">
        {cards.map(card => {
          const chip = resolveBankChip(card.provider);
          // Movement line
          const hasMovement = card.movement.monthly != null && card.movement.monthly > 1;
          const projectedFlat = !hasMovement
            ? (card.flags.assumptions ?? []).find(a => a.includes("projected flat"))
            : undefined;

          return (
            <div key={card.account_id} className="p-4 space-y-2">
              {/* Line 1: badge + name + debt */}
              <div className="flex items-center gap-3">
                <BankBadge
                  logoSrc={chip.logoSrc}
                  initials={chip.initials}
                  initialsSize={chip.initialsSize}
                  altText={chip.label}
                  brandBg={chip.bg}
                />
                <p className="flex-1 text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{card.name}</p>
                <p className="text-base font-bold text-slate-900 dark:text-slate-100 flex-shrink-0">
                  {card.debt === 0 ? "£0" : fmtMoney(card.debt, hide)}
                </p>
              </div>

              {/* Line 2: rate pill */}
              <RatePill card={card} onClick={() => onOpenSheet(card.account_id)} />

              {/* Line 3: movement */}
              {hasMovement && (
                <p className="text-[13px] text-slate-500 dark:text-slate-400">
                  +{fmtMoney(card.movement.monthly!, hide)}/mo at your pace
                </p>
              )}
              {!hasMovement && projectedFlat && (
                <p className="text-[13px] text-slate-500 dark:text-slate-400">{projectedFlat}</p>
              )}

              {/* Line 4: payoff */}
              {card.payoff_month && (
                <p className="text-[13px] text-slate-500 dark:text-slate-400">
                  Clears {fmtMonth(card.payoff_month)}
                  {card.total_interest >= 1 && (
                    <> · {fmtMoney(card.total_interest, hide)} interest</>
                  )}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Transfer routes section ───────────────────────────────────────────────────

function TransferRoutes({ plan, hide }: { plan: DebtPlanView; hide: boolean }) {
  if (!plan.refinance_options || plan.refinance_options.length === 0) return null;

  return (
    <div className="space-y-3">
      <WhisperLabel>TRANSFER ROUTES</WhisperLabel>
      {plan.refinance_options.map((opt, i) => {
        // Find source card's standard rate
        const srcCard = plan.cards.find(c => c.account_id === opt.source_account_id);
        const stdSeg = srcCard?.rate_schedule.find(s => s.source === "standard");
        const rateParenthetical = stdSeg?.apr_pct != null ? ` (${stdSeg.apr_pct}%)` : "";
        const monthly = opt.window_months > 0 ? Math.round(opt.interest_saved / opt.window_months) : 0;

        return (
          <div key={i} className="glass-card rounded-2xl p-4">
            <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
              Moving {fmtMoney(opt.transferable, hide)} from {opt.source_name}{rateParenthetical} to{" "}
              {opt.destination_name}&apos;s offer: {fmtMoney(opt.fee, hide)} fee once instead of ~
              {fmtMoney(monthly, hide)} interest a month.
              {opt.break_even_weeks != null && ` Break-even in ${opt.break_even_weeks} weeks.`}
            </p>
            {opt.assumptions.length > 0 && (
              <p className="text-[12px] text-slate-500 dark:text-slate-400 italic mt-2">
                {opt.assumptions.join(" · ")}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DebtPlanPage() {
  const router = useRouter();
  const { hideNetWorth } = usePreferences();

  // ALL state hooks before any conditional logic
  const [plan, setPlan] = useState<DebtPlanView | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [cardTermsCards, setCardTermsCards] = useState<CardTermsCard[]>([]);
  const [cardTermsReady, setCardTermsReady] = useState(false);
  const [cardTermsOpen, setCardTermsOpen] = useState(false);
  const [cardTermsStartId, setCardTermsStartId] = useState<string | null>(null);

  const loadPlan = useCallback(async () => {
    try {
      const data = await api.getDebtPlanView();
      setPlan(data);
    } catch {
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCardTerms = useCallback(() => {
    api.getCardTerms()
      .then(r => { setCardTermsCards(r.cards); setCardTermsReady(true); })
      .catch(() => setCardTermsReady(true));
  }, []);

  useEffect(() => { loadPlan(); }, [loadPlan]);
  useEffect(() => { loadCardTerms(); }, [loadCardTerms]);

  function openSheet(accountId: string | null) {
    setCardTermsStartId(accountId);
    setCardTermsOpen(true);
  }

  function handleSaved() {
    loadCardTerms();
    loadPlan();
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const showMissingRates = plan != null && plan.cards.some(c => c.flags.terms_missing && c.debt > 0);
  const showTwoTrajectory = plan != null &&
    !("note" in plan.scenario_b) &&
    "months_sooner" in plan.scenario_b &&
    (plan.scenario_b.months_sooner > 0 || plan.scenario_b.interest_saved >= 1);
  const showTransferRoutes = (plan?.refinance_options?.length ?? 0) > 0;

  // Sequential rise-in indices over visible sections (computed once, stable)
  let riseIdx = 1; // verdict always 1
  const riseVerdictIdx = riseIdx++;
  const riseMissingRatesIdx = showMissingRates ? riseIdx++ : 0;
  const riseTwoTrajectoryIdx = showTwoTrajectory ? riseIdx++ : 0;
  const riseCardRowsIdx = riseIdx++;
  const riseTransferRoutesIdx = showTransferRoutes ? riseIdx++ : 0;

  return (
    <div className="min-h-dvh pb-36 lg:pb-8">
      <div className="px-4 pt-6 pb-2 max-w-2xl mx-auto">
        {/* Back nav */}
        <div className="rise-in" style={{ "--rise-index": 0 } as React.CSSProperties}>
          <button
            onClick={() => goBack(router)}
            className="flex items-center gap-1.5 text-sm font-medium text-slate-500 dark:text-slate-400 active:opacity-70 transition-[transform,opacity] mb-5"
          >
            <ChevronLeft size={15} />
            Back
          </button>
        </div>

        {loading ? (
          <div className="space-y-4">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : fetchError || !plan ? (
          <div className="rise-in glass-card rounded-2xl p-5" style={{ "--rise-index": 1 } as React.CSSProperties}>
            <p className="text-sm text-slate-700 dark:text-slate-200">
              The plan couldn&apos;t load — pull back and try again.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Verdict — always visible */}
            <div className="rise-in" style={{ "--rise-index": riseVerdictIdx } as React.CSSProperties}>
              <VerdictBlock plan={plan} hide={hideNetWorth} />
            </div>

            {/* Missing-rates callout */}
            {showMissingRates && (
              <div className="rise-in" style={{ "--rise-index": riseMissingRatesIdx } as React.CSSProperties}>
                <MissingRatesCallout
                  plan={plan}
                  onAddRates={() => openSheet(null)}
                />
              </div>
            )}

            {/* Two-trajectory block */}
            {showTwoTrajectory && (
              <div className="rise-in" style={{ "--rise-index": riseTwoTrajectoryIdx } as React.CSSProperties}>
                <TwoTrajectoryBlock plan={plan} hide={hideNetWorth} />
              </div>
            )}

            {/* Per-card rows — always visible */}
            <div className="rise-in" style={{ "--rise-index": riseCardRowsIdx } as React.CSSProperties}>
              <CardRows
                cards={plan.cards}
                hide={hideNetWorth}
                onOpenSheet={openSheet}
              />
            </div>

            {/* Transfer routes */}
            {showTransferRoutes && (
              <div className="rise-in" style={{ "--rise-index": riseTransferRoutesIdx } as React.CSSProperties}>
                <TransferRoutes plan={plan} hide={hideNetWorth} />
              </div>
            )}
          </div>
        )}
      </div>

      <BottomNav />

      {cardTermsOpen && (
        <CardTermsSheet
          cards={cardTermsCards}
          ready={cardTermsReady}
          startAccountId={cardTermsStartId}
          onClose={() => { setCardTermsOpen(false); setCardTermsStartId(null); }}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
