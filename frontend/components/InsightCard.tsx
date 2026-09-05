"use client";

// InsightCard and everything it needs — moved out of the retired
// app/insights/InsightsPage.tsx (2026-09-05, the Insights page redirects to
// /spend/shape or /tax now; tips live in category sublines and on the
// transactions page, see DESIGN.md's 2026-09-05 note). This file is now the
// single home for the tip-card anatomy: the full InsightCard, its
// compact/quiet-state row (CompactInsightRow via isCompactPullInsight), the
// workflow personalisation drawer it opens, and InsightsHero (the retired
// page's own hero, kept only because the standing design twin at
// app/design/insights-live/InsightsLiveClient.tsx still renders it against
// fixtures — nothing on the real app renders InsightsHero any more,
// MoneyShapeHero replaced it there 2026-09-02).
//
// Every comment below is carried over verbatim from InsightsPage.tsx; only
// cross-file references were updated where they pointed at that file itself.

import { useState, useCallback, useRef, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Bookmark, BookmarkCheck, ChevronDown, ChevronRight, CheckCircle2, Circle,
  RotateCcw, ExternalLink, SlidersHorizontal, X, RefreshCw, PartyPopper,
} from "lucide-react";
import { api, SavingsInsight, WorkflowDef, WorkflowStep } from "@/lib/api";
import { insightCategoryIcon } from "@/lib/insightIcons";
import PennyMark from "@/components/PennyMark";
import { useSheetA11y } from "@/lib/useSheetA11y";
import { useSheetOpen } from "@/lib/useSheetOpen";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import MoneyText from "@/components/MoneyText";

const CATEGORY_LINKS: Record<string, { label: string; url: string }[]> = {
  // All URLs verified live 5 Jul 2026 — re-check when touching this map
  energy:        [{ label: "uSwitch", url: "https://www.uswitch.com/gas-electricity/" }, { label: "MSE Utilities", url: "https://www.moneysavingexpert.com/utilities/" }],
  mortgage:      [{ label: "Habito", url: "https://www.habito.com" }, { label: "MSE Mortgages", url: "https://www.moneysavingexpert.com/mortgages/best-buys/" }],
  car_finance:   [{ label: "MoneySuperMarket", url: "https://www.moneysupermarket.com/car-finance/" }, { label: "MSE Car Finance", url: "https://www.moneysavingexpert.com/car-finance/" }],
  car_insurance: [{ label: "Compare the Market", url: "https://www.comparethemarket.com/car-insurance/" }, { label: "GoCompare", url: "https://www.gocompare.com/car-insurance/" }],
  broadband:     [{ label: "uSwitch", url: "https://www.uswitch.com/broadband/" }, { label: "MoneySuperMarket", url: "https://www.moneysupermarket.com/broadband/" }],
  mobile:        [{ label: "uSwitch", url: "https://www.uswitch.com/mobiles/" }, { label: "MoneySuperMarket", url: "https://www.moneysupermarket.com/mobile-phones/" }],
  groceries:     [{ label: "Trolley.co.uk", url: "https://trolley.co.uk" }, { label: "MSE Supermarket Tips", url: "https://www.moneysavingexpert.com/shopping/cheap-supermarket-shopping/" }],
  eating_out:    [{ label: "VoucherCodes", url: "https://www.vouchercodes.co.uk/restaurants" }, { label: "Tastecard", url: "https://www.tastecard.co.uk" }],
  gym:           [{ label: "Hussle", url: "https://www.hussle.com" }, { label: "ClassPass UK", url: "https://classpass.com/uk" }],
  subscriptions: [{ label: "MSE Deals", url: "https://www.moneysavingexpert.com/deals/" }, { label: "Which?", url: "https://www.which.co.uk" }],
};

// In-app primary action label per category ("See your X ›" → insight.app_route)
const APP_ROUTE_LABELS: Record<string, string> = {
  subscriptions: "See your subscriptions",
  energy:        "See your energy bills",
  groceries:     "See your grocery spend",
  eating_out:    "See your eating-out spend",
  mobile:        "See your mobile bills",
  broadband:     "See your broadband bills",
  gym:           "See your gym payments",
  car_finance:   "See your car payments",
  car_insurance: "See your insurance payments",
  insurance:     "See your insurance payments",
  mortgage:      "See your mortgage payments",
  water:         "See your water bills",
};

// Standard category chip: small rounded tile, subtle tint, lucide icon
function CategoryChip({ category, label }: { category: string; label: string }) {
  const Icon = insightCategoryIcon(category);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-6 h-6 rounded-lg bg-indigo-50 dark:bg-indigo-500/15 flex items-center justify-center flex-shrink-0">
        <Icon size={15} className="text-indigo-500 dark:text-indigo-400" />
      </span>
      <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">{label}</span>
    </span>
  );
}

