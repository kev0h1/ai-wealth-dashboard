"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useRef, type ReactNode, useId } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Bookmark, BookmarkCheck, RefreshCw, ChevronDown, ChevronLeft, ChevronRight, SlidersHorizontal, X, Check, CheckCircle2, Circle, PartyPopper, ExternalLink, TrendingUp, Search, Tag, Lightbulb, RotateCcw } from "lucide-react";
import { api, SavingsInsight, WorkflowDef, WorkflowStep, FuelNearby } from "@/lib/api";
import { insightCategoryIcon } from "@/lib/insightIcons";
import PennyMark from "@/components/PennyMark";
import { useSheetA11y } from "@/lib/useSheetA11y";
import { useSheetOpen } from "@/lib/useSheetOpen";
import ConfirmDialog from "@/components/ConfirmDialog";
import BottomNav from "@/components/BottomNav";
import Spinner from "@/components/Spinner";
import AdviceDisclaimer from "@/components/AdviceDisclaimer";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import FuelSavingsCard from "@/components/FuelSavingsCard";
import GroceryBasketCard from "@/components/GroceryBasketCard";
import TaxPage from "@/app/insights/tax/TaxPage";
import TaxPennyEntry from "@/components/TaxPennyEntry";
import { useTutorialReady } from "@/components/TutorialContext";
import { usePreferences } from "@/components/PreferencesContext";
import { usePennySheet } from "@/components/PennySheetProvider";
import MoneyText from "@/components/MoneyText";
import MoneyShapeHero, { JobDot } from "@/app/insights/MoneyShapeHero";
import WhatWorksCard from "@/app/insights/WhatWorksCard";
import ReferenceShapesRow from "@/app/insights/ReferenceShapesRow";
import ShapeAnchorStrip from "@/app/insights/ShapeAnchorStrip";
import type { MoneyShape } from "@/lib/api";

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
// (which decides its own render) and SavingsInsightsSection (which sorts
// full/substantive cards ahead of compact rows in the list), so the two
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

// ── Unknown Bills Panel ───────────────────────────────────────────────────────

interface UnknownBill {
  merchant_key: string;
  display_name: string;
  monthly_amount: number;
  occurrences: number;
}

