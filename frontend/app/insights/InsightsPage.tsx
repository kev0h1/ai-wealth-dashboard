"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useRef, type ReactNode, useId } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, BookmarkCheck, RefreshCw, Sparkles, ChevronDown, ChevronRight, SlidersHorizontal, X, ArrowRight, CheckCircle2, Circle, ExternalLink, TrendingDown, PiggyBank, Target, Trash2, Shield, Pencil, Plus, Fuel, MapPin, Receipt, Camera, Image as ImageIcon, TrendingUp, Store, Pin } from "lucide-react";
import { api, SavingsInsight, WorkflowDef, WorkflowStep, DebtPlan, SavingsInsights, SavingsPlan, SavingsGoalInput, SavingsAccountOption, MoneyBasic, FuelNearby, Basket, BasketInsights } from "@/lib/api";
import { useSheetA11y } from "@/lib/useSheetA11y";
import ConfirmDialog from "@/components/ConfirmDialog";
import BottomNav from "@/components/BottomNav";
import Spinner from "@/components/Spinner";
import AdviceDisclaimer from "@/components/AdviceDisclaimer";
import MoneyAdvisorChat, { MoneyAdvisorChatHandle } from "@/components/MoneyAdvisorChat";
import MoneyBasicCard from "@/components/MoneyBasicCard";
import { useAuth } from "@/components/AuthProvider";
import { usePreferences } from "@/components/PreferencesContext";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useHomePinnedCards } from "@/lib/useHomePinnedCards";
import {
  DebtGrowingCard, CreditCardsCard, DebtBurndownCard,
  calcMonthsFromPayment, debtFreeDate, fmt,
  DebtInsights, BurndownData,
} from "@/app/debt/DebtPage";
import TransportInsights from "@/components/TransportInsights";
import FuelSavingsCard from "@/components/FuelSavingsCard";
import TaxPage from "@/app/insights/tax/TaxPage";
import TaxChat from "@/components/TaxChat";
import SegmentedControl from "@/components/SegmentedControl";

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