// Compact-row eligibility (Insights honesty review, Package D — "but now I
// have these empty cards", owner phone feedback 2026-08-31), generalised by
// the OWNER DECISION (2026-09-01, reversing the live "Find me alternatives"
// pull model on cost grounds): every category is weekly-push with a
// displayed TTL now (see CATEGORY_LIFECYCLE / content_valid_until in
// savings_insights.py), so a card between weekly refreshes — expired, or
// never yet researched — has nothing left to say: chip, deterministic
// figure, a workflow button, an evidence footer, and no actual content in
// between. This is the NORMAL between-refreshes state for every category
// now, not a first-run/pull-only edge case. Shared between InsightCard
// (which decides its own render) and the tip lists that use it, so they
// never disagree about which state a given insight is in.
//
// STRUCTURAL FIX (owner phone report 2026-09-01, incoherence B: car_finance
// rendering as a hollow full card while groceries/gym/subscriptions — the
// same untapped state — correctly rendered compact): this used to
// re-derive "nothing furnished yet" from FIVE separate boolean fields
// (research_pull, research_fresh, verified_savings, substituted, is_new).
// Any one of them being absent/undefined instead of an explicit `false` on
// a given doc silently changed the outcome for that card only — a tri-state
// slip no single field-level fix can fully rule out. `insight.state` is
// derived server-side, once, explicitly (`_derive_insight_state` in
// savings_insights.py) and is never absent/undefined for a backend that
// sends it, so "quiet" here can't disagree with what the card's own Zone 2
// renders.
//
// `is_new` is DELIBERATELY not checked here any more (owner phone report
// 2026-09-01, the follow-up bug this same day: "whenever you do your fix
// the ones that didn't have content now have content and the one that did
// didn't ... should we render a card if there is no content" — answer: no,
// never, no override). It used to short-circuit straight to "not compact"
// before `state` was even consulted, so a doc whose `is_new` flag hadn't
// yet been reset by the next refresh pass (or a serve-time content-
// stripping pass that emptied title/body AFTER the flag was set) rendered a
// full card with nothing in it. `state` alone is the single source of
// truth for compact vs. full now — the backend's own invariant guarantees
// `state === "fresh"` never occurs without real content (see
// `_derive_insight_state` / `_serialize_insight` in savings_insights.py), so
// there is nothing left for `is_new` to safely override. A brand-new,
// still-contentless insight stays compact; it gets a subtle "New"
// affordance on its own row instead (see CompactInsightRow) rather than a
// full card it can't back up. `insight.state` is required on the wire now
// (the pre-state-machine boolean fields it used to fall back to,
// research_pull/research_fresh, are retired alongside the live research
// pull) — an older backend that somehow omits `state` renders every card
// full rather than guessing at a compact row from fields that no longer
// exist.
export function isCompactPullInsight(insight: SavingsInsight): boolean {
  return insight.state === "quiet";
}

// ── Compact Insight Row (quiet/expired, nothing furnished right now) ───────
// Ledger grammar, not card-in-card: icon chip, category name, the
// deterministic figure straight from the user's own transactions, a
// chevron. 44px tap target, plain disclosure (no reveal-animation
// theatre) — tapping hands rendering to the full InsightCard anatomy in
// place, same pattern the accordions elsewhere on this page already use
// (chevron rotates, content simply appears, no transition on the reveal).
export function CompactInsightRow({
  insight,
  onExpand,
}: {
  insight: SavingsInsight;
  onExpand: () => void;
}) {
  const Icon = insightCategoryIcon(insight.category);
  const total = insight.triggered_by.reduce((sum, t) => sum + (t.monthly_amount || 0), 0);
  const placeCount = insight.triggered_by.length;

  return (
    <button
      id={`insight-card-${insight.id}`}
      onClick={onExpand}
      aria-expanded={false}
      className="w-full min-h-[44px] px-3 py-2 flex items-center gap-2.5 rounded-2xl glass-card scroll-mt-24 text-left active:scale-[0.99] transition-transform motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <span className="w-7 h-7 rounded-lg bg-indigo-50 dark:bg-indigo-500/15 flex items-center justify-center flex-shrink-0">
        <Icon size={15} className="text-indigo-500 dark:text-indigo-400" />
      </span>
      <span className="text-[13px] font-semibold text-slate-700 dark:text-slate-300 flex-1 min-w-0 truncate">
        {insight.label}
      </span>
      {/* Subtle "new" affordance (owner phone report 2026-09-01: a
          contentless new insight is still quiet, but it's fair to draw the
          eye to it without earning the full card's real estate — see
          isCompactPullInsight above). A bare dot, not the full card's
          "New" chip: this row has nothing furnished yet to justify more. */}
      {insight.is_new && (
        <span
          className="w-1.5 h-1.5 rounded-full bg-indigo-500 dark:bg-indigo-400 flex-shrink-0"
          aria-label="New"
        />
      )}
      {placeCount > 0 && (
        <span className="text-[12px] font-mono tabular-nums text-slate-500 dark:text-slate-400 flex-shrink-0">
          ~£{Math.round(total).toLocaleString("en-GB")}/mo · {placeCount} place{placeCount !== 1 ? "s" : ""}
        </span>
      )}
      <ChevronDown size={14} className="text-slate-400 dark:text-slate-500 flex-shrink-0" aria-hidden="true" />
    </button>
  );
}

// ── Insight Body (truncated with "more" toggle) ───────────────────────────────

// Placeholder swapped in for a decimal point ("4.47", "£17.99") before
// sentence-splitting below, so the splitter can never mistake a decimal for
// a sentence terminator. The bug this guards against: the raw split regex
// treats every "." as a sentence end, so "4.47%" was tokenised into "4."
// and "47%" and rejoined with `.join(" ")`, producing "4. 47%" in the
// rendered preview even though the API response text was clean. Uses a
// control character that can never appear in normal copy, restored to "."
// immediately after splitting.
const _DECIMAL_PLACEHOLDER = "\0";

function InsightBody({ body }: { body: string }) {
  const [expanded, setExpanded] = useState(false);
  // Split on sentence endings; keep first 2 sentences as the visible preview.
  // Decimal points (digit.digit) are protected first so "4.47%" survives as
  // one token instead of being split into "4." + "47%" (see
  // _DECIMAL_PLACEHOLDER above).
  const protectedBody = body.replace(/(\d)\.(\d)/g, `$1${_DECIMAL_PLACEHOLDER}$2`);
  const restoreDecimals = (s: string) => s.replace(new RegExp(_DECIMAL_PLACEHOLDER, "g"), ".");
  const sentences = (protectedBody.match(/[^.!?]+[.!?]+/g) ?? [protectedBody]).map(restoreDecimals);
  const preview = sentences.slice(0, 2).join(" ").trim();
  const rest = sentences.slice(2).join(" ").trim();
  const hasMore = rest.length > 0;

  return (
    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed text-pretty">
      <MoneyText text={preview} />
      {hasMore && !expanded && (
        <>
          {" "}
          <button
            onClick={() => setExpanded(true)}
            className="text-[11px] font-medium text-indigo-500 dark:text-indigo-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            more
          </button>
        </>
      )}
      {hasMore && expanded && (
        <>
          {" "}
          <MoneyText text={rest} />
          {" "}
          <button
            onClick={() => setExpanded(false)}
            className="text-[11px] font-medium text-indigo-500 dark:text-indigo-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            less
          </button>
        </>
      )}
    </p>
  );
}