function UnknownBillsPanel({
  labelOptions,
  onNewInsight,
  initialBills,
  onBillLabelled,
}: {
  labelOptions: Record<string, { icon: string; label: string }>;
  onNewInsight: () => void;
  initialBills?: UnknownBill[];
  onBillLabelled?: (merchantKey: string) => void;
}) {
  const [bills, setBills] = useState<UnknownBill[]>(initialBills ?? []);
  const [loading, setLoading] = useState(initialBills === undefined);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialBills === undefined) return;
    setBills(initialBills);
    setLoading(false);
  }, [initialBills]);

  async function pick(merchantKey: string, category: string) {
    setSaving(merchantKey);
    setError(null);
    try {
      await api.labelBill(merchantKey, category);
      setBills(prev => prev.filter(b => b.merchant_key !== merchantKey));
      onBillLabelled?.(merchantKey);
      setExpanded(null);
      if (category !== "skip") {
        setTimeout(onNewInsight, 20000);
      }
    } catch {
      setError("That didn't save, try again in a moment.");
    } finally {
      setSaving(null);
    }
  }

  if (loading || bills.length === 0) return null;

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <button
        className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <div className="flex items-center gap-2.5">
          <span className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-700/60 flex items-center justify-center flex-shrink-0">
            <Search size={15} className="text-slate-500 dark:text-slate-300" />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Help us personalise your insights
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {bills.length} recurring bill{bills.length > 1 ? "s" : ""} we couldn't identify
            </p>
          </div>
        </div>
        <ChevronDown size={16} className={`flex-shrink-0 text-slate-500 dark:text-slate-400 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
      </button>

      {open && <div className="border-t border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700/60">
        {bills.map(bill => {
          const isOpen = expanded === bill.merchant_key;
          const isSaving = saving === bill.merchant_key;
          return (
            <div key={bill.merchant_key}>
              <button
                className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                onClick={() => setExpanded(isOpen ? null : bill.merchant_key)}
              >
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-slate-800 dark:text-slate-200 truncate">
                    {bill.display_name}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="font-mono tabular-nums">£{bill.monthly_amount.toFixed(2)}/mo</span> · {bill.occurrences} payments
                  </p>
                </div>
                <ChevronDown
                  size={16}
                  className={`flex-shrink-0 text-slate-500 dark:text-slate-400 transition-transform duration-200 motion-reduce:transition-none ${isOpen ? "rotate-180" : ""}`}
                />
              </button>

              {isOpen && (
                <div className="px-4 pb-4 space-y-2.5">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">What type of bill is this?</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {Object.entries(labelOptions).map(([key, opt]) => {
                      const OptIcon = insightCategoryIcon(key);
                      return (
                      <button
                        key={key}
                        disabled={isSaving}
                        onClick={() => pick(bill.merchant_key, key)}
                        className="flex flex-col items-center gap-1 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-700/60 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 active:scale-95 transition-all motion-reduce:transition-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      >
                        <OptIcon size={18} className="text-slate-500 dark:text-slate-300" />
                        <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300 leading-tight text-center">
                          {opt.label}
                        </span>
                      </button>
                      );
                    })}
                    <button
                      disabled={isSaving}
                      onClick={() => pick(bill.merchant_key, "skip")}
                      className="flex flex-col items-center gap-1 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-700/60 hover:bg-slate-100 dark:hover:bg-slate-600 active:scale-95 transition-all motion-reduce:transition-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      <X size={18} className="text-slate-400 dark:text-slate-400" />
                      <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 leading-tight text-center">
                        Skip
                      </span>
                    </button>
                  </div>
                  {isSaving && (
                    <p className="text-[11px] text-indigo-500 flex items-center gap-1.5">
                      <RefreshCw size={12} className="animate-spin" /> Generating insight…
                    </p>
                  )}
                  {error && !isSaving && (
                    <p className="flex items-start gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-[3px] bg-amber-500" aria-hidden="true" />
                      <span>{error}</span>
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>}
    </div>
  );
}

// ── Labelled Bills Panel ─────────────────────────────────────────────────────

interface BillLabel {
  merchant_key: string;
  display_name: string;
  category: string;
  icon: string;
  label: string;
  is_skip: boolean;
}

function LabelledBillsPanel({
  labelOptions,
  onRelabelled,
}: {
  labelOptions: Record<string, { icon: string; label: string }>;
  onRelabelled: () => void;
}) {
  const [labels, setLabels] = useState<BillLabel[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ merchantKey: string; displayName: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.getBillLabels();
      setLabels(data);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleRelabel(merchantKey: string, category: string) {
    setSaving(merchantKey);
    setError(null);
    try {
      await api.labelBill(merchantKey, category);
      setLabels(prev => prev.map(l =>
        l.merchant_key === merchantKey
          ? { ...l, category, icon: labelOptions[category]?.icon ?? "", label: labelOptions[category]?.label ?? category, is_skip: category === "skip" }
          : l
      ));
      setEditing(null);
      if (category !== "skip") setTimeout(onRelabelled, 20000);
    } catch {
      setError("That didn't save, try again in a moment.");
    } finally {
      setSaving(null);
    }
  }

  async function handleDelete(merchantKey: string) {
    setSaving(merchantKey);
    setError(null);
    try {
      await api.deleteBillLabel(merchantKey);
      setLabels(prev => prev.filter(l => l.merchant_key !== merchantKey));
      setEditing(null);
    } catch {
      setError("Couldn't remove that label, try again in a moment.");
    } finally {
      setSaving(null);
    }
  }

  if (labels.length === 0) return null;

  return (
    <>
    <div className="glass-card rounded-2xl overflow-hidden">
      <button
        className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <div className="flex items-center gap-2.5">
          <span className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-700/60 flex items-center justify-center flex-shrink-0">
            <Tag size={15} className="text-slate-500 dark:text-slate-300" />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Your labelled bills</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{labels.length} bill{labels.length !== 1 ? "s" : ""} categorised</p>
          </div>
        </div>
        <ChevronDown size={16} className={`text-slate-500 dark:text-slate-400 flex-shrink-0 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700/60">
          {labels.map(lbl => {
            const isEditing = editing === lbl.merchant_key;
            const isSaving = saving === lbl.merchant_key;
            return (
              <div key={lbl.merchant_key} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium text-slate-800 dark:text-slate-200 truncate">
                      {lbl.display_name}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {!lbl.is_skip && (() => {
                        const LblIcon = insightCategoryIcon(lbl.category);
                        return <LblIcon size={13} className="text-slate-400 dark:text-slate-500 flex-shrink-0" />;
                      })()}
                      <span className={`text-[11px] text-slate-500 dark:text-slate-400 ${lbl.is_skip ? "italic" : ""}`}>
                        {lbl.is_skip ? "Skipped" : lbl.label}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setEditing(isEditing ? null : lbl.merchant_key)}
                    className="relative before:absolute before:-inset-y-2.5 before:-inset-x-1 before:content-[''] flex-shrink-0 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    Edit
                  </button>
                </div>

                {isEditing && (
                  <div className="mt-3 space-y-2">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">Change category:</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {Object.entries(labelOptions).map(([key, opt]) => {
                        const OptIcon = insightCategoryIcon(key);
                        return (
                        <button
                          key={key}
                          disabled={isSaving}
                          onClick={() => handleRelabel(lbl.merchant_key, key)}
                          className={`flex flex-col items-center gap-1 p-2.5 rounded-xl transition-all motion-reduce:transition-none disabled:opacity-40 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500
                            ${lbl.category === key
                              ? "bg-indigo-100 dark:bg-indigo-900/50 ring-1 ring-indigo-400"
                              : "bg-slate-50 dark:bg-slate-700/60 hover:bg-indigo-50 dark:hover:bg-indigo-900/30"
                            }`}
                        >
                          <OptIcon size={18} className="text-slate-500 dark:text-slate-300" />
                          <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300 leading-tight text-center">
                            {opt.label}
                          </span>
                        </button>
                        );
                      })}
                      <button
                        disabled={isSaving}
                        onClick={() => handleRelabel(lbl.merchant_key, "skip")}
                        className={`flex flex-col items-center gap-1 p-2.5 rounded-xl transition-all motion-reduce:transition-none disabled:opacity-40 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500
                          ${lbl.is_skip
                            ? "bg-slate-100 dark:bg-slate-600 ring-1 ring-slate-400"
                            : "bg-slate-50 dark:bg-slate-700/60 hover:bg-slate-100 dark:hover:bg-slate-600"
                          }`}
                      >
                        <X size={18} className="text-slate-400 dark:text-slate-400" />
                        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 leading-tight text-center">
                          Skip
                        </span>
                      </button>
                    </div>
                    <button
                      disabled={isSaving}
                      onClick={() => setConfirmDelete({ merchantKey: lbl.merchant_key, displayName: lbl.display_name })}
                      className="relative before:absolute before:-inset-y-2.5 before:-inset-x-1 before:content-[''] text-[11px] text-red-500 dark:text-red-400 hover:underline disabled:opacity-40 mt-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      Remove label (put back in unknown)
                    </button>
                    {error && !isSaving && (
                      <p className="flex items-start gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-[3px] bg-amber-500" aria-hidden="true" />
                        <span>{error}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
    <ConfirmDialog
      open={!!confirmDelete}
      title="Remove this label?"
      message={confirmDelete ? `"${confirmDelete.displayName}" goes back to unlabelled. You can relabel it later.` : ""}
      confirmLabel="Remove"
      destructive
      onConfirm={() => {
        if (confirmDelete) handleDelete(confirmDelete.merchantKey);
        setConfirmDelete(null);
      }}
      onCancel={() => setConfirmDelete(null)}
    />
    </>
  );
}


// ── Workflow Drawer ───────────────────────────────────────────────────────────

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

// ── Improve Housekeeping Panel (collapsed disclosure) ─────────────────────────

function ImproveHousekeepingPanel({
  labelOptions,
  onNewInsight,
  initialBills,
  onBillLabelled,
}: {
  labelOptions: Record<string, { icon: string; label: string }>;
  onNewInsight: () => void;
  initialBills?: UnknownBill[];
  onBillLabelled?: (merchantKey: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-slate-100 dark:border-slate-700/60 pt-1">
      <button
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="relative before:absolute before:-inset-y-2.5 before:inset-x-0 before:content-[''] w-full flex items-center justify-between gap-2 py-2 px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <span className="text-[11px] text-slate-400 dark:text-slate-500">
          Improve your suggestions
        </span>
        <ChevronDown
          size={14}
          className={`text-slate-500 dark:text-slate-400 flex-shrink-0 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="space-y-3 pb-1">
          <UnknownBillsPanel labelOptions={labelOptions} onNewInsight={onNewInsight} initialBills={initialBills} onBillLabelled={onBillLabelled} />
          <LabelledBillsPanel labelOptions={labelOptions} onRelabelled={onNewInsight} />
        </div>
      )}
    </div>
  );
}

// ── Insights Hero ─────────────────────────────────────────────────────────────
// Ported from the approved /design/insights-hero preview (Variant B,
// "Opportunity leads" — see that file for the full four-state rationale).
// This is a straight port to real data, not a redesign: same copy, same
// four coverage states, same glass-hero/glass-tile surfaces. The one
// deliberate departure from the preview is that it does NOT repeat the
// open insights as a mini row-list inside the card — on the real page the
// full InsightCard list sits immediately below and IS that reference set,
// so a second condensed copy of the same titles would just duplicate it.
// Instead each real card carries its own "estimated saving" / "No number
// yet" line (see InsightCard), which is the preview's per-row treatment
// ported onto the actual rows rather than a stand-in list.

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

// Skeleton in the hero's own shape — shown while SavingsInsightsSection's
// fetch is in flight, so nothing flashes a zero/empty state before real
// data lands (content-visible-by-default rule: this IS the visible content
// for that moment, not a spinner gate in front of it).
function InsightsHeroSkeleton() {
  return (
    <div className="glass-hero rounded-3xl p-4 animate-pulse" aria-hidden="true">
      <div className="h-2.5 w-40 rounded bg-slate-200 dark:bg-slate-700" />
      <div className="h-7 w-28 rounded bg-slate-200 dark:bg-slate-700 mt-2.5" />
      <div className="h-2.5 w-56 rounded bg-slate-200 dark:bg-slate-700 mt-2.5" />
      <div className="h-8 w-44 rounded-full bg-slate-200 dark:bg-slate-700 mt-3" />
    </div>
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

// ── Savings Insights Section (reusable body) ──────────────────────────────────

// GET /money-shape can fail or 402 like any other fetch — the hero must
// never block the tip list beneath it on that (owner brief 2026-09-02:
// "tolerate failure ... never block the tips"). This is the one synthetic
// MoneyShape value the client ever constructs itself: a `status: "thin"`
// shape renders the same honest "first full pay period will draw this"
// hero a genuinely new user sees, which is the closest true statement
// available when the real figure couldn't be fetched.
const MONEY_SHAPE_FETCH_FALLBACK: MoneyShape = {
  status: "thin",
  computed_at: new Date(0).toISOString(),
  period: null,
  take_home: 0,
  overspent: 0,
  jobs: null,
  verdict: null,
  trend: { periods: [], fixed: [], moved: [], free: [], left: [] },
  trend_line: null,
  what_works: {
    state: "thin",
    periods_available: 0,
    periods_needed: 4,
    pattern_id: null,
    headline: "Not enough history yet.",
    flag_labels: null,
    evidence: [],
    trait: null,
    proposal: null,
  },
};

// Tip-list grouping — "Fixed" / "Free spending" (mirrors SavingsInsight.job)
// then "Other" for anything that doesn't map to either (job null/undefined,
// e.g. an older backend that hasn't back-filled the field yet). Render
// order below is also the fold's "render order across groups" (see
// VISIBLE_UNPINNED's use further down).
type TipGroupKey = "fixed" | "free" | "other";
const TIP_GROUPS: { key: TipGroupKey; label: string; job: "fixed" | "free" | null }[] = [
  { key: "fixed", label: "Fixed", job: "fixed" },
  { key: "free", label: "Free spending", job: "free" },
  { key: "other", label: "Other", job: null },
];
function tipGroupKeyOf(insight: SavingsInsight): TipGroupKey {
  return insight.job === "fixed" ? "fixed" : insight.job === "free" ? "free" : "other";
}

export function SavingsInsightsSection({
  embedded = false,
  splitColumns = false,
}: { embedded?: boolean; splitColumns?: boolean } = {}) {
  const [insights, setInsights] = useState<SavingsInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshQueued, setRefreshQueued] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [labelOptions, setLabelOptions] = useState<Record<string, { icon: string; label: string }>>({});
  const [unknownBills, setUnknownBills] = useState<UnknownBill[] | undefined>(undefined);
  const [workflows, setWorkflows] = useState<Record<string, import("@/lib/api").WorkflowDef>>({});
  const [showAll, setShowAll] = useState(false);
  // Independent of `loading` (the tip list's own fetch) on purpose — the
  // hero must render (real or fallback) without waiting on, or blocking,
  // the tip list, and vice versa. null = still in flight, shows the same
  // InsightsHeroSkeleton the old hero used.
  const [moneyShape, setMoneyShape] = useState<MoneyShape | null>(null);
  const scrolledRef = useRef(false);
  const { open: openPennySheet } = usePennySheet();
  const askPenny = (ask: string) => openPennySheet({ screen: "insights", ask });

  // Tour readiness — tutorial-insights-hero and tutorial-insights-list's
  // real content both live behind this section's own `loading` (the
  // InsightsHeroSkeleton swap above is exactly what must never be a tour
  // target).
  useTutorialReady("insights", !loading);

  const VISIBLE_UNPINNED = 3;

  const loadInsights = useCallback(async () => {
    try {
      const data = await api.getSavingsInsights();
      setInsights(data);
      setError(null);
      setLocked(false);
      // Seeing the list clears the tab badge; per-card "New" chips keep their
      // own lifecycle (they fade when content stops changing)
      api.markInsightsViewed().catch(() => {});
      try { localStorage.removeItem("wd_insight_badge"); } catch {}
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("402")) {
        setLocked(true);
        setError(null);
      } else {
        setError("Couldn't load insights");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInsights();
    // No spotlight fetch here: this page no longer hides the spotlighted
    // insight (see the owner-decision comment on `unpinned` below), so it
    // has nothing left to feed. The spotlight endpoint's side effects
    // (retiring a superseded insight, recording spotlight_last_shown) still
    // run every time HomeInsightSpotlight mounts on Home.
    api.getUnknownBills().then(d => { setLabelOptions(d.label_options); setUnknownBills(d.unknown_bills); }).catch(() => {});
    api.getWorkflows().then(setWorkflows).catch(() => {});
    api.getMoneyShape().then(setMoneyShape).catch(() => setMoneyShape(MONEY_SHAPE_FETCH_FALLBACK));
  }, [loadInsights]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await api.refreshSavingsInsights();
      setRefreshQueued(true);
      setTimeout(() => { loadInsights(); setRefreshQueued(false); }, 20000);
    } catch {
      setError("Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  async function handlePin(id: string) {
    try {
      await api.pinSavingsInsight(id);
      setInsights(prev =>
        [...prev.map(i => i.id === id ? { ...i, pinned: !i.pinned } : i)]
          .sort((a, b) => Number(b.pinned) - Number(a.pinned))
      );
    } catch {}
  }

  const pinned = insights.filter(i => i.pinned);
  // Owner decision, 2026-08-27: this tab is the full index of open
  // opportunities. Every non-pinned insight renders here, including
  // whichever one is currently promoted to the Home spotlight — Home's
  // spotlight is a promotion of one item from this list, not a removal
  // from it, so nothing is filtered out. The hero below totals exactly
  // this set for the same reason.
  // Stable partition, not a re-rank: the backend's own biggest-impact-first
  // order (pinned, verified, estimate, spend — see _rank_key in
  // savings_insights.py) is preserved within each group. This only moves
  // compact-eligible rows (isCompactPullInsight — nothing furnished yet)
  // behind every verified/fresh/full card, so "Show N more ways to save"
  // leads with substance and the ledger rows trail it, instead of
  // interleaving by raw spend the way the backend order alone would.
  const unpinned = insights
    .filter(i => !i.pinned)
    .sort((a, b) => Number(isCompactPullInsight(a)) - Number(isCompactPullInsight(b)));
  // Group render order (Fixed, Free spending, Other — see TIP_GROUPS), with
  // the existing compact-to-end sort preserved WITHIN each group (the sort
  // above already ran over the whole array, so a group's own slice keeps
  // its relative order). VISIBLE_UNPINNED's fold below counts position in
  // THIS flattened order, i.e. "the first 3 unpinned cards in the order
  // they render on the page", not the pre-grouping order — grouping by job
  // can genuinely move a card ahead of or behind another that used to sit
  // next to it in the ungrouped list.
  const unpinnedByGroupOrder = TIP_GROUPS.flatMap(g => unpinned.filter(i => tipGroupKeyOf(i) === g.key));
  const visibleUnpinnedByGroupOrder = showAll ? unpinnedByGroupOrder : unpinnedByGroupOrder.slice(0, VISIBLE_UNPINNED);
  const hiddenCount = unpinnedByGroupOrder.length - visibleUnpinnedByGroupOrder.length;
  const visibleUnpinnedIds = new Set(visibleUnpinnedByGroupOrder.map(i => i.id));
  // Pinned cards render first inside their own group and are never folded
  // (matches the pre-grouping behaviour: pinned was always fully visible,
  // only `unpinned` was ever subject to VISIBLE_UNPINNED).
  function groupCards(key: TipGroupKey): SavingsInsight[] {
    const pinnedInGroup = pinned.filter(i => tipGroupKeyOf(i) === key);
    const unpinnedInGroup = unpinned
      .filter(i => tipGroupKeyOf(i) === key)
      .filter(i => showAll || visibleUnpinnedIds.has(i.id));
    return [...pinnedInGroup, ...unpinnedInGroup];
  }

  // ── Hero reconciliation ──────────────────────────────────────────────────
  // "Rendered" = every card this section actually puts on the page: pinned
  // + the full unpinned set (nothing is hidden — see the owner-decision
  // comment on `unpinned` above). Cards collapsed behind "Show N more" are
  // still on the page and reachable, so they count too. This must be the
  // exact same set InsightCard below renders, or the hero's numbers stop
  // reconciling with what the user can count.
  const heroRendered = [...pinned, ...unpinned];
  // Verified AND substituted insights are both resolved (the triggering
  // merchant went silent) — neither is still an "open idea" the user could
  // act on, so both are excluded from the open/coverage counters below.
  //
  // STRUCTURAL FIX — "open" = states fresh/quiet (see `insight.state`'s
  // docstring); switches on that directly when the backend sends it,
  // falling back to the pre-state-machine boolean check otherwise. This is
  // also the definition incoherence E asked for: "open" deliberately
  // excludes resolved (verified/substituted) cards even though they still
  // render as cards below. (The old hero's own resolved/acted-on/changes-
  // noticed counters that used to live here moved with it — see the still-
  // exported `InsightsHero`, kept only for the design twin now.)
  const heroOpen = heroRendered.filter(i =>
    i.state ? (i.state === "fresh" || i.state === "quiet")
            : (!i.verified_savings && !i.substituted)
  );
  // `savings_estimate_monthly` is null both when the backend genuinely
  // found no derivable figure (expected/common, see hard_rules #5 in
  // savings_insights.py) and when an older backend didn't serialise the
  // field at all (`!= null` catches both `null` and `undefined`) — both
  // cases fall back to the same honest no-coverage presentation rather
  // than a wrong or zero total, so no separate "old payload" branch exists.
  const heroOpenWithEstimate = heroOpen.filter(i => i.savings_estimate_monthly != null);
  const heroOpenMonthlySaving = Math.round(
    heroOpenWithEstimate.reduce((sum, i) => sum + (i.savings_estimate_monthly ?? 0), 0) * 100
  ) / 100;
  const heroVerifiedMonthlySaving = Math.round(
    heroRendered.reduce((sum, i) => sum + (i.verified_savings ?? 0), 0) * 100
  ) / 100;
  // Gates the per-card "No number yet" label (see InsightCard) — it only
  // earns its place once at least one open card actually has a number to
  // contrast against.
  const anyOpenHasEstimate = heroOpenWithEstimate.length > 0;

  // Deep link from the home spotlight: ?insight=<id> → reveal & scroll to that card.
  useEffect(() => {
    if (loading || scrolledRef.current || insights.length === 0) return;
    const target = new URLSearchParams(window.location.search).get("insight");
    if (!target) return;

    const idx = unpinnedByGroupOrder.findIndex(i => i.id === target);
    if (idx >= VISIBLE_UNPINNED && !showAll) {
      setShowAll(true); // card is hidden behind "show more" — expand first
      return;           // re-runs once expanded
    }

    const el = document.getElementById(`insight-card-${target}`);
    if (!el) return;
    scrolledRef.current = true;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-indigo-400", "ring-offset-2", "dark:ring-offset-slate-900");
    setTimeout(() => {
      el.classList.remove("ring-2", "ring-indigo-400", "ring-offset-2", "dark:ring-offset-slate-900");
    }, 2400);
  }, [loading, insights, showAll, unpinnedByGroupOrder]);

  // ── Hero column: money shape + what-works + reference row ────────────────
  // moneyShape is null only while the fetch is in flight — a genuine
  // failure resolves to MONEY_SHAPE_FETCH_FALLBACK (status "thin") above,
  // never leaves this null, so the tip list is never gated on it.
  const heroColumn = (
    <>
      {moneyShape ? <MoneyShapeHero shape={moneyShape} /> : <InsightsHeroSkeleton />}
      {moneyShape && (
        <>
          <WhatWorksCard ww={moneyShape.what_works} onAskPenny={askPenny} />
          <ReferenceShapesRow onAskPenny={askPenny} />
        </>
      )}
    </>
  );

  // ── Tips column: the existing InsightCard list, now grouped by job ──────
  const tipsColumn = (
    // Tour anchor lives here, not on the grouped-list div below (that div
    // is gated behind `pinned.length > 0 || unpinned.length > 0` and never
    // renders for a genuinely empty list) — this wrapper always renders
    // once `loading` is false, the same instant useTutorialReady("insights",
    // !loading) reports ready, empty state included.
    <div className="space-y-4" data-tutorial-id="tutorial-insights-list">
      <div>
        <SectionLabel>WHERE THE SHAPE CAN MOVE · YOUR OPEN IDEAS</SectionLabel>
        {/* Honest numbers folded from the old hero (see the reconciliation
            block above `heroColumn`) — reuses the exact same variables, so
            this line can never disagree with what the cards below actually
            total. */}
        <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400 text-pretty">
          {heroOpenWithEstimate.length > 0
            ? `${moneyEstimate(heroOpenMonthlySaving)}/mo identified across ${heroOpen.length} idea${heroOpen.length === 1 ? "" : "s"}`
            : `${heroOpen.length} idea${heroOpen.length === 1 ? "" : "s"}, none costed yet`}
        </p>
        {heroVerifiedMonthlySaving > 0 && (
          <div className="mt-2">
            <VerifiedChip verified={heroVerifiedMonthlySaving} />
          </div>
        )}
      </div>

      <div className="px-1 flex items-center justify-end gap-3">
        <button
          onClick={handleRefresh}
          disabled={refreshing || refreshQueued}
          className="flex items-center gap-1.5 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 disabled:opacity-40 transition-colors flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
          {refreshQueued ? "Searching…" : "Refresh"}
        </button>
      </div>

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="glass-card-flat rounded-2xl h-36 animate-pulse" />
          ))}
        </div>
      )}

      {!loading && locked && (
        <div className="glass-card-flat rounded-2xl overflow-hidden">
          <div className="bg-indigo-600 px-5 py-6 text-white">
            <p className="text-sm font-semibold uppercase tracking-wide text-indigo-200 mb-1">Pro feature</p>
            <p className="text-lg font-bold leading-snug">Personalised savings insights</p>
            <p className="text-sm text-indigo-100/90 mt-1.5 leading-relaxed">
              Upgrade to Pro to unlock AI-powered recommendations on your bills, subscriptions, energy, insurance, and more.
            </p>
          </div>
          <div className="px-5 py-4 space-y-2.5">
            {["Bill optimisation (energy, broadband, insurance)", "Subscription spend analysis", "Grocery price intelligence", "Fuel savings near you"].map(f => (
              <div key={f} className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300">
                <span className="w-4 h-4 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center flex-shrink-0 text-indigo-600 dark:text-indigo-300">
                  <Check size={11} strokeWidth={3} />
                </span>
                {f}
              </div>
            ))}
            <div className="pt-2">
              <p className="text-[11px] text-slate-500 dark:text-slate-400 text-center">From <span className="font-mono tabular-nums">£5.99</span>/month · Cancel anytime</p>
            </div>
          </div>
        </div>
      )}

      {!loading && !locked && error && (
        <div className="glass-card-flat rounded-2xl p-4 flex items-start gap-1.5 text-[14px] text-slate-500 dark:text-slate-400">
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1 bg-amber-500" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !locked && !error && insights.length === 0 && !refreshQueued && (
        <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
          <span className="w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-500/15 flex items-center justify-center">
            <Lightbulb size={26} className="text-indigo-500 dark:text-indigo-400" />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">No insights yet</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Tap Refresh to search for savings based on your transactions</p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing || refreshQueued}
            className="mt-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            Find Savings
          </button>
        </div>
      )}

      {refreshQueued && (
        <div className="bg-indigo-50 dark:bg-indigo-900/30 rounded-2xl p-4 flex items-center gap-3">
          <RefreshCw size={16} className="text-indigo-500 animate-spin flex-shrink-0" />
          <p className="text-sm text-indigo-700 dark:text-indigo-300">
            Searching for the latest deals… Results appear in ~20 seconds.
          </p>
        </div>
      )}

      {(pinned.length > 0 || unpinned.length > 0) && (
        <div className="space-y-5">
          {TIP_GROUPS.map(group => {
            const cards = groupCards(group.key);
            if (cards.length === 0) return null;
            const shapeJob = group.job && moneyShape?.jobs ? moneyShape.jobs.find(j => j.id === group.job) : undefined;
            return (
              <div key={group.key} className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  {group.job && <JobDot id={group.job} />}
                  <span className="text-[13px] font-semibold normal-case text-slate-900 dark:text-slate-100">
                    {group.label}
                  </span>
                  <span className="flex-1" />
                  {shapeJob && (
                    <span className="text-[12px] text-slate-500 dark:text-slate-400">
                      <MoneyText text={`£${Math.round(shapeJob.amount).toLocaleString("en-GB")}`} /> · {Math.round(shapeJob.share)}%
                    </span>
                  )}
                </div>
                <div className="space-y-3">
                  {cards.map(insight => (
                    <div key={insight.id} className="space-y-1.5">
                      <InsightCard
                        insight={insight}
                        workflow={workflows[insight.category] ?? null}
                        onPin={handlePin}
                        onContextSaved={loadInsights}
                        anyOpenHasEstimate={anyOpenHasEstimate}
                      />
                      {insight.savings_estimate_monthly != null && group.job && moneyShape && moneyShape.status !== "thin" && (
                        <ShapeAnchorStrip
                          estimateMonthly={insight.savings_estimate_monthly}
                          takeHome={moneyShape.take_home}
                          job={group.job}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hiddenCount > 0 && (
        <button
          onClick={() => setShowAll(s => !s)}
          className="w-full py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-600 dark:text-slate-300 active:scale-[0.98] transition-all motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          {showAll ? "Show fewer" : `Show ${hiddenCount} more way${hiddenCount === 1 ? "" : "s"} to save`}
        </button>
      )}

      {(pinned.length > 0 || unpinned.length > 0) && (
        <p className="text-[12px] text-slate-500 dark:text-slate-400 text-pretty">
          When an idea verifies, the next pay period&apos;s shape moves on its own. Nothing to log.
        </p>
      )}

      {/* Improve your suggestions — collapsed housekeeping, default closed */}
      <ImproveHousekeepingPanel
        labelOptions={labelOptions}
        onNewInsight={loadInsights}
        initialBills={unknownBills}
        onBillLabelled={(merchantKey) =>
          setUnknownBills(prev => prev?.filter(b => b.merchant_key !== merchantKey))
        }
      />
    </div>
  );

  if (splitColumns) {
    return (
      <div className="grid grid-cols-2 gap-4 items-start">
        <div className="space-y-4">{heroColumn}</div>
        {tipsColumn}
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-2">
      {heroColumn}
      {tipsColumn}
    </div>
  );
}

// ── Page (merged advisory view) ───────────────────────────────────────────────

export default function InsightsPage() {
  const router = useRouter();
  const { rawPrefs } = usePreferences();

  const [loading, setLoading] = useState(true);
  const [isPro, setIsPro] = useState<boolean | null>(null);
  // "tax" is a hidden tab: never offered in the UI, reachable only via the
  // ?tab=tax deep link (Grow pension rungs + Settings keep pointing here).
  const [tab, setTab] = useState<"save" | "tax">("save");
  const [incomeBracket, setIncomeBracket] = useState("");
  const [taxIncomeValue, setTaxIncomeValue] = useState(0);
  const [taxPensionAnnual, setTaxPensionAnnual] = useState(0);
  const [taxHasChildBenefit, setTaxHasChildBenefit] = useState(false);
  const [taxPrefsLoaded, setTaxPrefsLoaded] = useState(false);

  const initialTabSet = useRef(false);
  const savingsSectionRef = useRef<HTMLDivElement>(null);

  // Desktop shows every section at once (no tabs), so render mode must be
  // decided in JS — CSS-hiding a duplicate tree would double every fetch.
  const [isDesktop, setIsDesktop] = useState(false);
  useLayoutEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Defer secondary desktop sections (Mobility + Tax) so their data fetches
  // don't compete with the critical debt/savings data on first paint.
  // Mobile is unaffected — it only mounts one tab at a time already.
  const [secondaryReady, setSecondaryReady] = useState(false);
  useEffect(() => {
    const w = window as any;
    const ric = w.requestIdleCallback || ((cb: () => void) => setTimeout(cb, 200));
    const id = ric(() => setSecondaryReady(true));
    return () => (w.cancelIdleCallback || clearTimeout)(id);
  }, []);

  const load = useCallback(async () => {
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.getSubscription()
      .then(s => setIsPro(s.tier !== "free"))
      .catch(() => setIsPro(true));
  }, []);

  // Hydrate tab-shaping flags from the last visit before paint, so the tab row
  // doesn't reshuffle when the fetches land a moment later
  useLayoutEffect(() => {
    try {
      const b = localStorage.getItem("wd_bracket");
      if (b !== null) setIncomeBracket(b);
    } catch {}
  }, []);

  useEffect(() => {
    if (!rawPrefs) return;
    const p = rawPrefs;
    const bracket = p.income_bracket ?? "";
    setIncomeBracket(bracket);
    try { localStorage.setItem("wd_bracket", bracket); } catch {}
    // Capture tax-related fields so embedded TaxPage can skip its own fetch.
    const iv = (p as any).income_value ?? 0;
    setTaxIncomeValue(
      iv > 0 ? iv
        : bracket === "100k_125k" ? 110_000
        : bracket === "125k_plus"  ? 130_000
        : 0
    );
    setTaxPensionAnnual((p as any).pension_annual ?? 0);
    setTaxHasChildBenefit((p as any).has_child_benefit ?? false);
    setTaxPrefsLoaded(true);
  }, [rawPrefs]);

  // Default to "Ways to save"; redirect ?tab=plan deep-links to /cards (the
  // debt-plan page's successor, /debt-plan itself retired 2026-08-30).
  useEffect(() => {
    if (!loading && !initialTabSet.current) {
      initialTabSet.current = true;
      const params = new URLSearchParams(window.location.search);
      const requested = params.get("tab");
      if (requested === "plan") {
        router.replace("/cards");
        return;
      }
      const chosen: "save" | "tax" = requested === "tax" ? "tax" : "save";
      setTab(chosen);
      if (chosen === "save" && requested === "save") {
        setTimeout(() => {
          savingsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 150);
      }
    }
  }, [loading, router]);

  const heroMode = isDesktop ? "save" : tab;

  const taxYear = (() => {
    const now = new Date();
    const year = now.getFullYear();
    const apr6 = new Date(year, 3, 6);
    const start = now >= apr6 ? apr6 : new Date(year - 1, 3, 6);
    const end = new Date(start.getFullYear() + 1, 3, 5);
    const pct = Math.min(100, Math.round((now.getTime() - start.getTime()) / (end.getTime() - start.getTime()) * 100));
    const daysLeft = Math.ceil((end.getTime() - now.getTime()) / 86_400_000);
    const label = `${start.getFullYear()}/${String(end.getFullYear()).slice(2)}`;
    return { pct, daysLeft, label };
  })();

  return (
    <div className="min-h-dvh pb-[calc(9rem+env(safe-area-inset-bottom,0px))] max-w-[430px] mx-auto lg:max-w-6xl lg:pb-10" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      {/* Header — compact, one primary stat max. */}
      {loading ? (
        <div className="mx-4 mt-4 rounded-3xl h-[120px] bg-slate-200 dark:bg-slate-800 animate-pulse" />
      ) : heroMode === "tax" ? (
        /* Neutral hero prototype: calm surface, colour in the icon chip and stat —
           Penny's gradient stays the only loud element */
        <div className="mx-4 mt-4 rounded-3xl px-4 pt-5 pb-5 glass-hero">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-500 dark:text-violet-400 mb-0.5">Tax year {taxYear.label}</p>
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Tax efficiency</h1>
            </div>
            <div className="w-11 h-11 rounded-2xl bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center flex-shrink-0">
              <TrendingUp className="w-5 h-5 text-violet-600 dark:text-violet-400" />
            </div>
          </div>
          <div className="mt-3 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden" role="progressbar" aria-valuenow={Math.round(taxYear.pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Tax year progress">
            <div className="h-full bg-violet-500 rounded-full bar-sweep" style={{ width: `${taxYear.pct}%` }} />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">6 Apr</span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">{taxYear.daysLeft} days left</span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">5 Apr</span>
          </div>
        </div>
      ) : null /* "Ways to save" plain title/subtitle retired — the Insights
                   hero (rendered inside SavingsInsightsSection, just above
                   its card list) now carries that header duty with real
                   figures instead of static copy. Extra top padding on the
                   content wrapper below (in place of this block's old
                   pt-6 pb-2) keeps the same vertical rhythm before the
                   hero as this used to give the plain title. */}

      <div className={`px-4 space-y-3 ${heroMode === "tax" ? "pt-4" : "pt-6"}`}>
        {loading ? (
          <div className="flex items-center justify-center py-16"><Spinner size={32} /></div>
        ) : (
          <>
            {/* Tax is retired from the tab bar — with one visible section there
                is no SegmentedControl. ?tab=tax still deep-links to TaxPage. */}
            {(() => {
              const waysBlock = (
                <SavingsInsightsSection embedded />
              );
              // Desktop, no Tax deep-link: the widest layout this page ever
              // shows, so the hero/what-works/reference row get their own
              // left column instead of sitting above a single centred
              // "Ways to save" list (owner brief 2026-09-02: "left column =
              // hero + what-works + reference row; right column = tips
              // section"). Only used in that one branch below — the 2-col
              // Ways|Tax layout and mobile both keep the stacked `waysBlock`,
              // there's no room left for a THIRD column once Tax joins.
              const waysBlockSplit = (
                <SavingsInsightsSection embedded splitColumns />
              );

              const taxBlock = (
                <TaxPage
                  embedded
                  prefsLoaded={taxPrefsLoaded}
                  incomeValue={taxIncomeValue}
                  incomeBracket={incomeBracket}
                  pensionAnnual={taxPensionAnnual}
                  hasChildBenefit={taxHasChildBenefit}
                />
              );

              // Desktop: no tabs — Ways to save leads. The retired Tax section
              // only joins the layout when deep-linked (?tab=tax).
              if (isDesktop) {
                const columnTitle = (label: string, dotClassName: string) => (
                  <div className="flex items-center gap-2 px-1">
                    <span className={`w-2 h-2 rounded-full ${dotClassName}`} />
                    <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</h2>
                  </div>
                );
                const waysSec = (
                  <div key="save" className="space-y-3">{columnTitle("Ways to save", "bg-teal-600")}{waysBlock}</div>
                );

                if (tab !== "tax") {
                  // Widest layout this page shows — hero/what-works/reference
                  // row get their own left column, tips their own right
                  // column (splitColumns, see waysBlockSplit above).
                  return (
                    <div className="max-w-4xl mx-auto space-y-3">
                      {columnTitle("Ways to save", "bg-teal-600")}
                      {waysBlockSplit}
                    </div>
                  );
                }

                const secondaryPlaceholder = (
                  <div className="glass-card-flat rounded-2xl animate-pulse h-48" />
                );
                const taxSec = (
                  <div key="tax" className="space-y-3">
                    {columnTitle("Tax efficiency", "bg-slate-400 dark:bg-slate-500")}
                    {secondaryReady ? taxBlock : secondaryPlaceholder}
                  </div>
                );
                // 2 columns: Ways to save | Tax (deep-linked)
                return (
                  <div className="grid grid-cols-2 gap-4 items-start">
                    <div className="space-y-3">{waysSec}</div>
                    <div className="space-y-3">{taxSec}</div>
                  </div>
                );
              }

              // Mobile: Tax renders only via deep link — a quiet escape row
              // leads back to the sole visible section.
              return tab === "tax" ? (
                <div className="space-y-3">
                  <button
                    onClick={() => { setTab("save"); router.replace("/insights"); }}
                    className="flex items-center gap-1 px-1 text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <ChevronLeft size={16} /> Ways to save
                  </button>
                  {taxBlock}
                  <TaxPennyEntry />
                </div>
              ) : (
                waysBlock
              );
            })()}

            <AdviceDisclaimer className="pt-1" />
          </>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