const CATEGORY_COLOURS: Record<string, { bg: string; text: string }> = {
  energy:        { bg: "bg-amber-100 dark:bg-amber-900/40",   text: "text-amber-700 dark:text-amber-300" },
  mortgage:      { bg: "bg-blue-100 dark:bg-blue-900/40",     text: "text-blue-700 dark:text-blue-300" },
  car_finance:   { bg: "bg-cyan-100 dark:bg-cyan-900/40",     text: "text-cyan-700 dark:text-cyan-300" },
  car_insurance: { bg: "bg-red-100 dark:bg-red-900/40",       text: "text-red-700 dark:text-red-300" },
  broadband:     { bg: "bg-violet-100 dark:bg-violet-900/40", text: "text-violet-700 dark:text-violet-300" },
  mobile:        { bg: "bg-sky-100 dark:bg-sky-900/40",       text: "text-sky-700 dark:text-sky-300" },
  groceries:     { bg: "bg-green-100 dark:bg-green-900/40",   text: "text-green-700 dark:text-green-300" },
  eating_out:    { bg: "bg-orange-100 dark:bg-orange-900/40", text: "text-orange-700 dark:text-orange-300" },
  gym:           { bg: "bg-pink-100 dark:bg-pink-900/40",     text: "text-pink-700 dark:text-pink-300" },
  subscriptions: { bg: "bg-indigo-100 dark:bg-indigo-900/40", text: "text-indigo-700 dark:text-indigo-300" },
};

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
}: {
  labelOptions: Record<string, { icon: string; label: string }>;
  onNewInsight: () => void;
}) {
  const [bills, setBills] = useState<UnknownBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    api.getUnknownBills()
      .then(d => { setBills(d.unknown_bills); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function pick(merchantKey: string, category: string) {
    setSaving(merchantKey);
    try {
      await api.labelBill(merchantKey, category);
      setBills(prev => prev.filter(b => b.merchant_key !== merchantKey));
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
          <span className="text-base">🔍</span>
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Help us personalise your insights
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {bills.length} recurring bill{bills.length > 1 ? "s" : ""} we couldn't identify
            </p>
          </div>
        </div>
        <ChevronDown size={16} className={`flex-shrink-0 text-slate-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
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
                  <p className="text-[12px] text-slate-500 dark:text-slate-400">
                    £{bill.monthly_amount.toFixed(2)}/mo · {bill.occurrences} payments
                  </p>
                </div>
                <ChevronDown
                  size={16}
                  className={`flex-shrink-0 text-slate-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                />
              </button>

              {isOpen && (
                <div className="px-4 pb-4 space-y-2.5">
                  <p className="text-[12px] text-slate-500 dark:text-slate-400">What type of bill is this?</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {Object.entries(labelOptions).map(([key, opt]) => (
                      <button
                        key={key}
                        disabled={isSaving}
                        onClick={() => pick(bill.merchant_key, key)}
                        className="flex flex-col items-center gap-1 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-700/60 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 active:scale-95 transition-all disabled:opacity-40"
                      >
                        <span className="text-xl leading-none">{opt.icon}</span>
                        <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300 leading-tight text-center">
                          {opt.label}
                        </span>
                      </button>
                    ))}
                    <button
                      disabled={isSaving}
                      onClick={() => pick(bill.merchant_key, "skip")}
                      className="flex flex-col items-center gap-1 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-700/60 hover:bg-slate-100 dark:hover:bg-slate-600 active:scale-95 transition-all disabled:opacity-40"
                    >
                      <span className="text-xl leading-none">✕</span>
                      <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 leading-tight text-center">
                        Skip
                      </span>
                    </button>
                  </div>
                  {isSaving && (
                    <p className="text-[12px] text-indigo-500 flex items-center gap-1.5">
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
          ? { ...l, category, icon: labelOptions[category]?.icon ?? "💡", label: labelOptions[category]?.label ?? category, is_skip: category === "skip" }
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
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
      <button
        className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-base">🏷️</span>
          <div>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Your labelled bills</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{labels.length} bill{labels.length !== 1 ? "s" : ""} categorised</p>
          </div>
        </div>
        <ChevronDown size={16} className={`text-slate-400 flex-shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
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
                      <span className="text-sm">{lbl.icon}</span>
                      <span className={`text-[12px] text-slate-500 dark:text-slate-400 ${lbl.is_skip ? "italic" : ""}`}>
                        {lbl.is_skip ? "Skipped" : lbl.label}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setEditing(isEditing ? null : lbl.merchant_key)}
                    className="flex-shrink-0 text-[12px] font-medium text-indigo-600 dark:text-indigo-400 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
                  >
                    Edit
                  </button>
                </div>

                {isEditing && (
                  <div className="mt-3 space-y-2">
                    <p className="text-[12px] text-slate-500 dark:text-slate-400">Change category:</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {Object.entries(labelOptions).map(([key, opt]) => (
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
                          <span className="text-xl leading-none">{opt.icon}</span>
                          <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300 leading-tight text-center">
                            {opt.label}
                          </span>
                        </button>
                      ))}
                      <button
                        disabled={isSaving}
                        onClick={() => handleRelabel(lbl.merchant_key, "skip")}
                        className={`flex flex-col items-center gap-1 p-2.5 rounded-xl transition-all disabled:opacity-40 active:scale-95
                          ${lbl.is_skip
                            ? "bg-slate-100 dark:bg-slate-600 ring-1 ring-slate-400"
                            : "bg-slate-50 dark:bg-slate-700/60 hover:bg-slate-100 dark:hover:bg-slate-600"
                          }`}
                      >
                        <span className="text-xl leading-none">✕</span>
                        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 leading-tight text-center">
                          Skip
                        </span>
                      </button>
                    </div>
                    <button
                      disabled={isSaving}
                      onClick={() => handleDelete(lbl.merchant_key)}
                      className="text-[12px] text-red-500 dark:text-red-400 hover:underline disabled:opacity-40 mt-1"
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
              className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-all
                ${values[s.id] === opt
                  ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium"
                  : "border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700/50 text-slate-700 dark:text-slate-300"
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
          className={`w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700/50 text-base text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${s.type === "currency" ? "pl-8" : ""}`}
        />
        {s.unit && (
          <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">{s.unit}</span>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-white dark:bg-slate-900 rounded-t-3xl max-h-[90dvh] flex flex-col"
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
              <p className="text-[11px] font-semibold text-indigo-500 uppercase tracking-wide">
                {insight.icon} {insight.label}
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
                <div className="mb-4 px-3 py-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-900/25 text-[12px] text-indigo-700 dark:text-indigo-300">
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
            className="flex-shrink-0 px-5 pt-3 pb-6 border-t border-slate-100 dark:border-slate-700/50 bg-white dark:bg-slate-900"
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
                  Next <ArrowRight size={16} />
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
                className="w-full text-center text-[12px] text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-40 mt-3"
              >
                Save with answers so far
              </button>
            )}
          </div>
        )}
      </div>
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
  const colours = CATEGORY_COLOURS[insight.category] ?? { bg: "bg-slate-100 dark:bg-slate-700", text: "text-slate-600 dark:text-slate-400" };
  const [showTriggers, setShowTriggers] = useState(false);
  const [showWorkflow, setShowWorkflow] = useState(false);

  return (
    <>
      <div
        id={`insight-card-${insight.id}`}
        className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden scroll-mt-24 transition-shadow"
      >
        <div className="p-4 flex flex-col gap-3">
          {/* Category + badges + pin */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${colours.bg} ${colours.text}`}>
                {insight.icon} {insight.label}
              </span>
              {insight.is_new && (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 flex items-center gap-1">
                  <Sparkles size={10} /> New
                </span>
              )}
              {insight.user_context && (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                  Personalised
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

          {/* Title + body */}
          {/* Closure: the loop actually closed — celebrate, stop advising */}
          {insight.verified_savings ? (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-900/25 border border-emerald-200 dark:border-emerald-800">
              <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-emerald-800 dark:text-emerald-300 leading-snug">
                <span className="font-bold">You did it</span> — payments to {insight.verified_merchant} have stopped.
                That&apos;s ~£{insight.verified_savings.toLocaleString("en-GB", { maximumFractionDigits: 0 })}/mo staying in your pocket.
              </p>
            </div>
          ) : null}

          <p className="text-[15px] font-semibold text-slate-900 dark:text-slate-100 leading-snug">
            {insight.title}
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
            {insight.body}
          </p>

          {/* Savings + timestamp */}
          <div className="flex items-center justify-between">
            {insight.savings_estimate ? (
              <span className="text-[12px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-2.5 py-1 rounded-lg">
                {insight.savings_estimate}
              </span>
            ) : <span />}
            <span className="text-[11px] text-slate-500 dark:text-slate-400">{timeAgo(insight.refreshed_at)}</span>
          </div>

          {/* Comparison / deal links */}
          {CATEGORY_LINKS[insight.category] && (
            <div className="flex flex-wrap gap-2">
              {CATEGORY_LINKS[insight.category].map(link => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-2.5 py-1 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
                >
                  <ExternalLink size={10} />
                  {link.label}
                </a>
              ))}
            </div>
          )}

          {/* CTA — workflow */}
          {workflow && (
            <button
              onClick={() => setShowWorkflow(true)}
              className="w-full mt-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all"
            >
              <SlidersHorizontal size={14} />
              {insight.user_context ? "Update your details" : workflow.cta}
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
              <ChevronDown size={14} className={`text-slate-400 transition-transform duration-200 ${showTriggers ? "rotate-180" : ""}`} />
            </button>
            {showTriggers && (
              <div className="px-4 pb-3 space-y-1.5">
                {insight.triggered_by.map(t => (
                  <div key={t.merchant_key} className="flex items-center justify-between text-[12px]">
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

// ── Grocery receipt scanning ──────────────────────────────────────────────────

const CURRENCY_SYMBOLS: Record<string, string> = { GBP: "£", EUR: "€", USD: "$" };

function money(value: number | null, currency: string): string {
  if (value == null) return "—";
  const sym = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  return `${sym}${value.toFixed(2)}`;
}

// Downscale on the client so we send a lean image: smaller payload + the model
// reads a 1600px receipt fine, and we never ship a 12MP original.
function fileToScaledDataUrl(file: File, maxDim = 1600, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(reader.result as string); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function GroceryBasketCard() {
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [baskets, setBaskets] = useState<Basket[]>([]);
  const [insights, setInsights] = useState<BasketInsights | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [showTrends, setShowTrends] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const { pinned: pinnedCards, toggle: toggleCard } = useHomePinnedCards();
  const isGroceriesPinned = pinnedCards.includes("groceries");

  const loadInsights = () => api.basketInsights().then(setInsights).catch(() => {});

  useEffect(() => {
    api.listBaskets().then(setBaskets).catch(() => {});
    loadInsights();
  }, []);

  async function scanFile(file: File | Blob) {
    setError(null);
    setLoading(true);
    try {
      const dataUrl = await fileToScaledDataUrl(file as File);
      const basket = await api.scanReceipt(dataUrl);
      setBaskets((prev) => [basket, ...prev]);
      setExpanded(basket.id);
      loadInsights();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't scan that receipt");
    } finally {
      setLoading(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await scanFile(file);
  }

  // Inside the app shell, use the native camera via the message bridge — the
  // WebView's file-input camera is unreliable across Android versions.
  function takePhoto() {
    const rn = (window as unknown as { ReactNativeWebView?: { postMessage: (s: string) => void } }).ReactNativeWebView;
    if (!rn) { cameraRef.current?.click(); return; }
    const id = Math.random().toString(36).slice(2);
    const onResult = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || detail.id !== id) return;
      window.removeEventListener("native-camera", onResult);
      if (detail.error === "cancelled") return;
      if (detail.error || !detail.base64) { cameraRef.current?.click(); return; } // fall back to the input route
      const bytes = atob(detail.base64);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      scanFile(new Blob([arr], { type: detail.mime || "image/jpeg" }));
    };
    window.addEventListener("native-camera", onResult);
    rn.postMessage(JSON.stringify({ type: "camera:request", id }));
    // Safety: stop listening if the shell never answers (old app build)
    setTimeout(() => window.removeEventListener("native-camera", onResult), 60_000);
  }

  async function remove(id: string) {
    setBaskets((prev) => prev.filter((b) => b.id !== id));
    if (expanded === id) setExpanded(null);
    try { await api.deleteBasket(id); } catch { /* best-effort */ }
    loadInsights();
  }

  const hasTrends = !!insights && (insights.item_trends.length > 0 || insights.store_prices.length > 0);
  const visibleBaskets = showAll ? baskets : baskets.slice(0, 3);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center gap-1">
        <button
          onClick={() => setCardOpen((v) => !v)}
          aria-expanded={cardOpen}
          className="flex-1 flex items-center gap-2 text-left min-w-0"
        >
          <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0">
            <Receipt size={16} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="text-[15px] font-semibold text-slate-900 dark:text-slate-100 flex-1">Groceries</p>
          {insights && insights.receipt_count > 0 && (
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {insights.receipt_count} receipt{insights.receipt_count === 1 ? "" : "s"}
            </span>
          )}
          <ChevronDown
            size={18}
            className={`text-slate-400 flex-shrink-0 transition-transform ${cardOpen ? "rotate-180" : ""}`}
          />
        </button>
        <button
          onClick={() => toggleCard("groceries")}
          title={isGroceriesPinned ? "Unpin from Home" : "Pin to Home"}
          aria-label={isGroceriesPinned ? "Unpin from Home" : "Pin to Home"}
          className={`w-9 h-9 flex items-center justify-center rounded-full transition-colors flex-shrink-0 ${isGroceriesPinned ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-500" : "text-slate-300 dark:text-slate-600 hover:text-indigo-400"}`}
        >
          <Pin size={13} className={isGroceriesPinned ? "fill-indigo-400" : ""} />
        </button>
      </div>

      {!cardOpen ? (
        <div
          className={`flex items-center gap-2 mt-2 px-3 py-2 rounded-xl ${
            insights?.headline ? "bg-emerald-50 dark:bg-emerald-900/30" : "bg-slate-50 dark:bg-slate-900/60"
          }`}
        >
          {insights?.headline ? (
            <>
              <TrendingUp size={15} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
              <span className="text-[12px] font-medium text-emerald-800 dark:text-emerald-200 flex-1 min-w-0 truncate">{insights.headline}</span>
            </>
          ) : (
            <span className="text-[12px] font-medium text-slate-500 dark:text-slate-400 flex-1">Snap a receipt to track grocery prices</span>
          )}
        </div>
      ) : (
      <>

      {insights?.headline ? (
        <button
          onClick={() => hasTrends && setShowTrends((v) => !v)}
          className="w-full flex items-center gap-2 mt-3 mb-4 px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 text-left"
        >
          <TrendingUp size={15} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
          <span className="text-[12px] font-medium text-emerald-800 dark:text-emerald-200 flex-1 min-w-0">
            {insights.headline}
          </span>
          {hasTrends && (
            <ChevronDown
              size={14}
              className={`text-emerald-600 dark:text-emerald-400 flex-shrink-0 transition-transform ${showTrends ? "rotate-180" : ""}`}
            />
          )}
        </button>
      ) : (
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-3 mb-4 leading-relaxed">
          Snap a receipt and we&apos;ll itemise it, then track how prices change over
          time and which shop is cheapest for what you buy.
        </p>
      )}

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onFile}
      />
      <input
        ref={uploadRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFile}
      />
      {loading ? (
        <div className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-sm font-semibold text-white opacity-60">
          <Camera size={16} />
          Reading receipt…
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={takePhoto}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-sm font-semibold text-white transition-all active:scale-95"
          >
            <Camera size={16} />
            Take photo
          </button>
          <button
            onClick={() => uploadRef.current?.click()}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-emerald-400/60 dark:border-emerald-400/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-sm font-semibold text-emerald-700 dark:text-emerald-200 transition-all active:scale-95"
          >
            <ImageIcon size={16} />
            Upload
          </button>
        </div>
      )}

      {error && <p className="text-xs text-rose-500 mt-2">{error}</p>}

      {showTrends && insights && (
        <div className="mt-4 space-y-3">
          {insights.store_prices.length > 0 && (
            <div>
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">
                <Store size={12} /> Cheaper elsewhere
              </p>
              <ul className="space-y-1.5">
                {insights.store_prices.map((s) => (
                  <li key={s.key} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[12px] text-slate-700 dark:text-slate-300 truncate">{s.name}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {money(s.cheapest_price, s.currency)} at {s.cheapest_store} · {money(s.dearest_price, s.currency)} at {s.dearest_store}
                      </p>
                    </div>
                    <span className="text-[12px] font-semibold text-emerald-500 flex-shrink-0">
                      save {money(s.saving, s.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {insights.item_trends.length > 0 && (
            <div>
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">
                <TrendingUp size={12} /> Price changes
              </p>
              <ul className="space-y-1.5">
                {insights.item_trends.map((t) => {
                  const up = t.pct_change > 0;
                  return (
                    <li key={t.key} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[12px] text-slate-700 dark:text-slate-300 truncate">{t.name}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {money(t.previous, t.currency)} → {money(t.latest, t.currency)}{t.store ? ` · ${t.store}` : ""}
                        </p>
                      </div>
                      <span className={`text-[12px] font-semibold flex-shrink-0 ${up ? "text-rose-500" : "text-emerald-500"}`}>
                        {up ? "+" : ""}{t.pct_change}%
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      {baskets.length > 0 && (
        <ul className="mt-4 space-y-2">
          {visibleBaskets.map((b) => {
            const open = expanded === b.id;
            return (
              <li key={b.id} className="rounded-xl border border-slate-100 dark:border-slate-700 overflow-hidden">
                <div className="flex items-center gap-2 p-3">
                  <button
                    onClick={() => setExpanded(open ? null : b.id)}
                    className="flex-1 flex items-center gap-2 min-w-0 text-left"
                  >
                    <ChevronDown
                      size={15}
                      className={`text-slate-400 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {b.shop || "Receipt"}
                        <span className="ml-1.5 text-[11px] font-normal text-slate-500 dark:text-slate-400">
                          {b.item_count} item{b.item_count === 1 ? "" : "s"}
                        </span>
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {b.purchased_at
                          ? <>{b.purchased_at}{b.date_estimated && <span className="italic"> · estimated</span>}</>
                          : "Date unknown"}
                      </p>
                    </div>
                  </button>
                  <span className="text-sm font-bold text-slate-900 dark:text-slate-100 flex-shrink-0">
                    {money(b.total, b.currency)}
                  </span>
                  <button
                    onClick={() => setPendingDeleteId(b.id)}
                    className="p-2.5 text-slate-300 hover:text-rose-500 flex-shrink-0"
                    aria-label="Delete receipt"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                {open && (
                  <ul className="px-3 pb-3 pt-0 space-y-1 border-t border-slate-100 dark:border-slate-700">
                    {b.items.map((it, i) => (
                      <li key={i} className="flex items-center justify-between gap-2 pt-1.5">
                        <div className="min-w-0">
                          <p className="text-[12px] text-slate-700 dark:text-slate-300 truncate">
                            {it.qty > 1 && <span className="text-slate-500 dark:text-slate-400">{it.qty}× </span>}
                            {it.name}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">{it.category}</p>
                        </div>
                        <span className="text-[12px] font-medium text-slate-700 dark:text-slate-300 flex-shrink-0">
                          {money(it.line_price ?? it.unit_price, b.currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {baskets.length > 3 && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="mt-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400"
        >
          {showAll ? "Show less" : `See all ${baskets.length} receipts`}
        </button>
      )}
      </>
      )}
      <ConfirmDialog
        open={pendingDeleteId !== null}
        destructive
        title="Delete receipt?"
        message="Remove this scanned receipt? This can't be undone."
        confirmLabel="Delete"
        onConfirm={() => { const id = pendingDeleteId!; setPendingDeleteId(null); remove(id); }}
        onCancel={() => setPendingDeleteId(null)}
      />
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
    api.getUnknownBills().then(d => setLabelOptions(d.label_options)).catch(() => {});
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
        <div className="px-1 flex items-center justify-between gap-3">
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
            Personalised ways to spend less. Start with the top one.
          </p>
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

      {/* Identify unknown bills */}
      <UnknownBillsPanel labelOptions={labelOptions} onNewInsight={loadInsights} />

      {/* Review / edit existing labels */}
      <LabelledBillsPanel labelOptions={labelOptions} onRelabelled={loadInsights} />

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
                <span className="w-4 h-4 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center flex-shrink-0 text-[10px] text-indigo-600 dark:text-indigo-300 font-bold">✓</span>
                {f}
              </div>
            ))}
            <div className="pt-2">
              <p className="text-[12px] text-slate-500 dark:text-slate-400 text-center">From £5.99/month · Cancel anytime</p>
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
          <span className="text-5xl">💡</span>
          <div>
            <p className="text-[15px] font-semibold text-slate-700 dark:text-slate-300">No insights yet</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Tap Refresh to search for savings based on your transactions</p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing || refreshQueued}
            className="mt-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-[14px] font-semibold disabled:opacity-50"
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
    </div>
  );
}

// ── Debt-free Plan Card ───────────────────────────────────────────────────────

function NextHundredCard({ debtTotal, savings, incomeBracket, sym, hideValues }: {
  debtTotal: number;
  savings: SavingsInsights | null;
  incomeBracket: string;
  sym: string;
  hideValues: boolean;
}) {
  const [open, setOpen] = useState(false);

  const monthlySpend = savings?.monthly_spending ?? 0;
  const currentNet   = savings?.current_savings ?? 0;
  // Starter buffer: 1 month of spending before attacking debt, so a surprise
  // bill doesn't become new card debt.
  const bufferTarget = monthlySpend;
  const bufferGap    = Math.max(0, bufferTarget - currentNet);
  const highEarner   = incomeBracket === "100k_125k" || incomeBracket === "125k_plus";

  const steps: { title: string; why: string }[] = [];
  if (monthlySpend > 0 && bufferGap > 0) {
    steps.push({
      title: "Starter buffer",
      why: `Get your safety net to 1 month of spending${hideValues ? "" : ` — ${fmt(bufferGap, sym)} to go`}. Without it, a surprise bill lands on a credit card.`,
    });
  }
  if (debtTotal > 0) {
    steps.push({
      title: "Credit card debt",
      why: "Cards typically charge 20%+ APR, so £100 here reliably saves £20+/yr — a better guaranteed return than any savings account.",
    });
  }
  if (highEarner) {
    steps.push({
      title: "Pension contributions",
      why: "In the £100k–£125k band, £100 into your pension effectively costs ~£40 after tax relief and allowance restoration.",
    });
  }
  if (savings && savings.target_amount > 0 && currentNet < savings.target_amount && bufferGap <= 0) {
    steps.push({
      title: "Full safety net",
      why: `Top up to your ${savings.target_months ?? 3}-month goal, then surplus can go to investments.`,
    });
  }

  if (steps.length < 2) return null; // nothing to arbitrate

  const [first, ...rest] = steps.slice(0, 3);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
      <button className="w-full text-left px-4 py-3" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Where should your next {sym}100 go?
          </p>
          <ChevronRight size={14} className={`text-slate-400 transition-transform ${open ? "rotate-90" : ""}`} />
        </div>
        <div className="flex items-start gap-2 mt-1.5">
          <span className="mt-0.5 w-4 h-4 rounded-full bg-indigo-600 text-white text-[9px] font-bold flex items-center justify-center flex-shrink-0">1</span>
          <div>
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{first.title}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-snug mt-0.5">{first.why}</p>
          </div>
        </div>
      </button>
      {open && rest.length > 0 && (
        <div className="px-4 pb-3 space-y-2 border-t border-slate-100 dark:border-slate-700 pt-2.5">
          {rest.map((s, i) => (
            <div key={s.title} className="flex items-start gap-2">
              <span className="mt-0.5 w-4 h-4 rounded-full bg-slate-300 dark:bg-slate-600 text-white text-[9px] font-bold flex items-center justify-center flex-shrink-0">{i + 2}</span>
              <div>
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{s.title}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-snug">{s.why}</p>
              </div>
            </div>
          ))}
          <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-1">
            One order, all tabs — buffer first, then the most expensive debt, then tax-advantaged saving.
          </p>
        </div>
      )}
    </div>
  );
}


function ProgressRing({ pct, accent }: { pct: number; accent: string }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative flex-shrink-0" style={{ width: 52, height: 52 }}>
      <svg width="52" height="52" className="-rotate-90">
        <circle cx="26" cy="26" r={r} fill="none" strokeWidth="5" className="stroke-slate-100 dark:stroke-slate-700" />
        <circle
          cx="26" cy="26" r={r} fill="none" strokeWidth="5" stroke={accent} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c}
          style={{ transition: "stroke-dashoffset 0.5s ease" }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[12px] font-bold text-slate-700 dark:text-slate-200">
        {pct}%
      </span>
    </div>
  );
}

function PlanCard({
  plan, sym, accent, hideValues, onToggleStep, onDeleteStep, onOpenChat, onDelete,
}: {
  plan: DebtPlan | null;
  sym: string;
  accent: string;
  hideValues: boolean;
  onToggleStep: (id: string, done: boolean) => void;
  onDeleteStep: (id: string) => void;
  onOpenChat: (prompt: string) => void;
  onDelete: () => void;
}) {
  if (!plan) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${accent}1a` }}>
            <Target className="w-5 h-5" style={{ color: accent }} />
          </div>
          <div className="flex-1">
            <p className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">Make a plan that sticks</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
              Writing down a few concrete steps makes debt easier to clear. Build a short, trackable plan with your advisor.
            </p>
          </div>
        </div>
        <button
          onClick={() => onOpenChat("Build me a debt-free plan I can track, with a few milestones.")}
          className="w-full mt-3 py-2.5 rounded-xl text-white text-[14px] font-semibold active:scale-[0.98] transition-all"
          style={{ background: accent }}
        >
          Build my debt-free plan
        </button>
      </div>
    );
  }

  const pct = plan.total_count > 0 ? Math.round((plan.done_count / plan.total_count) * 100) : 0;
  const allDone = plan.total_count > 0 && plan.done_count === plan.total_count;
  const nextIdx = plan.milestones.findIndex(m => !m.done);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
      <div className="p-4 flex items-center gap-4">
        <ProgressRing pct={pct} accent={accent} />
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">
            {allDone ? "Plan complete! 🎉" : "Your debt-free plan"}
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {allDone
              ? "Every milestone done — incredible work."
              : `${plan.done_count} of ${plan.total_count} done${nextIdx >= 0 ? " — keep going!" : ""}`}
          </p>
        </div>
      </div>

      <div className="px-3 pb-2 space-y-1">
        {plan.milestones.map((m, i) => {
          const isNext = i === nextIdx;
          const auto = m.type === "payment";
          return (
            <div
              key={m.id}
              className={`group flex items-start gap-1 px-1 rounded-xl transition-colors ${
                isNext ? "bg-slate-50 dark:bg-slate-700/50" : ""
              }`}
            >
              <button
                disabled={auto}
                onClick={() => !auto && onToggleStep(m.id, !m.done)}
                className={`flex flex-1 min-w-0 items-start gap-2.5 text-left px-1.5 py-2 ${auto ? "cursor-default" : "active:scale-[0.99]"}`}
              >
                {m.done
                  ? <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: accent }} />
                  : <Circle className="w-5 h-5 flex-shrink-0 mt-0.5 text-slate-300 dark:text-slate-600" />}
                <span className="flex-1 min-w-0">
                  <span className={`block text-sm leading-snug ${m.done ? "text-slate-500 dark:text-slate-400 line-through" : "text-slate-700 dark:text-slate-200"}`}>
                    {m.text}
                  </span>
                  {auto && m.target_balance != null && (
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Auto-tracked · target {hideValues ? "••••" : fmt(m.target_balance, sym)}
                    </span>
                  )}
                  {!auto && m.live_target != null && m.live_spend != null && (
                    <span className={`block text-[11px] mt-0.5 font-medium ${
                      m.live_spend > m.live_target
                        ? "text-red-500 dark:text-red-400"
                        : m.live_spend > m.live_target * 0.8
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-emerald-600 dark:text-emerald-400"
                    }`}>
                      {hideValues ? "••••" : fmt(m.live_spend, sym)} on {m.live_category} this month · target {hideValues ? "••••" : fmt(m.live_target, sym)}
                    </span>
                  )}
                </span>
              </button>
              <button
                onClick={() => onDeleteStep(m.id)}
                aria-label="Remove goal"
                className="flex-shrink-0 mt-1.5 p-2.5 rounded-lg text-slate-300 dark:text-slate-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="px-4 pb-3 pt-1 flex items-center justify-between border-t border-slate-50 dark:border-slate-700/60">
        <button onClick={() => onOpenChat("I want to add a goal to my plan. Help me make it realistic, then add it.")} className="text-xs font-medium pt-2" style={{ color: accent }}>
          Add a goal
        </button>
        <button onClick={onDelete} className="text-xs text-slate-400 hover:text-red-500 transition-colors flex items-center gap-1 pt-2">
          <Trash2 size={12} /> Delete
        </button>
      </div>
    </div>
  );
}

// ── Safety-net (emergency fund) Card ──────────────────────────────────────────

function fmtMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

function ReadyToGrowCard({ onOpenChat }: { onOpenChat: (p: string) => void }) {
  const [topics, setTopics] = useState<MoneyBasic[]>([]);

  useEffect(() => {
    api.getMoneyBasics("grow").then((r) => setTopics(r.items.slice(0, 3))).catch(() => {});
  }, []);

  return (
    <div className="rounded-2xl shadow-sm overflow-hidden bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800">
      <div className="p-5">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={16} className="text-emerald-600 dark:text-emerald-400" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Next step</span>
        </div>
        <p className="text-[17px] font-bold leading-snug text-slate-900 dark:text-slate-100">Your safety net is funded — ready to grow?</p>
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mt-1.5">
          With your cushion in place and no expensive debt, the next stage is putting spare money to work — tax-free, using your UK allowances.
        </p>

        {topics.length > 0 && (
          <div className="mt-3.5 space-y-1.5">
            {topics.map((t) => (
              <div key={t.id} className="flex items-center gap-2.5 bg-emerald-100/70 dark:bg-emerald-900/50 rounded-xl px-3 py-2">
                <span className="text-base leading-none">{t.icon}</span>
                <p className="text-sm font-medium leading-snug text-slate-800 dark:text-slate-200">{t.title}</p>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={() => onOpenChat("I've built my emergency fund and I'm debt-free. How should I start investing and using ISAs to grow my money in the UK?")}
          className="w-full mt-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl py-2.5 text-[14px] font-semibold active:scale-[0.99] transition-all"
        >
          Explore growing your money
        </button>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2.5 text-center">General information, not financial advice.</p>
      </div>
    </div>
  );
}

function SafetyNetCard({
  data, sym, hideValues, onSaved, debtTotal = 0,
}: {
  data: SavingsInsights | null;
  sym: string;
  hideValues: boolean;
  onSaved: () => void;
  debtTotal?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [targetChoice, setTargetChoice] = useState<"3" | "6" | "custom">("3");
  const [customAmount, setCustomAmount] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualEditId, setManualEditId] = useState<string | null>(null);
  const [manualName, setManualName] = useState("");
  const [manualBalance, setManualBalance] = useState("");
  const [savingManual, setSavingManual] = useState(false);
  const [acctsOpen, setAcctsOpen] = useState(false);

  const openAddManual = () => { setManualEditId(null); setManualName(""); setManualBalance(""); setShowManualForm(true); };
  const openEditManual = (a: SavingsAccountOption) => { setManualEditId(a.account_id); setManualName(a.name); setManualBalance(String(a.balance)); setShowManualForm(true); };

  async function saveManual() {
    const name = manualName.trim();
    const bal = Number(manualBalance);
    if (!name || isNaN(bal) || bal < 0) return;
    setSavingManual(true);
    try {
      if (manualEditId) {
        await api.updateSavingsManualAccount(manualEditId, { name, balance: bal });
      } else {
        const before = new Set((data?.accounts ?? []).map(a => a.account_id));
        const res = await api.addSavingsManualAccount({ name, balance: bal });
        const created = res.accounts.find(a => !before.has(a.account_id));
        if (created) setSelected(s => s.includes(created.account_id) ? s : [...s, created.account_id]);
      }
      setShowManualForm(false);
      setManualEditId(null);
      setManualName("");
      setManualBalance("");
      onSaved();
    } catch {} finally { setSavingManual(false); }
  }

  async function removeManual(id: string) {
    try {
      await api.deleteSavingsManualAccount(id);
      setSelected(s => s.filter(x => x !== id));
      onSaved();
    } catch {}
  }

  const beginSetup = () => {
    setSelected(data?.accounts.filter(a => a.selected).map(a => a.account_id) ?? []);
    if (data?.target_type === "amount") { setTargetChoice("custom"); setCustomAmount(String(data.target_amount || "")); }
    else if (data?.target_months === 6) setTargetChoice("6");
    else setTargetChoice("3");
    setEditing(true);
  };

  if (!data) {
    return <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4"><div className="h-20 animate-pulse bg-slate-50 dark:bg-slate-700/40 rounded-xl" /></div>;
  }

  const showSetup = !data.configured || editing;

  async function save() {
    if (selected.length === 0) return;
    setSaving(true);
    try {
      const body: SavingsGoalInput = targetChoice === "custom"
        ? { target_type: "amount", target_amount: Number(customAmount) || 0, account_ids: selected }
        : { target_type: "months", target_months: targetChoice === "6" ? 6 : 3, account_ids: selected };
      await api.saveSavingsGoal(body);
      setEditing(false);
      onSaved();
    } catch {} finally { setSaving(false); }
  }

  if (showSetup) {
    const toggle = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
    const customInvalid = targetChoice === "custom" && (!Number(customAmount) || Number(customAmount) <= 0);
    return (
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-emerald-100 dark:bg-emerald-900/30">
            <Shield className="w-5 h-5 text-emerald-600" />
          </div>
          <div className="flex-1">
            <p className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">Build your safety net</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
              An emergency fund of 3–6 months&rsquo; spending protects you from surprises. Pick a target and the accounts that hold it.
            </p>
          </div>
        </div>

        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-4 mb-2">Target size</p>
        <div className="flex gap-2">
          {([["3", "3 months"], ["6", "6 months"], ["custom", "Custom"]] as const).map(([v, label]) => (
            <button key={v} onClick={() => setTargetChoice(v)}
              className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                targetChoice === v ? "bg-emerald-600 text-white border-emerald-600" : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300"}`}>
              {label}
            </button>
          ))}
        </div>
        {targetChoice !== "custom" && data.monthly_spending > 0 && (
          <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-1.5">
            ≈ {hideValues ? "••••" : fmt((targetChoice === "6" ? 6 : 3) * data.monthly_spending, sym)} based on your spending
          </p>
        )}
        {targetChoice === "custom" && (
          <div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2">
            <span className="text-slate-400 text-sm">{sym.trim() || sym}</span>
            <input type="number" inputMode="decimal" value={customAmount}
              onChange={e => setCustomAmount(e.target.value)} placeholder="Amount"
              className="flex-1 bg-transparent text-sm outline-none text-slate-900 dark:text-slate-100" />
          </div>
        )}

        <button type="button" onClick={() => setAcctsOpen(o => !o)} aria-expanded={acctsOpen} className="w-full flex items-center justify-between mt-4 mb-2">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Accounts holding your savings{selected.length > 0 ? ` · ${selected.length} selected` : ""}
          </span>
          <ChevronDown size={16} className={`text-slate-400 transition-transform ${acctsOpen ? "rotate-180" : ""}`} />
        </button>
        {!acctsOpen && selected.length === 0 && (
          <p className="text-[12px] text-slate-500 dark:text-slate-400 mb-1">Tap to choose where you keep your savings.</p>
        )}
        {acctsOpen && (<>
        <div className="space-y-1.5">
          {data.accounts.map(a => {
            const on = selected.includes(a.account_id);
            return (
              <div key={a.account_id} className="flex items-center gap-1">
                <button onClick={() => toggle(a.account_id)}
                  className="flex-1 min-w-0 flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-left transition-colors"
                  style={on ? { borderColor: "#059669", background: "#05966910" } : undefined}>
                  {on ? <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" /> : <Circle className="w-5 h-5 text-slate-300 dark:text-slate-600 flex-shrink-0" />}
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{a.name}</span>
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400">{a.manual ? "Offline account" : a.provider}</span>
                  </span>
                  <span className="text-sm font-semibold text-slate-600 dark:text-slate-300">{hideValues ? "••••" : fmt(a.balance, sym)}</span>
                </button>
                {a.manual && (
                  <>
                    <button onClick={() => openEditManual(a)} aria-label="Edit account" className="flex-shrink-0 p-2.5 text-slate-400 hover:text-emerald-600 transition-colors"><Pencil size={14} /></button>
                    <button onClick={() => removeManual(a.account_id)} aria-label="Remove account" className="flex-shrink-0 p-2.5 text-slate-400 hover:text-red-500 transition-colors"><X size={14} /></button>
                  </>
                )}
              </div>
            );
          })}
          {data.accounts.length === 0 && !showManualForm && (
            <p className="text-sm text-slate-500 dark:text-slate-400">No connected accounts. Add an offline account to track savings you hold elsewhere.</p>
          )}
        </div>

        {showManualForm ? (
          <div className="mt-2 rounded-xl border border-slate-200 dark:border-slate-600 p-3 space-y-2">
            <input value={manualName} onChange={e => setManualName(e.target.value)} placeholder="Account name (e.g. Cash ISA)" maxLength={60}
              className="w-full bg-transparent text-sm outline-none text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-600 pb-1.5" />
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2">
              <span className="text-slate-400 text-sm">{sym.trim() || sym}</span>
              <input type="number" inputMode="decimal" value={manualBalance} onChange={e => setManualBalance(e.target.value)} placeholder="Current balance"
                className="flex-1 bg-transparent text-sm outline-none text-slate-900 dark:text-slate-100" />
            </div>
            <div className="flex gap-2 pt-0.5">
              <button onClick={() => { setShowManualForm(false); setManualEditId(null); }} className="px-3 py-2 rounded-lg text-sm font-semibold text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600">Cancel</button>
              <button onClick={saveManual} disabled={!manualName.trim() || !manualBalance || isNaN(Number(manualBalance)) || Number(manualBalance) < 0 || savingManual}
                className="flex-1 py-2 rounded-lg text-white text-sm font-semibold bg-emerald-600 disabled:opacity-40 active:scale-[0.98] transition-all">
                {savingManual ? "Saving…" : manualEditId ? "Save changes" : "Add account"}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={openAddManual} className="mt-2 flex items-center gap-1 text-sm font-medium text-emerald-600">
            <Plus size={14} /> Add an offline account
          </button>
        )}
        </>)}

        <div className="flex gap-2 mt-4">
          {data.configured && (
            <button onClick={() => setEditing(false)} className="px-4 py-2.5 rounded-xl text-[14px] font-semibold text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600">
              Cancel
            </button>
          )}
          <button onClick={save} disabled={selected.length === 0 || customInvalid || saving}
            className="flex-1 py-2.5 rounded-xl text-white text-[14px] font-semibold bg-emerald-600 disabled:opacity-40 active:scale-[0.98] transition-all">
            {saving ? "Saving…" : data.configured ? "Update target" : "Start tracking"}
          </button>
        </div>
      </div>
    );
  }

  const pct = Math.round(data.pct_funded);
  const funded = data.target_amount > 0 && data.current_savings >= data.target_amount;
  const unsizedGoal = data.target_type === "months" && data.target_amount <= 0;
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
      <div className="p-4 flex items-center gap-4">
        <ProgressRing pct={pct} accent="#059669" />
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">
            {funded ? "Safety net funded 🎉" : "Your safety net"}
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {unsizedGoal ? (
              <>{hideValues ? "••••" : fmt(data.current_savings, sym)} saved</>
            ) : (
              <>
                {hideValues ? "••••" : fmt(data.current_savings, sym)} of {hideValues ? "••••" : fmt(data.target_amount, sym)}
                {data.target_type === "months" && data.target_months ? ` · ${data.target_months}-month goal` : ""}
              </>
            )}
          </p>
        </div>
        <button onClick={beginSetup} aria-label="Edit target" className="text-[12px] font-medium text-emerald-600 flex-shrink-0">Edit</button>
      </div>

      <div className="px-4 pb-4 space-y-2">
        {unsizedGoal && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            A {data.target_months ?? 6}-month goal is sized from your spending, but there isn&rsquo;t enough spending history yet to set the amount. Tap <span className="font-semibold text-emerald-600">Edit</span> to choose a specific {sym.trim() || sym} target.
          </p>
        )}
        {!unsizedGoal && data.months_funded > 0 && (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Your safety net alone covers <span className="font-semibold">{data.months_funded.toFixed(1)} months</span> of spending
            — separate from the cash runway on your home screen, which counts all your cash.
          </p>
        )}
        {!funded && data.monthly_surplus > 0 && data.funded_date && data.months_to_target < 999 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {debtTotal > 0 ? (
              <>
                If your whole surplus of {hideValues ? "••••" : fmt(data.monthly_surplus, sym)}/mo went here, fully funded by{" "}
                <span className="font-semibold text-emerald-600">{fmtMonth(data.funded_date)}</span> — but clearing
                your cards first (as recommended above) pushes this later.
              </>
            ) : (
              <>
                At your current surplus of {hideValues ? "••••" : fmt(data.monthly_surplus, sym)}/mo, fully funded by{" "}
                <span className="font-semibold text-emerald-600">{fmtMonth(data.funded_date)}</span>.
              </>
            )}
          </p>
        )}
        {!funded && data.monthly_surplus <= 0 && (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            You&rsquo;re spending about as much as you earn, so your safety net isn&rsquo;t growing yet. Trimming spending will start building it.
          </p>
        )}
        {funded && (
          <p className="text-sm text-emerald-600 dark:text-emerald-400">
            You&rsquo;ve hit your target — consider investing surplus beyond this cushion.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Savings Plan Card ─────────────────────────────────────────────────────────

function SavingsPlanCard({
  plan, sym, accent, hideValues, onToggleStep, onDeleteStep, onOpenChat, onDelete,
}: {
  plan: SavingsPlan | null;
  sym: string;
  accent: string;
  hideValues: boolean;
  onToggleStep: (id: string, done: boolean) => void;
  onDeleteStep: (id: string) => void;
  onOpenChat: (prompt: string) => void;
  onDelete: () => void;
}) {
  if (!plan) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${accent}1a` }}>
            <Target className="w-5 h-5" style={{ color: accent }} />
          </div>
          <div className="flex-1">
            <p className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">Make a savings plan that sticks</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
              Breaking your goal into small milestones makes it easier to stay on track. Build a short, trackable plan with your advisor.
            </p>
          </div>
        </div>
        <button
          onClick={() => onOpenChat("Build me a savings plan I can track, with a few milestones to grow my safety net.")}
          className="w-full mt-3 py-2.5 rounded-xl text-white text-[14px] font-semibold active:scale-[0.98] transition-all"
          style={{ background: accent }}
        >
          Build my savings plan
        </button>
      </div>
    );
  }

  const pct = plan.total_count > 0 ? Math.round((plan.done_count / plan.total_count) * 100) : 0;
  const allDone = plan.total_count > 0 && plan.done_count === plan.total_count;
  const nextIdx = plan.milestones.findIndex(m => !m.done);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
      <div className="p-4 flex items-center gap-4">
        <ProgressRing pct={pct} accent={accent} />
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">
            {allDone ? "Plan complete! 🎉" : "Your savings plan"}
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {allDone ? "Every milestone done — incredible work." : `${plan.done_count} of ${plan.total_count} done${nextIdx >= 0 ? " — keep going!" : ""}`}
          </p>
        </div>
      </div>

      <div className="px-3 pb-2 space-y-1">
        {plan.milestones.map((m, i) => {
          const isNext = i === nextIdx;
          const auto = m.type === "savings";
          return (
            <div key={m.id} className={`group flex items-start gap-1 px-1 rounded-xl transition-colors ${isNext ? "bg-slate-50 dark:bg-slate-700/50" : ""}`}>
              <button disabled={auto} onClick={() => !auto && onToggleStep(m.id, !m.done)}
                className={`flex flex-1 min-w-0 items-start gap-2.5 text-left px-1.5 py-2 ${auto ? "cursor-default" : "active:scale-[0.99]"}`}>
                {m.done
                  ? <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: accent }} />
                  : <Circle className="w-5 h-5 flex-shrink-0 mt-0.5 text-slate-300 dark:text-slate-600" />}
                <span className="flex-1 min-w-0">
                  <span className={`block text-sm leading-snug ${m.done ? "text-slate-500 dark:text-slate-400 line-through" : "text-slate-700 dark:text-slate-200"}`}>
                    {m.text}
                  </span>
                  {auto && m.target_balance != null && (
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Auto-tracked · target {hideValues ? "••••" : fmt(m.target_balance, sym)}
                    </span>
                  )}
                  {!auto && m.live_target != null && m.live_spend != null && (
                    <span className={`block text-[11px] mt-0.5 font-medium ${
                      m.live_spend > m.live_target
                        ? "text-red-500 dark:text-red-400"
                        : m.live_spend > m.live_target * 0.8
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-emerald-600 dark:text-emerald-400"
                    }`}>
                      {hideValues ? "••••" : fmt(m.live_spend, sym)} on {m.live_category} this month · target {hideValues ? "••••" : fmt(m.live_target, sym)}
                    </span>
                  )}
                </span>
              </button>
              <button onClick={() => onDeleteStep(m.id)} aria-label="Remove goal"
                className="flex-shrink-0 mt-1.5 p-2.5 rounded-lg text-slate-300 dark:text-slate-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="px-4 pb-3 pt-1 flex items-center justify-between border-t border-slate-50 dark:border-slate-700/60">
        <button onClick={() => onOpenChat("I want to add a milestone to my savings plan. Help me make it realistic, then add it.")} className="text-xs font-medium pt-2" style={{ color: accent }}>
          Add a milestone
        </button>
        <button onClick={onDelete} className="text-xs text-slate-400 hover:text-red-500 transition-colors flex items-center gap-1 pt-2">
          <Trash2 size={12} /> Delete
        </button>
      </div>
    </div>
  );
}

// ── Page (merged advisory view) ───────────────────────────────────────────────

export default function InsightsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { hideNetWorth, region, debtTargetMonths, setDebtTargetMonths, debtTrackingStart, setDebtTrackingStart } = usePreferences();
  const sym = region === "Kenya" ? "KES " : "£";

  const [insights, setInsights] = useState<DebtInsights | null>(null);
  const [burndown, setBurndown] = useState<BurndownData | null>(null);
  const [strategy, setStrategy] = useState<"avalanche" | "snowball" | "costliest">("avalanche");
  const [burndownMode, setBurndownMode] = useState<"time" | "amount">("time");
  const [monthlyPaymentInput, setMonthlyPaymentInput] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [isPro, setIsPro] = useState<boolean | null>(null);
  const [tab, setTab] = useState<"plan" | "savings" | "transport" | "tax">("plan");
  const [incomeBracket, setIncomeBracket] = useState("");
  const [taxIncomeValue, setTaxIncomeValue] = useState(0);
  const [taxPensionAnnual, setTaxPensionAnnual] = useState(0);
  const [taxHasChildBenefit, setTaxHasChildBenefit] = useState(false);
  const [taxPrefsLoaded, setTaxPrefsLoaded] = useState(false);
  const [hasTransport, setHasTransport] = useState(true);
  const [plan, setPlan] = useState<DebtPlan | null>(null);
  const [savings, setSavings] = useState<SavingsInsights | null>(null);
  const [savingsPlan, setSavingsPlan] = useState<SavingsPlan | null>(null);

  const chatRef = useRef<MoneyAdvisorChatHandle>(null);
  const burndownMounted = useRef(false);
  const burndownRef = useRef<BurndownData | null>(null);
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

  const firstName = user?.name?.split(" ")[0] || "there";

  const load = useCallback(async () => {
    try {
      const [data, bdata] = await Promise.all([
        api.debtInsights(), api.debtBurndown(debtTargetMonths, strategy),
      ]);
      setInsights(data);
      setBurndown(bdata);
      if (!monthlyPaymentInput) setMonthlyPaymentInput(Math.ceil(bdata.monthly_payment_needed));
      api.getDebtPlan().then(({ plan }) => setPlan(plan)).catch(() => {});
      api.savingsInsights().then(setSavings).catch(() => {});
      api.getSavingsPlan().then(({ plan }) => setSavingsPlan(plan)).catch(() => {});
    } catch {
      // leave as null
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshSavings = useCallback(() => {
    api.savingsInsights().then(setSavings).catch(() => {});
    api.getSavingsPlan().then(({ plan }) => setSavingsPlan(plan)).catch(() => {});
  }, []);

  const refreshPlan = useCallback(() => {
    api.getDebtPlan().then(({ plan }) => setPlan(plan)).catch(() => {});
    api.savingsInsights().then(setSavings).catch(() => {});
    api.getSavingsPlan().then(({ plan }) => setSavingsPlan(plan)).catch(() => {});
  }, []);

  async function togglePlanStep(id: string, done: boolean) {
    try {
      const { plan } = await api.toggleDebtPlanStep(id, done);
      setPlan(plan);
    } catch {}
  }

  async function deletePlanStep(id: string) {
    try {
      const { plan } = await api.deleteDebtPlanStep(id);
      setPlan(plan);
    } catch {}
  }

  async function deletePlan() {
    try {
      await api.deleteDebtPlan();
      setPlan(null);
    } catch {}
  }

  async function toggleSavingsStep(id: string, done: boolean) {
    try {
      const { plan } = await api.toggleSavingsPlanStep(id, done);
      setSavingsPlan(plan);
    } catch {}
  }

  async function deleteSavingsStep(id: string) {
    try {
      const { plan } = await api.deleteSavingsPlanStep(id);
      setSavingsPlan(plan);
    } catch {}
  }

  async function deleteSavingsPlanFn() {
    try {
      await api.deleteSavingsPlan();
      setSavingsPlan(null);
    } catch {}
  }

  useEffect(() => { load(); }, [load]);
  useEffect(() => { burndownRef.current = burndown; }, [burndown]);
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
      const t = localStorage.getItem("wd_has_transport");
      if (t !== null) setHasTransport(t === "1");
    } catch {}
  }, []);

  useEffect(() => {
    api.getPreferences()
      .then(p => {
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
      })
      .catch(() => {});
    // Mobility only earns a tab when there's meaningful transport spend to analyse
    api.transportSummary()
      .then(t => {
        const has = (t.monthly_avg ?? 0) >= 50;
        setHasTransport(has);
        try { localStorage.setItem("wd_has_transport", has ? "1" : "0"); } catch {}
      })
      .catch(() => {});
  }, []);

  // Default to the most relevant tab once insights load: Debt if in debt, else Savings.
  // A `?tab=savings|plan` query param (e.g. from the Home spotlight) overrides the default.
  useEffect(() => {
    if (insights && !initialTabSet.current) {
      initialTabSet.current = true;
      const params = new URLSearchParams(window.location.search);
      const requested = params.get("tab");
      let chosen: "plan" | "savings" | "transport" | "tax";
      if (requested === "savings" || requested === "plan" || requested === "transport" || requested === "tax") {
        chosen = requested;
      } else if (params.get("insight")) {
        chosen = "savings";
      } else {
        chosen = (insights.total_debt ?? 0) > 0 ? "plan" : "savings";
      }
      setTab(chosen);
      if (chosen === "savings" && requested === "savings") {
        // Scroll to the savings insights section after a brief render tick
        setTimeout(() => {
          savingsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 150);
      }
    }
  }, [insights]);

  const effectiveTargetMonths = burndownMode === "amount" && burndown && monthlyPaymentInput > 0
    ? calcMonthsFromPayment(burndown.current_debt, monthlyPaymentInput, burndown.weighted_apr)
    : debtTargetMonths;

  useEffect(() => {
    if (!burndownMounted.current) { burndownMounted.current = true; return; }
    const months = burndownMode === "amount" && burndown && monthlyPaymentInput > 0
      ? calcMonthsFromPayment(burndown.current_debt, monthlyPaymentInput, burndown.weighted_apr)
      : debtTargetMonths;
    api.debtBurndown(months, strategy, debtTrackingStart).then(setBurndown).catch(() => {});
  }, [debtTargetMonths, burndownMode, monthlyPaymentInput, strategy, debtTrackingStart]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasDebt = (insights?.total_debt ?? 0) > 0;
  // The Debt tab only exists when there's debt; otherwise the page is Savings-only.
  const onDebtTab = hasDebt && tab === "plan";
  // Desktop has no tabs — the hero always reflects the primary pillar.
  const heroMode = isDesktop ? (hasDebt ? "plan" : "savings") : tab;
  const heroDebt = hasDebt && heroMode === "plan";

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
  const accent = onDebtTab ? "#b91c1c" : tab === "transport" ? "#7c3aed" : "#059669";

  function refreshDebt() {
    api.debtInsights().then(setInsights).catch(() => {});
    const bdn = burndownRef.current;
    const months = burndownMode === "amount" && bdn && monthlyPaymentInput > 0
      ? calcMonthsFromPayment(bdn.current_debt, monthlyPaymentInput, bdn.weighted_apr)
      : debtTargetMonths;
    api.debtBurndown(months, strategy, debtTrackingStart).then(setBurndown).catch(() => {});
  }

  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-28 max-w-[430px] mx-auto lg:max-w-6xl lg:pb-10" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      {/* Header — compact, one primary stat max. Neutral while loading so the
          Savings copy never flashes before flipping to Debt. */}
      {loading ? (
        <div className="mx-4 mt-4 rounded-3xl h-[120px] bg-slate-200 dark:bg-slate-800 animate-pulse" />
      ) : (
      /* Neutral hero prototype: calm surface, colour in the icon chip and stat —
         Penny's gradient stays the only loud element */
      <div
        className="mx-4 mt-4 rounded-3xl px-4 pt-5 pb-5 bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700"
        data-tutorial-id="tutorial-debt-header"
      >
        {heroMode === "transport" ? (
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Transport & mobility</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Your travel costs across all modes</p>
            </div>
            <div className="w-11 h-11 rounded-2xl bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center flex-shrink-0">
              <MapPin className="w-5 h-5 text-violet-600 dark:text-violet-400" />
            </div>
          </div>
        ) : heroMode === "tax" ? (
          <>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-500 dark:text-violet-400 mb-0.5">Tax year {taxYear.label}</p>
                <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Tax efficiency</h1>
              </div>
              <div className="w-11 h-11 rounded-2xl bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center flex-shrink-0">
                <TrendingUp className="w-5 h-5 text-violet-600 dark:text-violet-400" />
              </div>
            </div>
            <div className="mt-3 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full bg-violet-500 rounded-full" style={{ width: `${taxYear.pct}%` }} />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">6 Apr</span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">{taxYear.daysLeft} days left</span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">5 Apr</span>
            </div>
          </>
        ) : heroDebt ? (
          <>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Get debt-free</h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Track your payoff and find ways to save</p>
              </div>
              <div className="w-11 h-11 rounded-2xl bg-red-100 dark:bg-red-900/40 flex items-center justify-center flex-shrink-0">
                <TrendingDown className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
            </div>
            {insights ? (
              <div className="mt-3">
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">{hasDebt ? "Total outstanding" : "Credit-card debt"}</p>
                <p className="text-3xl font-bold tracking-tight text-red-600 dark:text-red-400">
                  {hideNetWorth ? "••••" : hasDebt ? fmt(insights.total_debt, sym) : fmt(0, sym)}
                </p>
              </div>
            ) : null}
          </>
        ) : (
          /* Savings */
          <>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Grow your money</h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Spend less and grow your cushion</p>
              </div>
              <div className="w-11 h-11 rounded-2xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0">
                <PiggyBank className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
            </div>
            {insights ? (
              <div className="mt-3">
                {(insights.monthly_surplus ?? 0) > 0 ? (
                  <>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">Monthly surplus</p>
                    <p className="text-3xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">{hideNetWorth ? "••••" : fmt(insights.monthly_surplus, sym)}</p>
                  </>
                ) : savings?.configured ? (
                  <>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">Safety net funded</p>
                    <p className="text-3xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">{hideNetWorth ? "••••" : `${Math.round(savings.pct_funded ?? 0)}%`}</p>
                  </>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
      )}

      <div className="px-4 pt-4 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Spinner size={32} /></div>
        ) : !insights ? (
          <>
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 text-center shadow-sm">
              <p className="text-slate-500 dark:text-slate-400 text-sm">Could not load your money summary</p>
            </div>
            <SavingsInsightsSection />
          </>
        ) : (
          <>
            {/* Debt | Savings | Mobility | Tax tabs — hidden when there's only one */}
            {(() => {
              const tabs = [
                ...(hasDebt ? ["plan" as const] : []),
                "savings" as const,
                ...(hasTransport ? ["transport" as const] : []),
                ...((incomeBracket === "100k_125k" || incomeBracket === "125k_plus") ? ["tax" as const] : []),
              ];
              if (tabs.length < 2 || isDesktop) return null;
              return (
                <SegmentedControl
                  ariaLabel="Insights sections"
                  value={tab}
                  onChange={(t) => setTab(t as typeof tab)}
                  options={[
                    ...(hasDebt ? [{ value: "plan", label: "Debt", accent: "#b91c1c" }] : []),
                    { value: "savings", label: "Savings", accent: "#059669" },
                    ...(hasTransport ? [{ value: "transport", label: "Mobility", accent: "#7c3aed" }] : []),
                    ...((incomeBracket === "100k_125k" || incomeBracket === "125k_plus") ? [{ value: "tax", label: "Tax", accent: "#7c3aed" }] : []),
                  ]}
                />
              );
            })()}

            {/* Wait for savings data — otherwise the #1 recommendation renders
                without the buffer step, then swaps once savings loads */}
            {savings && (
              <NextHundredCard
                debtTotal={insights.total_debt ?? 0}
                savings={savings}
                incomeBracket={incomeBracket}
                sym={sym}
                hideValues={hideNetWorth}
              />
            )}

            {(() => {
              const showTaxSection = incomeBracket === "100k_125k" || incomeBracket === "125k_plus";

              const debtBlock = (
                <>
                  {burndown && burndown.burndown.length > 0 && (
                    <DebtBurndownCard
                      data={burndown}
                      mode={burndownMode}
                      onModeChange={setBurndownMode}
                      targetMonths={debtTargetMonths}
                      onTargetChange={setDebtTargetMonths}
                      monthlyPayment={monthlyPaymentInput}
                      onMonthlyPaymentChange={setMonthlyPaymentInput}
                      effectiveTargetMonths={effectiveTargetMonths}
                      trackingStart={debtTrackingStart}
                      onTrackingStartChange={setDebtTrackingStart}
                      strategy={strategy}
                      onStrategyChange={setStrategy}
                      hideValues={hideNetWorth}
                      sym={sym}
                      monthlySurplus={insights.monthly_surplus}
                      collapsibleSettings
                      settingsExtra={insights.accounts.length > 0 ? (
                        <CreditCardsCard
                          accounts={insights.accounts}
                          totalDebt={insights.total_debt}
                          hideNetWorth={hideNetWorth}
                          sym={sym}
                          strategy={strategy}
                          onRateChange={refreshDebt}
                        />
                      ) : undefined}
                    />
                  )}

                  <PlanCard
                    plan={plan}
                    sym={sym}
                    accent="#b91c1c"
                    hideValues={hideNetWorth}
                    onToggleStep={togglePlanStep}
                    onDeleteStep={deletePlanStep}
                    onOpenChat={(p) => chatRef.current?.open(p)}
                    onDelete={deletePlan}
                  />

                  {insights.monthly_surplus < 0 && (
                    <DebtGrowingCard insights={insights} hideNetWorth={hideNetWorth} sym={sym} targetMonths={effectiveTargetMonths} />
                  )}
                </>
              );

              const savingsBlock = (
                <>
                  <SafetyNetCard
                    data={savings}
                    sym={sym}
                    hideValues={hideNetWorth}
                    onSaved={refreshSavings}
                    debtTotal={insights.total_debt ?? 0}
                  />

                  {savings?.configured && (
                    <SavingsPlanCard
                      plan={savingsPlan}
                      sym={sym}
                      accent="#059669"
                      hideValues={hideNetWorth}
                      onToggleStep={toggleSavingsStep}
                      onDeleteStep={deleteSavingsStep}
                      onOpenChat={(p) => chatRef.current?.open(p)}
                      onDelete={deleteSavingsPlanFn}
                    />
                  )}

                  {!hasDebt && (savings?.pct_funded ?? 0) >= 100 && (
                    <ReadyToGrowCard onOpenChat={(p) => chatRef.current?.open(p)} />
                  )}

                  {/* ── Ways to save hub ── */}
                  <div ref={savingsSectionRef} className="px-1 pt-3 border-t border-slate-200/70 dark:border-slate-700/60">
                    <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Ways to save</h2>
                  </div>

                  <SavingsInsightsSection embedded />

                  {isPro && <GroceryBasketCard />}

                  <MoneyBasicCard className="" />
                </>
              );

              // Desktop: no tabs — every applicable pillar is visible at once.
              // Two independent stacked columns (not a row-based grid): grid rows
              // size to their tallest cell, which left a dead gap under Debt
              // whenever Savings ran longer. Independent columns flow continuously.
              if (isDesktop) {
                const columnTitle = (label: string, colour: string) => (
                  <div className="flex items-center gap-2 px-1">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colour }} />
                    <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</h2>
                  </div>
                );
                const debtSec = hasDebt ? (
                  <div key="debt" className="space-y-3">{columnTitle("Debt", "#ef4444")}{debtBlock}</div>
                ) : null;
                const savingsSec = (
                  <div key="savings" className="space-y-3">{columnTitle("Savings", "#10b981")}{savingsBlock}</div>
                );
                // Placeholder shown while secondary sections wait for idle/first-paint.
                const secondaryPlaceholder = (
                  <div className="rounded-2xl bg-white dark:bg-slate-800 shadow-sm animate-pulse h-48" />
                );
                const mobilitySec = hasTransport ? (
                  <div key="mobility" className="space-y-3">
                    {columnTitle("Mobility", "#7c3aed")}
                    {secondaryReady ? <TransportInsights /> : secondaryPlaceholder}
                  </div>
                ) : null;
                const taxSec = showTaxSection ? (
                  <div key="tax" className="space-y-3">
                    {columnTitle("Tax efficiency", "#7c3aed")}
                    {secondaryReady ? (
                      <TaxPage
                        embedded
                        prefsLoaded={taxPrefsLoaded}
                        incomeValue={taxIncomeValue}
                        incomeBracket={incomeBracket}
                        pensionAnnual={taxPensionAnnual}
                        hasChildBenefit={taxHasChildBenefit}
                      />
                    ) : secondaryPlaceholder}
                  </div>
                ) : null;

                const leftCol: ReactNode[] = [];
                const rightCol: ReactNode[] = [];
                if (debtSec) {
                  leftCol.push(debtSec);
                  if (mobilitySec) leftCol.push(mobilitySec);
                  rightCol.push(savingsSec);
                  if (taxSec) rightCol.push(taxSec);
                } else {
                  leftCol.push(savingsSec);
                  if (mobilitySec) rightCol.push(mobilitySec);
                  if (taxSec) rightCol.push(taxSec);
                }

                if (rightCol.length === 0) {
                  return <div className="max-w-2xl mx-auto space-y-6">{leftCol}</div>;
                }
                return (
                  <div className="flex gap-4 items-start">
                    <div className="flex-1 min-w-0 space-y-6">{leftCol}</div>
                    <div className="flex-1 min-w-0 space-y-6">{rightCol}</div>
                  </div>
                );
              }

              return tab === "tax" ? (
                <TaxPage
                  embedded
                  prefsLoaded={taxPrefsLoaded}
                  incomeValue={taxIncomeValue}
                  incomeBracket={incomeBracket}
                  pensionAnnual={taxPensionAnnual}
                  hasChildBenefit={taxHasChildBenefit}
                />
              ) : tab === "transport" ? (
                <TransportInsights />
              ) : onDebtTab ? (
                debtBlock
              ) : (
                savingsBlock
              );
            })()}

            <AdviceDisclaimer className="pt-1" />
          </>
        )}
      </div>

      {/* Desktop shows all sections at once, so Penny is the single chat FAB
          (two overlapping floating buttons would collide bottom-right). */}
      <MoneyAdvisorChat
        ref={chatRef}
        insights={insights}
        sym={sym}
        firstName={firstName}
        onPlanSaved={refreshPlan}
        hidden={!isDesktop && tab === "tax"}
        page={isDesktop ? (hasDebt ? "debt" : "savings") : (tab === "plan" ? "debt" : tab)}
      />
      {!isDesktop && tab === "tax" && <TaxChat />}
      <BottomNav />
    </div>
  );
}