// ResearchTap (the live "Find me alternatives" pull) is retired — owner
// decision 2026-09-01: every category is researched weekly by the app now,
// with a displayed TTL per entry (see `expiry_line` in the Zone 2 render
// below). A quiet/expired card between refreshes has no tap affordance any
// more — see CompactInsightRow, the compact row IS the between-refreshes
// state now.

// ── Workflow Drawer (personalisation questions) ───────────────────────────

function WorkflowDrawer({
  insight,
  workflow,
  onClose,
  onSaved,
}: {
  insight: SavingsInsight;
  workflow: WorkflowDef;
  onClose: () => void;
  onSaved: () => void;
}) {
  useLockBodyScroll();
  useSheetOpen();
  const titleId = useId();
  const stepLabelId = useId();
  const drawerRef = useSheetA11y<HTMLDivElement>(onClose);
  const initial: Record<string, string> = {};
  for (const s of workflow.steps) initial[s.id] = insight.user_context?.[s.id] ?? "";
  // Don't ask what the app already knows: the triggering merchant answers
  // "which gym?" (and friends) before the user types anything
  const topTrigger = insight.triggered_by?.[0];
  if (topTrigger && !initial["gym_name"] && workflow.steps.some(st => st.id === "gym_name")) {
    initial["gym_name"] = topTrigger.display_name;
  }
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalSteps = workflow.steps.length;
  const currentStep = workflow.steps[step];

  function set(id: string, val: string) {
    setValues(prev => ({ ...prev, [id]: val }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.saveInsightContext(insight.id, values);
      setDone(true);
      setTimeout(() => { onClose(); onSaved(); }, 1500);
    } catch {
      setSaving(false);
      setError("Couldn't save your answers, try again in a moment.");
    }
  }

  function renderInput(s: WorkflowStep, labelId?: string) {
    if (s.type === "select" && s.options) {
      return (
        <div className="flex flex-col gap-2" role="group" aria-labelledby={labelId}>
          {s.options.map(opt => (
            <button
              key={opt}
              onClick={() => set(s.id, opt)}
              className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-[transform,background-color,color,border-color] duration-150 active:scale-[0.98] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                values[s.id] === opt
                  ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800 font-medium"
                  : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      );
    }
    return (
      <div className="relative">
        {s.type === "currency" && (
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-base font-medium">£</span>
        )}
        <input
          type={s.type === "text" ? "text" : "number"}
          inputMode={s.type === "text" ? "text" : "decimal"}
          value={values[s.id]}
          onChange={e => set(s.id, e.target.value)}
          placeholder={s.placeholder ?? ""}
          aria-labelledby={labelId}
          className={`w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-base text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${s.type === "currency" ? "pl-8" : ""}`}
        />
        {s.unit && (
          <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">{s.unit}</span>
        )}
      </div>
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="glass-sheet rounded-t-3xl max-h-[90dvh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-slate-200 dark:bg-slate-600" />
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-5 pt-2">
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-[11px] font-semibold text-indigo-500 flex items-center gap-1.5">
                {(() => {
                  const HeaderIcon = insightCategoryIcon(insight.category);
                  return <HeaderIcon size={13} className="flex-shrink-0" />;
                })()}
                {insight.label}
              </p>
              <h2 id={titleId} className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                {done ? "Personalising your insight…" : workflow.cta}
              </h2>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-slate-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
              <X size={20} />
            </button>
          </div>

          {done ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <CheckCircle2 size={48} className="text-emerald-500" />
              <p className="text-[14px] text-slate-500 dark:text-slate-400 text-center">
                Saved, Penny is crunching your numbers.<br />
                Your personalised advice appears on this card in a moment.
              </p>
            </div>
          ) : (
            <>
              {/* What we already see — grounds the questions in their own data */}
              {topTrigger && (
                <div className="mb-4 px-3 py-2.5 rounded-xl border border-indigo-100/80 dark:border-indigo-400/20 bg-indigo-50/70 dark:bg-indigo-500/10 text-[11px] text-indigo-700 dark:text-indigo-300">
                  We can already see <span className="font-semibold font-mono tabular-nums">~£{topTrigger.monthly_amount.toLocaleString("en-GB", { maximumFractionDigits: 0 })}/mo</span> at{" "}
                  <span className="font-semibold">{topTrigger.display_name}</span>, {totalSteps <= 2 ? "just" : "only"} {totalSteps} quick {totalSteps === 1 ? "question" : "questions"} to tailor the advice to your exact deal.
                </div>
              )}

              {/* Progress */}
              <div className="flex gap-1.5 mb-5">
                {workflow.steps.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1 flex-1 rounded-full transition-all ${i <= step ? "bg-indigo-500" : "bg-slate-200 dark:bg-slate-700"}`}
                  />
                ))}
              </div>

              {/* Current step */}
              <div className="flex flex-col gap-3 pb-4">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Step {step + 1} of {totalSteps}
                </p>
                <p id={stepLabelId} className="text-base font-semibold text-slate-800 dark:text-slate-200">
                  {currentStep.label}
                </p>
                {renderInput(currentStep, stepLabelId)}
              </div>
            </>
          )}
        </div>

        {/* Navigation — fixed outside scroll area so always visible */}
        {!done && (
          <div
            className="flex-shrink-0 px-5 pt-3 pb-6 border-t border-slate-100 dark:border-slate-700/50"
            style={{ paddingBottom: "max(24px, env(safe-area-inset-bottom, 24px))" }}
          >
            <div className="flex gap-3">
              {step > 0 && (
                <button
                  onClick={() => setStep(s => s - 1)}
                  className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-slate-600 text-[14px] font-medium text-slate-600 dark:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  Back
                </button>
              )}
              {step < totalSteps - 1 ? (
                <button
                  onClick={() => setStep(s => s + 1)}
                  className="flex-1 py-3 rounded-xl bg-indigo-600 text-white text-[14px] font-semibold flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  Next <ChevronRight size={16} />
                </button>
              ) : (
                <button
                  onClick={save}
                  disabled={saving}
                  className="flex-1 py-3 rounded-xl bg-indigo-600 text-white text-[14px] font-semibold disabled:opacity-50 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  {saving ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                  {saving ? "Saving…" : "Save & Personalise"}
                </button>
              )}
            </div>
            {error && (
              <p className="flex items-start gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 mt-3">
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-[3px] bg-amber-500" aria-hidden="true" />
                <span>{error}</span>
              </p>
            )}
            {totalSteps > 1 && step < totalSteps - 1 && (
              <button
                onClick={save}
                disabled={saving}
                className="w-full text-center text-[11px] text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-40 mt-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                Save with answers so far
              </button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ── Insight Card ──────────────────────────────────────────────────────────────

// A `display_name` that started life as a short ALL-CAPS abbreviation (EE,
// BT, TFL, HSBC) can arrive here already Title-cased by the backend's own
// normalisation (`.title()` in savings_insights.py, applied to the
// lower-cased merchant key so ordinary multi-word names print correctly) —
// "ee" -> "Ee" instead of staying "EE". This is a pure display-time guard,
// not a re-derivation: any single word already in "Titlecase" shape (one
// capital letter followed only by lowercase) at 4 characters or fewer is
// re-uppercased, on the theory that at that length it reads as a bank/
// network initialism, not a genuine title-cased English word. A merchant
// like "O2" never hits this in the first place, `.title()` leaves a
// letter-then-digit token alone, so it already renders correctly.
// The backend (backend/app/routers/savings_insights.py) runs merchant
// display names through Python's `.title()` for presentation, which
// mangles real initialisms into Title Case ("Ee" for EE, "Bt" for BT,
// "Whsmith" for WHSmith). This used to be a shape heuristic
// (`/^[A-Z][a-z]{0,3}$/`, uppercasing any short Title-Case word wholesale)
// that also wrongly shouted ordinary short brand names — Sky, Lidl, Uber,
// Ikea, Zara, Nike all matched that shape and got capitalised for no
// reason. Replaced with an explicit initialism allowlist instead, compared
// case-insensitively per whitespace-separated token (so "Tk Maxx" ->
// "TK Maxx" without touching "Maxx"). The real fix belongs in the
// backend's own `.title()` call; this is a frontend patch until that
// happens.
const KNOWN_INITIALISMS: Record<string, string> = {
  EE: "EE", BT: "BT", O2: "O2", TFL: "TFL", HSBC: "HSBC", RAC: "RAC",
  AA: "AA", ASDA: "ASDA", BP: "BP", KFC: "KFC", TSB: "TSB", NHS: "NHS",
  DVLA: "DVLA", EON: "EON", OVO: "OVO", EDF: "EDF", GWR: "GWR", LNER: "LNER",
  TK: "TK", WHSMITH: "WHSmith",
};

function fixShortAllCaps(name: string): string {
  return name
    .split(" ")
    .map((token) => KNOWN_INITIALISMS[token.toUpperCase()] ?? token)
    .join(" ");
}

export function InsightCard({
  insight,
  workflow,
  onPin,
  onContextSaved,
  anyOpenHasEstimate,
  inSheet = false,
}: {
  insight: SavingsInsight;
  workflow: WorkflowDef | null;
  onPin: (id: string) => void;
  onContextSaved: () => void;
  /** Whether ANY currently-open insight (across the whole rendered list, not
   *  just this card) carries a `savings_estimate_monthly` — mirrors the
   *  approved hero preview's `showNoEstimateLabel` gate (see
   *  /design/insights-hero InsightRow): "No number yet" only earns its
   *  place when it distinguishes costed cards from uncosted ones. When
   *  nothing anywhere has a number, the hero's own headline already says
   *  so once ("none with a number attached yet") — repeating a quiet grey
   *  label on every single card underneath would just add noise, not
   *  information, so the label is suppressed entirely in that state. */
  anyOpenHasEstimate: boolean;
  /** True only when this card renders inside a TipStrip on a category's
   *  transactions page (app/design/spend-tips/TransactionsMock.tsx, a mock
   *  of the real app/transactions/TransactionsPage.tsx), a payments
   *  drill-down that already shows the category chip (the page's own
   *  filter chip) and the transactions themselves (the page's own list).
   *  Strips the card down to the fact line, body, estimate, and age line
   *  only — the pin button, category chip, compare-site chips, workflow
   *  CTA, app_route CTA, and the "Based on N transactions" evidence footer
   *  all either duplicate something already visible on the page or are
   *  page-level actions that don't belong in a payments drill-down.
   *  Defaults false; no behaviour change for the Insights tab itself. */
  inSheet?: boolean;
}) {
  const router = useRouter();
  const [showTriggers, setShowTriggers] = useState(false);
  const [showWorkflow, setShowWorkflow] = useState(false);
  // Compact-row state (see isCompactPullInsight): starts collapsed for an
  // untapped pull category with nothing furnished to say yet; tapping the
  // row hands rendering straight to the full anatomy below, in place, with
  // no re-collapse control (session-persisted state is unnecessary — this
  // is a per-mount reveal, not a preference).
  const [compactOpen, setCompactOpen] = useState(false);
  // Engagement signal (Insights honesty review, Package A #1) — fired once
  // per card, the first time its evidence footer/workflow expands or its
  // CTA is tapped, so the copy-tier logic (server-side `verified_tier`) can
  // later tell an earned celebration from a plain fact. The ref guards
  // against re-firing the network call on every toggle within one page
  // visit; the backend itself is also idempotent (first-write-wins), so a
  // duplicate call from a remount is harmless either way.
  const openedFiredRef = useRef(false);
  const markOpened = useCallback(() => {
    if (openedFiredRef.current) return;
    openedFiredRef.current = true;
    api.markInsightOpened(insight.id).catch(() => {});
  }, [insight.id]);
  // The user's own figure — leads the card (verdict first, then the web copy)
  const topTrigger = insight.triggered_by[0] ?? null;
  const extraTriggers = insight.triggered_by.length - 1;
  // The generated title below sums every trigger (see facts_block in
  // savings_insights.py), so with more than one trigger the lead must sum
  // too — a single merchant's figure next to a total-across-merchants title
  // is the exact "internal number contradiction" this card was flagged for.
  // triggered_by is capped at 4 server-side (_find_triggered_transactions),
  // the same set the title's prompt sees, so this total always reconciles
  // with every row the "Based on N transactions" disclosure below lists.
  const triggerTotal = insight.triggered_by.reduce((sum, t) => sum + (t.monthly_amount || 0), 0);
  // Real transaction count (sum of each row's own ×-count) vs place count
  // (triggered_by.length, one row per merchant) — see the "Based on N
  // transactions" disclosure below, which used to conflate the two.
  const txnCount   = insight.triggered_by.reduce((sum, t) => sum + (t.occurrences || 0), 0);
  const placeCount = insight.triggered_by.length;
  // Zone 2 state (STRUCTURAL FIX — switches on `insight.state`, the single
  // server-derived source of truth; see `isCompactPullInsight` above for why
  // the old combination-of-booleans approach was the root cause of
  // incoherence B). `contentLive` gates the researched title/body/
  // savings_estimate/expiry_line — anything else (verified, substituted, or
  // "quiet") renders nothing here (OWNER RULING 2026-09-02: no content, no
  // furniture, not even a resolved-state placeholder or a "between
  // refreshes" caption). "quiet" is only reachable here at all when a
  // compact row has been manually expanded (isCompactPullInsight, above).
  const contentLive = insight.state === "fresh";
  // Resolved = verified or substituted — Zone 1's banner already states the
  // fact permanently (see `_derive_insight_state`'s first-write-wins
  // precedence: once resolved, a doc never returns to "fresh" on its own).
  // Used below to hide the workflow CTA on a resolved card (OWNER RULING
  // 2026-09-02 item 4 — traced: the CTA's submission feeds `user_context`
  // into the NEXT research generation pass, but a resolved doc's `state`
  // can't go back to "fresh" from user_context alone, so that research is
  // never shown on THIS card. A furniture item that provably can't affect
  // what the user ever sees again doesn't earn a place under a resolved
  // banner).
  const isResolved = insight.state === "verified" || insight.state === "substituted";

  // Nothing furnished yet (Insights honesty review, Package D): a pull
  // category with no fresh research and no verified/substituted banner is
  // a ledger row, not a card, until the user asks for more. See
  // isCompactPullInsight for the full eligibility rule.
  if (isCompactPullInsight(insight) && !compactOpen) {
    return <CompactInsightRow insight={insight} onExpand={() => setCompactOpen(true)} />;
  }

  return (
    <>
      <div
        id={`insight-card-${insight.id}`}
        className="glass-card rounded-2xl overflow-hidden scroll-mt-24 transition-shadow"
      >
        {/* ── Zone 1: deterministic — the user's own bank data. Never
            expires, never carries a research stamp; this is fact, not
            research. ── */}
        <div className="p-4 flex flex-col gap-3">
          {/* Category + badges + pin — hidden inSheet: the sheet's own
              header already carries the category identity, and pinning is
              a page-level action, not a payments drill-down one. */}
          {!inSheet && (
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <CategoryChip category={insight.category} label={insight.label} />

                {insight.is_new && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 flex items-center gap-1">
                    <PennyMark size={10} /> New
                  </span>
                )}
              </div>
              <button
                onClick={() => onPin(insight.id)}
                className="relative before:absolute before:-inset-2.5 before:content-[''] flex-shrink-0 p-1.5 rounded-xl text-slate-400 hover:text-indigo-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                {insight.pinned ? <BookmarkCheck size={18} className="text-indigo-500" /> : <Bookmark size={18} />}
              </button>
            </div>
          )}

          {/* Closure: the loop actually closed — celebrate. Copy is server-
              composed and already tier-aware (verified_savings_line is the
              honest "fact" sentence unless verified_tier is "earned" — see
              _verified_copy_tier in savings_insights.py), so this renders
              verbatim with no client-side "You did it" fallback that could
              disagree with the tier the backend actually earned. Deterministic
              (a bank-confirmed cessation), so it belongs in Zone 1, not the
              researched Zone 2 below. */}
          {(insight.state ? insight.state === "verified" : !!insight.verified_savings) ? (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-900/25 border border-emerald-200 dark:border-emerald-800">
              <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-emerald-800 dark:text-emerald-300 leading-snug">
                {insight.verified_savings_line}
              </p>
            </div>
          ) : (insight.state ? insight.state === "substituted" : !!insight.substituted) ? (
            /* Neutral, not celebratory — the merchant went silent but the
               whole category didn't net down (see `substituted` on
               SavingsInsight), so this is honestly NOT a saving. Slate, no
               green, no checkmark. */
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600">
              <RotateCcw size={16} className="text-slate-500 dark:text-slate-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-snug">
                {insight.substituted_line}
              </p>
            </div>
          ) : null}

          {/* The user's own figure — the card's verdict, straight from their
              transactions. With more than one trigger this is the summed
              total (see triggerTotal comment above). */}
          {topTrigger && (
            <p className="text-base font-bold text-slate-900 dark:text-slate-100 leading-snug">
              {extraTriggers > 0 ? (
                <>
                  <span className="font-mono tabular-nums">~£{triggerTotal.toLocaleString("en-GB", { maximumFractionDigits: 0 })}/mo</span>{" "}
                  <span className="font-medium">across {insight.triggered_by.length} places</span>{" "}
                </>
              ) : (
                <>
                  <span className="font-mono tabular-nums">~£{topTrigger.monthly_amount.toLocaleString("en-GB", { maximumFractionDigits: 0 })}/mo</span>{" "}
                  <span className="font-medium">at {fixShortAllCaps(topTrigger.display_name)}</span>{" "}
                </>
              )}
              <span className="text-xs font-normal text-slate-500 dark:text-slate-400">· from your transactions</span>
            </p>
          )}

          {/* Primary action — the user's own data, in-app. Hidden inSheet:
              this leads to the same transactions the sheet's own Payments
              list already shows. */}
          {!inSheet && insight.app_route && (
            <button
              onClick={() => { markOpened(); router.push(insight.app_route!); }}
              className="self-start inline-flex items-center gap-0.5 py-3 -my-1.5 text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 active:scale-95 transition-all motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              {APP_ROUTE_LABELS[insight.category] ?? "See it in your spending"}
              <ChevronRight size={15} />
            </button>
          )}
        </div>

        {/* ── Zone 2: researched — web search + LLM. Only as current as its
            own stamp; hairline-separated, quieter surface so it never reads
            as bank-fact. Switches on `insight.state`: "fresh"
            (title/body/estimate + the expiry indicator, every category
            alike now — see `expiry_line`), "verified"/"substituted"
            (resolved in Zone 1 above, nothing to add here), or "quiet"
            (between weekly refreshes — a honest "refreshes weekly" line,
            reachable here only when an expanded compact row shows the full
            anatomy with nothing furnished right now). ── */}
        <div className="px-4 py-3.5 flex flex-col gap-2.5 border-t border-slate-100 dark:border-slate-700/70 bg-slate-50/70 dark:bg-slate-800/40">
          {contentLive ? (
            <>
              {/* Generic title — demoted beneath the personal figure (leads
                  only when Zone 1 had no trigger figure of its own) */}
              {insight.title && (
                <p
                  className={
                    topTrigger
                      ? "text-sm text-slate-600 dark:text-slate-300 leading-snug [text-wrap:balance]"
                      : "text-base font-bold text-slate-900 dark:text-slate-100 leading-snug [text-wrap:balance]"
                  }
                >
                  <MoneyText text={insight.title} />
                </p>
              )}

              {/* Body — truncated to ~2 sentences with a "more" toggle */}
              {insight.body && <InsightBody body={insight.body} />}

              {/* Estimate line — gated on `savings_estimate_monthly != null`, the
                  exact same condition the hero above uses for its coverage
                  counters (heroOpenWithEstimate). Gating this pill on the raw
                  `savings_estimate` STRING instead used to disagree with the
                  hero: the backend allows a hedge string that carries no
                  parseable `£` figure (_savings_estimate_is_derivable / the
                  locked-in "reduce your outgoings soon" -> null case in
                  test_serialize_insight_estimate.py), which is truthy as a
                  string but null as a number — the card would show the costed
                  treatment for an insight the hero was counting as "no number".
                  A hedge string with no parsed figure still renders, but as
                  plain prose (no mono/tabular money styling, no "estimated
                  saving" label) so it's visibly NOT a costed figure, and it
                  does not count as `anyOpenHasEstimate` either. Verified cards
                  skip this entirely, the Zone 1 emerald banner above already
                  carries the real (not estimated) figure. */}
              {!insight.verified_savings && !insight.substituted && insight.savings_estimate_monthly != null ? (
                <p className="text-[12px] font-mono tabular-nums text-slate-500 dark:text-slate-400 italic">
                  <MoneyText text={insight.savings_estimate ?? ""} />{" "}
                  <span className="not-italic font-sans font-medium">estimated saving</span>
                </p>
              ) : !insight.verified_savings && !insight.substituted && insight.savings_estimate ? (
                <p className="text-[12px] text-slate-500 dark:text-slate-400 italic">
                  <MoneyText text={insight.savings_estimate} />
                </p>
              ) : !insight.verified_savings && !insight.substituted && anyOpenHasEstimate ? (
                <p className="text-[11px] text-slate-400 dark:text-slate-500">No number yet</p>
              ) : null}

              {/* Age/deadline stamp — always shown while content is live
                  (Insights honesty review, Package A #4; OWNER RULING
                  2026-09-02: internal refresh scheduling is never narrated
                  to the user, so this carries no "weekly"/"refreshes"
                  wording any more): server-composed, house-style-consistent
                  sentence (same pattern as verified_savings_line/
                  substituted_line) — "Valid until Mon 8 Sep" for a real,
                  dated offer (a fact about the offer), else "Researched 2d
                  ago" for generic content on the default TTL (honesty about
                  how current the content shown actually is). Render
                  verbatim, never re-derive the wording client-side. */}
              {insight.expiry_line && (
                <span className="text-[11px] text-slate-400 dark:text-slate-500 self-end">
                  {insight.expiry_line}
                </span>
              )}

              {/* Comparison sites — secondary, quiet. Hidden inSheet, a
                  page-level action, not part of a payments drill-down. */}
              {!inSheet && CATEGORY_LINKS[insight.category] && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">Compare:</span>
                  {CATEGORY_LINKS[insight.category].map(link => (
                    <a
                      key={link.url}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="relative before:absolute before:-inset-y-2.5 before:-inset-x-0.5 before:content-[''] inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400 bg-slate-100/80 dark:bg-slate-700/60 px-2 py-1 rounded-full hover:bg-slate-200 dark:hover:bg-slate-600 active:scale-95 transition-all motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      <ExternalLink size={10} />
                      {link.label}
                    </a>
                  ))}
                </div>
              )}
            </>
          ) : (
            /* "quiet" (or any other non-furnished state) renders NOTHING
               here — OWNER RULING (2026-09-02, verbatim: "what's the point
               of these cards if there is nothing, and we shouldn't show the
               cadence of the refresh"). This closes the third compact
               regression: a prior version of this branch rendered a
               "Refreshes weekly..." caption unconditionally, and that
               caption text itself was enough to make an otherwise-hollow
               card LOOK furnished — the exact failure mode the invariant
               below exists to rule out. Nothing survives on an unfurnished
               card, not even a neutral placeholder sentence; the compact
               row (isCompactPullInsight, above) is the only normal way to
               reach this state at all, so this branch is reachable only via
               a manually-expanded compact row (Zone 1's figure + the
               workflow CTA below are still shown) or a future/unknown state
               value this component doesn't yet special-case — either way,
               Zone 2 correctly has nothing to say. Covers verified/
               substituted too (Zone 1's banner already stated the resolved
               fact; Zone 2 has no second job for those states either). */
            null
          )}

          {/* CTA — workflow. Shown on "fresh"/"quiet" (real personalisation
              input, feeding the exact same `user_context` the weekly cron's
              generation pass reads — see CATEGORY_WORKFLOWS in
              savings_insights.py — not a decorative dead end), hidden once
              `isResolved` (OWNER RULING 2026-09-02 item 4): a resolved
              doc's `state` never returns to "fresh" (see the comment on
              `isResolved` above), so a workflow submission here can never
              surface on this card again — the CTA would be a dead end
              exactly like the caption text this same ruling deleted above,
              just one furniture item later. */}
          {!inSheet && workflow && !isResolved && (
            <button
              onClick={() => { setShowWorkflow(true); markOpened(); }}
              className="w-full py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-transparent hover:bg-slate-100 dark:hover:bg-slate-700/50 active:scale-[0.98] text-slate-600 dark:text-slate-300 text-sm font-medium flex items-center justify-center gap-2 transition-all motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <SlidersHorizontal size={14} />
              {insight.user_context ? "Improve this tip" : workflow.cta}
            </button>
          )}
        </div>

        {/* Triggered by — collapsible, the deterministic evidence footer.
            Hidden inSheet: this is a per-merchant breakdown of the same
            transactions the sheet's own Payments list already shows in
            full. */}
        {!inSheet && insight.triggered_by.length > 0 && (
          <div className="border-t border-slate-100 dark:border-slate-700">
            <button
              onClick={() => { setShowTriggers(v => !v); markOpened(); }}
              className="w-full px-4 py-2.5 flex items-center justify-between text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              aria-expanded={showTriggers}
            >
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {/* triggered_by is grouped by merchant (see
                    _find_triggered_transactions), so its own length is a
                    place count, not a transaction count — "Eating Out"
                    with 4 merchant rows whose ×-counts sum to 11 real
                    transactions used to render as "4 transactions", which
                    disagreed with the ×-counts one tap away. `txnCount`
                    sums the real per-row occurrence counts; `placeCount`
                    is the merchant/place count triggered_by.length always
                    was. */}
                Based on {txnCount} transaction{txnCount !== 1 ? "s" : ""}
                {placeCount > 1 ? ` across ${placeCount} places` : ""}
              </span>
              <ChevronDown size={14} className={`text-slate-500 dark:text-slate-400 transition-transform duration-200 motion-reduce:transition-none ${showTriggers ? "rotate-180" : ""}`} />
            </button>
            {showTriggers && (
              <div className="px-4 pb-3 space-y-1.5">
                {insight.triggered_by.map(t => (
                  <div key={t.merchant_key} className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-600 dark:text-slate-300 truncate max-w-[65%]">{fixShortAllCaps(t.display_name)}</span>
                    {/* is_recurring: exact engine figure, matches the card's
                        own title/body — no hedge. Missing/false: a plain
                        window average over ad-hoc spend — hedge it like
                        every other estimate in this product. */}
                    <span className="text-slate-500 dark:text-slate-400"><span className="font-mono tabular-nums">{t.is_recurring ? "" : "~"}£{t.monthly_amount.toFixed(2)}/mo</span> · {t.occurrences}×</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {showWorkflow && workflow && (
        <WorkflowDrawer
          insight={insight}
          workflow={workflow}
          onClose={() => setShowWorkflow(false)}
          onSaved={() => { setShowWorkflow(false); onContextSaved(); setTimeout(onContextSaved, 25000); }}
        />
      )}
    </>
  );
}

// ── Insights Hero (retired from the real page 2026-09-02, MoneyShapeHero
// replaced it there — kept here only because the standing design twin,
// app/design/insights-live/InsightsLiveClient.tsx, still renders it against
// fixtures) ─────────────────────────────────────────────────────────────
// Ported from the approved /design/insights-hero preview (Variant B,
// "Opportunity leads" — see that file for the full four-state rationale).

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
      {children}
    </p>
  );
}

function RateFigure({ figure }: { figure: string }) {
  return (
    <p className="mt-1 flex items-baseline gap-1.5">
      <span className="text-[30px] leading-tight font-bold tracking-tight font-mono tabular-nums text-slate-900 dark:text-slate-100">
        {figure}
      </span>
      <span className="text-[14px] font-medium text-slate-400 dark:text-slate-500">/mo</span>
    </p>
  );
}

// The earned verified-savings chip — present in every hero state. `hero`
// widens it for the "nothing open" state, where it's the only real number
// left on the card and needs to read as the payoff, not a footnote.
function VerifiedChip({
  verified,
  hero,
  trailingLabel,
}: {
  verified: number;
  hero?: boolean;
  trailingLabel?: string;
}) {
  if (verified > 0) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-500/15 ${
          hero ? "min-h-[40px] pl-3 pr-4 py-2" : "min-h-[32px] pl-2.5 pr-3 py-1.5"
        }`}
      >
        <CheckCircle2
          size={hero ? 18 : 14}
          className="text-emerald-600 dark:text-emerald-400 flex-shrink-0"
          aria-hidden
        />
        <span
          className={`font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-300 ${
            hero ? "text-[16px]" : "text-[12px]"
          }`}
        >
          £{verified.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
        <span className={`font-medium text-emerald-700 dark:text-emerald-300 ${hero ? "text-[13px]" : "text-[12px]"}`}>
          {trailingLabel ?? "already banked"}
        </span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 min-h-[32px] rounded-full pl-2.5 pr-3 py-1.5 bg-slate-100 dark:bg-slate-700/60">
      <Circle size={14} className="text-slate-400 dark:text-slate-500 flex-shrink-0" aria-hidden />
      <span className="text-[12px] font-medium text-slate-500 dark:text-slate-400">Nothing banked yet, that&apos;s next</span>
    </span>
  );
}

function moneyEstimate(n: number): string {
  return `~£${Math.round(Math.abs(n)).toLocaleString("en-GB")}`;
}

export function InsightsHero({
  open,
  openWithEstimate,
  openMonthlySaving,
  verifiedMonthlySaving,
  insightsActedOn,
  changesNoticed,
  resolvedCount,
}: {
  open: number;
  openWithEstimate: number;
  openMonthlySaving: number;
  verifiedMonthlySaving: number;
  /** Verified wins with confirmed engagement BEFORE they verified
   *  (`verified_tier === "earned"`, see savings_insights.py's
   *  _verified_copy_tier) — the only count this product can honestly credit
   *  to the user having acted. */
  insightsActedOn: number;
  /** Verified wins with no such engagement evidence — real, provable
   *  changes (the spend genuinely stopped AND the category confirmed the
   *  drop), just not ones we can honestly say the user "acted on". Insights
   *  honesty review, Package A #3: this is the honest alternative headline
   *  when `insightsActedOn` is 0 but real change still happened. */
  changesNoticed: number;
  /** Incoherence E (owner phone report 2026-09-01: hero said "1 of 7 open
   *  ideas" while 8 cards were visible below) — the count of rendered cards
   *  that are resolved (verified + substituted) and therefore excluded from
   *  `open`, but still on the page as their own banner card. Named in the
   *  copy below so "N open" and "the cards you can count" never look like
   *  they disagree; 0 when every rendered card is still open (the common
   *  case), which adds nothing to the sentence. */
  resolvedCount: number;
}) {
  const fullCoverage = open > 0 && openWithEstimate === open;
  const partialCoverage = open > 0 && openWithEstimate > 0 && openWithEstimate < open;
  const noCoverage = open > 0 && openWithEstimate === 0;
  const nothingOpen = open === 0;
  const resolvedClause = resolvedCount > 0
    ? ` ${resolvedCount} more sorted below.`
    : "";

  return (
    <section className="glass-hero rounded-3xl p-4" data-tutorial-id="tutorial-insights-hero">
      {nothingOpen ? (
        <>
          <SectionLabel>Ways to save, all clear</SectionLabel>
          <p className="mt-1 text-[19px] leading-snug font-bold text-slate-900 dark:text-slate-100 text-pretty">
            Every idea on your list has been sorted.
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 text-pretty">
            {insightsActedOn > 0
              ? `${insightsActedOn} idea${insightsActedOn === 1 ? "" : "s"} acted on over time, nothing left open right now.`
              : changesNoticed > 0
              ? `${changesNoticed} change${changesNoticed === 1 ? "" : "s"} noticed over time, nothing left open right now.`
              : "Nothing acted on yet, nothing left open right now."}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <PartyPopper size={16} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0" aria-hidden />
            <VerifiedChip verified={verifiedMonthlySaving} hero trailingLabel="kept every month" />
          </div>
        </>
      ) : (
        <>
          <SectionLabel>
            {noCoverage ? "Open ideas, no numbers yet" : "Identified, every month · estimated"}
          </SectionLabel>

          {(fullCoverage || partialCoverage) && (
            <>
              <RateFigure figure={moneyEstimate(openMonthlySaving)} />
              <p className="mt-1 text-[12px] italic text-slate-500 dark:text-slate-400 text-pretty">
                {(fullCoverage
                  ? `Across ${open} open idea${open === 1 ? "" : "s"} below, estimated from your own spending, not yet acted on.`
                  : `Across ${openWithEstimate} of ${open} open ideas, the ones with a number so far.`) + resolvedClause}
              </p>
            </>
          )}

          {noCoverage && (
            <>
              <p className="mt-1 text-[19px] leading-snug font-bold text-slate-900 dark:text-slate-100 text-pretty">
                {open} idea{open === 1 ? "" : "s"} worth a look, none with a number attached yet.
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 text-pretty">
                {`Open the top one below, it's usually the easiest place to start.${resolvedClause}`}
              </p>
            </>
          )}

          <div className="mt-3">
            <VerifiedChip verified={verifiedMonthlySaving} />
          </div>
        </>
      )}
    </section>
  );
}
