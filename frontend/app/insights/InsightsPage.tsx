"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useRef, type ReactNode, useId } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Bookmark, BookmarkCheck, RefreshCw, Sparkles, ChevronDown, ChevronLeft, ChevronRight, SlidersHorizontal, X, Check, CheckCircle2, ExternalLink, TrendingUp, Search, Tag, Lightbulb } from "lucide-react";
import { api, SavingsInsight, WorkflowDef, WorkflowStep, FuelNearby } from "@/lib/api";
import { insightCategoryIcon } from "@/lib/insightIcons";
import { useSheetA11y } from "@/lib/useSheetA11y";
import { useSheetOpen } from "@/lib/useSheetOpen";
import ConfirmDialog from "@/components/ConfirmDialog";
import BottomNav from "@/components/BottomNav";
import Spinner from "@/components/Spinner";
import AdviceDisclaimer from "@/components/AdviceDisclaimer";
import MoneyBasicCard from "@/components/MoneyBasicCard";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import FuelSavingsCard from "@/components/FuelSavingsCard";
import GroceryBasketCard from "@/components/GroceryBasketCard";
import TaxPage from "@/app/insights/tax/TaxPage";
import TaxChat from "@/components/TaxChat";
import { usePreferences } from "@/components/PreferencesContext";

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

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days <= 0) return "Today"; // clock skew between server and device can push diff slightly negative
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
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

  useEffect(() => {
    if (initialBills === undefined) return;
    setBills(initialBills);
    setLoading(false);
  }, [initialBills]);

  async function pick(merchantKey: string, category: string) {
    setSaving(merchantKey);
    try {
      await api.labelBill(merchantKey, category);
      setBills(prev => prev.filter(b => b.merchant_key !== merchantKey));
      onBillLabelled?.(merchantKey);
      setExpanded(null);
      if (category !== "skip") {
        setTimeout(onNewInsight, 20000);
      }
    } catch {
    } finally {
      setSaving(null);
    }
  }

  if (loading || bills.length === 0) return null;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-amber-200 dark:border-amber-800/50 overflow-hidden">
      <button
        className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left bg-amber-50 dark:bg-amber-900/20"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <div className="flex items-center gap-2.5">
          <span className="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-500/15 flex items-center justify-center flex-shrink-0">
            <Search size={15} className="text-amber-600 dark:text-amber-400" />
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
        <ChevronDown size={16} className={`flex-shrink-0 text-slate-500 dark:text-slate-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && <div className="border-t border-amber-100 dark:border-amber-800/40 divide-y divide-slate-100 dark:divide-slate-700/60">
        {bills.map(bill => {
          const isOpen = expanded === bill.merchant_key;
          const isSaving = saving === bill.merchant_key;
          return (
            <div key={bill.merchant_key}>
              <button
                className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left"
                onClick={() => setExpanded(isOpen ? null : bill.merchant_key)}
              >
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-slate-800 dark:text-slate-200 truncate">
                    {bill.display_name}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    £{bill.monthly_amount.toFixed(2)}/mo · {bill.occurrences} payments
                  </p>
                </div>
                <ChevronDown
                  size={16}
                  className={`flex-shrink-0 text-slate-500 dark:text-slate-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
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
                        className="flex flex-col items-center gap-1 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-700/60 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 active:scale-95 transition-all disabled:opacity-40"
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
                      className="flex flex-col items-center gap-1 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-700/60 hover:bg-slate-100 dark:hover:bg-slate-600 active:scale-95 transition-all disabled:opacity-40"
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

  const load = useCallback(async () => {
    try {
      const data = await api.getBillLabels();
      setLabels(data);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleRelabel(merchantKey: string, category: string) {
    setSaving(merchantKey);
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
    } finally {
      setSaving(null);
    }
  }

  async function handleDelete(merchantKey: string) {
    setSaving(merchantKey);
    try {
      await api.deleteBillLabel(merchantKey);
      setLabels(prev => prev.filter(l => l.merchant_key !== merchantKey));
      setEditing(null);
    } catch {
    } finally {
      setSaving(null);
    }
  }

  if (labels.length === 0) return null;

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <button
        className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left"
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
        <ChevronDown size={16} className={`text-slate-500 dark:text-slate-400 flex-shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
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
                    className="flex-shrink-0 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
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
                          className={`flex flex-col items-center gap-1 p-2.5 rounded-xl transition-all disabled:opacity-40 active:scale-95
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
                        className={`flex flex-col items-center gap-1 p-2.5 rounded-xl transition-all disabled:opacity-40 active:scale-95
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
                      onClick={() => handleDelete(lbl.merchant_key)}
                      className="text-[11px] text-red-500 dark:text-red-400 hover:underline disabled:opacity-40 mt-1"
                    >
                      Remove label (put back in unknown)
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
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

  const totalSteps = workflow.steps.length;
  const currentStep = workflow.steps[step];

  function set(id: string, val: string) {
    setValues(prev => ({ ...prev, [id]: val }));
  }

  async function save() {
    setSaving(true);
    try {
      await api.saveInsightContext(insight.id, values);
      setDone(true);
      setTimeout(() => { onClose(); onSaved(); }, 1500);
    } catch {
      setSaving(false);
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
              className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-[transform,background-color,color,border-color] duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
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
            <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-slate-600 transition-colors">
              <X size={20} />
            </button>
          </div>

          {done ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <CheckCircle2 size={48} className="text-emerald-500" />
              <p className="text-[14px] text-slate-500 dark:text-slate-400 text-center">
                Saved — Penny is crunching your numbers.<br />
                Your personalised advice appears on this card in a moment.
              </p>
            </div>
          ) : (
            <>
              {/* What we already see — grounds the questions in their own data */}
              {topTrigger && (
                <div className="mb-4 px-3 py-2.5 rounded-xl border border-indigo-100/80 dark:border-indigo-400/20 bg-indigo-50/70 dark:bg-indigo-500/10 text-[11px] text-indigo-700 dark:text-indigo-300">
                  We can already see <span className="font-semibold">~£{topTrigger.monthly_amount.toLocaleString("en-GB", { maximumFractionDigits: 0 })}/mo</span> at{" "}
                  <span className="font-semibold">{topTrigger.display_name}</span> — {totalSteps <= 2 ? "just" : "only"} {totalSteps} quick {totalSteps === 1 ? "question" : "questions"} to tailor the advice to your exact deal.
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
                  className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-slate-600 text-[14px] font-medium text-slate-600 dark:text-slate-400"
                >
                  Back
                </button>
              )}
              {step < totalSteps - 1 ? (
                <button
                  onClick={() => setStep(s => s + 1)}
                  className="flex-1 py-3 rounded-xl bg-indigo-600 text-white text-[14px] font-semibold flex items-center justify-center gap-2"
                >
                  Next <ChevronRight size={16} />
                </button>
              ) : (
                <button
                  onClick={save}
                  disabled={saving}
                  className="flex-1 py-3 rounded-xl bg-indigo-600 text-white text-[14px] font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {saving ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                  {saving ? "Saving…" : "Save & Personalise"}
                </button>
              )}
            </div>
            {totalSteps > 1 && step < totalSteps - 1 && (
              <button
                onClick={save}
                disabled={saving}
                className="w-full text-center text-[11px] text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-40 mt-3"
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

function InsightBody({ body }: { body: string }) {
  const [expanded, setExpanded] = useState(false);
  // Split on sentence endings; keep first 2 sentences as the visible preview
  const sentences = body.match(/[^.!?]+[.!?]+/g) ?? [body];
  const preview = sentences.slice(0, 2).join(" ").trim();
  const rest = sentences.slice(2).join(" ").trim();
  const hasMore = rest.length > 0;

  return (
    <div className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
      <span>{preview}</span>
      {hasMore && !expanded && (
        <>
          {" "}
          <button
            onClick={() => setExpanded(true)}
            className="text-[11px] font-medium text-indigo-500 dark:text-indigo-400 hover:underline"
          >
            more
          </button>
        </>
      )}
      {hasMore && expanded && (
        <>
          {" "}
          <span>{rest}</span>
          {" "}
          <button
            onClick={() => setExpanded(false)}
            className="text-[11px] font-medium text-indigo-500 dark:text-indigo-400 hover:underline"
          >
            less
          </button>
        </>
      )}
    </div>
  );
}

// ── Insight Card ──────────────────────────────────────────────────────────────

function InsightCard({
  insight,
  workflow,
  onPin,
  onContextSaved,
}: {
  insight: SavingsInsight;
  workflow: WorkflowDef | null;
  onPin: (id: string) => void;
  onContextSaved: () => void;
}) {
  const router = useRouter();
  const [showTriggers, setShowTriggers] = useState(false);
  const [showWorkflow, setShowWorkflow] = useState(false);
  // The user's own figure — leads the card (verdict first, then the web copy)
  const topTrigger = insight.triggered_by[0] ?? null;
  const extraTriggers = insight.triggered_by.length - 1;

  return (
    <>
      <div
        id={`insight-card-${insight.id}`}
        className="glass-card rounded-2xl overflow-hidden scroll-mt-24 transition-shadow"
      >
        <div className="p-4 flex flex-col gap-3">
          {/* Category + badges + pin */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <CategoryChip category={insight.category} label={insight.label} />

              {insight.is_new && (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 flex items-center gap-1">
                  <Sparkles size={10} /> New
                </span>
              )}
            </div>
            <button
              onClick={() => onPin(insight.id)}
              className="flex-shrink-0 p-1.5 rounded-xl text-slate-400 hover:text-indigo-500 transition-colors"
            >
              {insight.pinned ? <BookmarkCheck size={18} className="text-indigo-500" /> : <Bookmark size={18} />}
            </button>
          </div>

          {/* Closure: the loop actually closed — celebrate */}
          {insight.verified_savings ? (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-900/25 border border-emerald-200 dark:border-emerald-800">
              <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-emerald-800 dark:text-emerald-300 leading-snug">
                <span className="font-bold">You did it</span> — payments to {insight.verified_merchant} have stopped.
                That&apos;s ~£{insight.verified_savings.toLocaleString("en-GB", { maximumFractionDigits: 0 })}/mo staying in your pocket.
              </p>
            </div>
          ) : null}

          {/* The user's own figure opens the card — verdict first */}
          {topTrigger && (
            <p className="text-base font-bold text-slate-900 dark:text-slate-100 leading-snug">
              ~£{topTrigger.monthly_amount.toLocaleString("en-GB", { maximumFractionDigits: 0 })}/mo{" "}
              <span className="font-medium">at {topTrigger.display_name}</span>
              {extraTriggers > 0 && <span className="font-medium"> · +{extraTriggers} more</span>}{" "}
              <span className="text-xs font-normal text-slate-500 dark:text-slate-400">— from your transactions</span>
            </p>
          )}

          {/* Generic title — demoted beneath the personal figure (leads only when no trigger) */}
          <p
            className={
              topTrigger
                ? "text-sm text-slate-600 dark:text-slate-300 leading-snug [text-wrap:balance] -mt-1.5"
                : "text-base font-bold text-slate-900 dark:text-slate-100 leading-snug [text-wrap:balance]"
            }
          >
            {insight.title}
          </p>

          {/* Body — truncated to ~2 sentences with a "more" toggle */}
          <InsightBody body={insight.body} />

          {/* Timestamp — only show if recent (≤14 days) */}
          {insight.refreshed_at && (Date.now() - new Date(insight.refreshed_at).getTime()) < 14 * 86400000 && (
            <span className="text-[11px] text-slate-400 dark:text-slate-500 self-end">{timeAgo(insight.refreshed_at)}</span>
          )}

          {/* Primary action — the user's own data, in-app */}
          {insight.app_route && (
            <button
              onClick={() => router.push(insight.app_route!)}
              className="self-start inline-flex items-center gap-0.5 py-3 -my-1.5 text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 active:scale-95 transition-all"
            >
              {APP_ROUTE_LABELS[insight.category] ?? "See it in your spending"}
              <ChevronRight size={15} />
            </button>
          )}

          {/* Comparison sites — secondary, quiet */}
          {CATEGORY_LINKS[insight.category] && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-400 dark:text-slate-500">Compare:</span>
              {CATEGORY_LINKS[insight.category].map(link => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative before:absolute before:-inset-y-2.5 before:-inset-x-0.5 before:content-[''] inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400 bg-slate-100/80 dark:bg-slate-700/60 px-2 py-1 rounded-full hover:bg-slate-200 dark:hover:bg-slate-600 active:scale-95 transition-all"
                >
                  <ExternalLink size={10} />
                  {link.label}
                </a>
              ))}
            </div>
          )}

          {/* CTA — workflow (demoted to secondary) */}
          {workflow && (
            <button
              onClick={() => setShowWorkflow(true)}
              className="w-full mt-1 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-transparent hover:bg-slate-50 dark:hover:bg-slate-700/50 active:scale-[0.98] text-slate-600 dark:text-slate-300 text-sm font-medium flex items-center justify-center gap-2 transition-all"
            >
              <SlidersHorizontal size={14} />
              {insight.user_context ? "Improve this tip" : workflow.cta}
            </button>
          )}
        </div>

        {/* Triggered by — collapsible */}
        {insight.triggered_by.length > 0 && (
          <div className="border-t border-slate-100 dark:border-slate-700">
            <button
              onClick={() => setShowTriggers(v => !v)}
              className="w-full px-4 py-2.5 flex items-center justify-between text-left"
              aria-expanded={showTriggers}
            >
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Based on {insight.triggered_by.length} transaction{insight.triggered_by.length > 1 ? "s" : ""}
              </span>
              <ChevronDown size={14} className={`text-slate-500 dark:text-slate-400 transition-transform duration-200 ${showTriggers ? "rotate-180" : ""}`} />
            </button>
            {showTriggers && (
              <div className="px-4 pb-3 space-y-1.5">
                {insight.triggered_by.map(t => (
                  <div key={t.merchant_key} className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-600 dark:text-slate-300 truncate max-w-[65%]">{t.display_name}</span>
                    <span className="text-slate-500 dark:text-slate-400">£{t.monthly_amount.toFixed(2)}/mo · {t.occurrences}×</span>
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
        className="w-full flex items-center justify-between gap-2 py-2 px-1 text-left"
      >
        <span className="text-[11px] text-slate-400 dark:text-slate-500">
          Improve your suggestions
        </span>
        <ChevronDown
          size={14}
          className={`text-slate-500 dark:text-slate-400 flex-shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
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

// ── Savings Insights Section (reusable body) ──────────────────────────────────

export function SavingsInsightsSection({ embedded = false }: { embedded?: boolean } = {}) {
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
  const [spotlightId, setSpotlightId] = useState<string | null>(null);
  const scrolledRef = useRef(false);

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
    api.getSpotlightInsight().then(s => setSpotlightId(s?.id ?? null)).catch(() => {});
    api.getUnknownBills().then(d => { setLabelOptions(d.label_options); setUnknownBills(d.unknown_bills); }).catch(() => {});
    api.getWorkflows().then(setWorkflows).catch(() => {});
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

  const deepLinkId = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("insight")
    : null;

  const pinned = insights.filter(i => i.pinned);
  // The insight already featured on the Home spotlight is hidden here to avoid
  // showing the same card twice — unless the user deep-linked straight to it,
  // or it's the only thing we'd have to show.
  const unpinnedAll = insights.filter(i => !i.pinned);
  const unpinned = unpinnedAll.filter(i =>
    i.id !== spotlightId || i.id === deepLinkId || unpinnedAll.length <= 1
  );
  const visibleUnpinned = showAll ? unpinned : unpinned.slice(0, VISIBLE_UNPINNED);
  const hiddenCount = unpinned.length - visibleUnpinned.length;

  // Deep link from the home spotlight: ?insight=<id> → reveal & scroll to that card.
  useEffect(() => {
    if (loading || scrolledRef.current || insights.length === 0) return;
    const target = new URLSearchParams(window.location.search).get("insight");
    if (!target) return;

    const idx = unpinned.findIndex(i => i.id === target);
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
  }, [loading, insights, showAll, unpinned]);

  return (
    <div className="space-y-4 pt-2" data-tutorial-id="tutorial-insights-list">
      {/* Section header — separates "ways to save" from the cushion section above.
          When embedded under a page-level "Ways to save" header, drop the duplicate
          title/description and keep only the Refresh control. */}
      {embedded ? (
        <div className="px-1 flex items-center justify-end gap-3">
          <button
            onClick={handleRefresh}
            disabled={refreshing || refreshQueued}
            className="flex items-center gap-1.5 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 disabled:opacity-40 transition-colors flex-shrink-0"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            {refreshQueued ? "Searching…" : "Refresh"}
          </button>
        </div>
      ) : (
        <div className="px-1 pt-3 border-t border-slate-200/70 dark:border-slate-700/60">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Ways to save</h2>
            <button
              onClick={handleRefresh}
              disabled={refreshing || refreshQueued}
              className="flex items-center gap-1.5 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 disabled:opacity-40 transition-colors flex-shrink-0"
            >
              <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
              {refreshQueued ? "Searching…" : "Refresh"}
            </button>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mt-1">
            Personalised ways to spend less. Start with the top one — pin the ones you want to act on.
          </p>
        </div>
      )}

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white dark:bg-slate-800 rounded-2xl h-36 animate-pulse" />
          ))}
        </div>
      )}

      {!loading && locked && (
        <div className="rounded-2xl overflow-hidden border border-indigo-100 dark:border-indigo-900">
          <div className="bg-indigo-600 px-5 py-6 text-white">
            <p className="text-sm font-semibold uppercase tracking-wide text-indigo-200 mb-1">Pro feature</p>
            <p className="text-lg font-bold leading-snug">Personalised savings insights</p>
            <p className="text-sm text-indigo-100/90 mt-1.5 leading-relaxed">
              Upgrade to Pro to unlock AI-powered recommendations on your bills, subscriptions, energy, insurance, and more.
            </p>
          </div>
          <div className="bg-white dark:bg-slate-800 px-5 py-4 space-y-2.5">
            {["Bill optimisation (energy, broadband, insurance)", "Subscription spend analysis", "Grocery price intelligence", "Fuel savings near you"].map(f => (
              <div key={f} className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300">
                <span className="w-4 h-4 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center flex-shrink-0 text-indigo-600 dark:text-indigo-300">
                  <Check size={11} strokeWidth={3} />
                </span>
                {f}
              </div>
            ))}
            <div className="pt-2">
              <p className="text-[11px] text-slate-500 dark:text-slate-400 text-center">From £5.99/month · Cancel anytime</p>
            </div>
          </div>
        </div>
      )}

      {!loading && !locked && error && (
        <div className="bg-red-50 dark:bg-red-900/20 rounded-2xl p-4 text-[14px] text-red-600 dark:text-red-400">
          {error}
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
            className="mt-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50"
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

      {pinned.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2 px-1">
            Pinned
          </p>
          <div className="space-y-3">
            {pinned.map(i => <InsightCard key={i.id} insight={i} workflow={workflows[i.category] ?? null} onPin={handlePin} onContextSaved={loadInsights} />)}
          </div>
        </div>
      )}

      {unpinned.length > 0 && (
        <div>
          {pinned.length > 0 && (
            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2 px-1">
              For You
            </p>
          )}
          <div className="space-y-3">
            {visibleUnpinned.map(i => <InsightCard key={i.id} insight={i} workflow={workflows[i.category] ?? null} onPin={handlePin} onContextSaved={loadInsights} />)}
          </div>
          {unpinned.length > VISIBLE_UNPINNED && (
            <button
              onClick={() => setShowAll(s => !s)}
              className="w-full mt-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-600 dark:text-slate-300 active:scale-[0.98] transition-all"
            >
              {showAll ? "Show fewer" : `Show ${hiddenCount} more way${hiddenCount === 1 ? "" : "s"} to save`}
            </button>
          )}
        </div>
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
  const [savingsMoreOpen, setSavingsMoreOpen] = useState(false);

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

  // Default to "Ways to save"; redirect ?tab=plan deep-links to /debt-plan.
  useEffect(() => {
    if (!loading && !initialTabSet.current) {
      initialTabSet.current = true;
      const params = new URLSearchParams(window.location.search);
      const requested = params.get("tab");
      if (requested === "plan") {
        router.replace("/debt-plan");
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
    <div className="min-h-dvh pb-36 max-w-[430px] mx-auto lg:max-w-6xl lg:pb-10" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      {/* Header — compact, one primary stat max. */}
      {loading ? (
        <div className="mx-4 mt-4 rounded-3xl h-[120px] bg-slate-200 dark:bg-slate-800 animate-pulse" />
      ) : heroMode === "tax" ? (
        /* Neutral hero prototype: calm surface, colour in the icon chip and stat —
           Penny's gradient stays the only loud element */
        <div
          className="mx-4 mt-4 rounded-3xl px-4 pt-5 pb-5 glass-hero"
          data-tutorial-id="tutorial-debt-header"
        >
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
      ) : (
        /* Ways to save — plain header, matches Planning/Spend idiom */
        <div className="px-4 pt-6 pb-2" data-tutorial-id="tutorial-debt-header">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1">INSIGHTS</p>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Ways to save</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Personalised ways to spend less — start with the top one.</p>
        </div>
      )}

      <div className="px-4 pt-4 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Spinner size={32} /></div>
        ) : (
          <>
            {/* Tax is retired from the tab bar — with one visible section there
                is no SegmentedControl. ?tab=tax still deep-links to TaxPage. */}
            {(() => {
              const waysBlock = (
                <>
                  <SavingsInsightsSection embedded />

                  {/* ── Collapsed education section ── */}
                  <div className="border-t border-slate-200/70 dark:border-slate-700/60 pt-2">
                    <button
                      onClick={() => setSavingsMoreOpen(v => !v)}
                      className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 py-1 w-full text-left"
                      aria-expanded={savingsMoreOpen}
                    >
                      <ChevronRight size={16} className={`text-slate-500 dark:text-slate-400 transition-transform flex-shrink-0 ${savingsMoreOpen ? "rotate-90" : ""}`} />
                      More · learn the basics
                    </button>
                    {savingsMoreOpen && <MoneyBasicCard className="mt-2" />}
                  </div>
                </>
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
                const columnTitle = (label: string, colour: string) => (
                  <div className="flex items-center gap-2 px-1">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colour }} />
                    <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</h2>
                  </div>
                );
                const waysSec = (
                  <div key="save" className="space-y-3">{columnTitle("Ways to save", "#0d9488")}{waysBlock}</div>
                );

                if (tab !== "tax") {
                  // 1 column: Ways to save only
                  return <div className="max-w-xl mx-auto">{waysSec}</div>;
                }

                const secondaryPlaceholder = (
                  <div className="rounded-2xl bg-white dark:bg-slate-800 shadow-sm animate-pulse h-48" />
                );
                const taxSec = (
                  <div key="tax" className="space-y-3">
                    {columnTitle("Tax efficiency", "#7c3aed")}
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
                    className="flex items-center gap-1 px-1 text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                  >
                    <ChevronLeft size={16} /> Ways to save
                  </button>
                  {taxBlock}
                </div>
              ) : (
                waysBlock
              );
            })()}

            <AdviceDisclaimer className="pt-1" />
          </>
        )}
      </div>

      {!isDesktop && tab === "tax" && <TaxChat />}
      <BottomNav />
    </div>
  );
}
