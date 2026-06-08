"use client";

import { useEffect, useState, useCallback } from "react";
import { Bookmark, BookmarkCheck, RefreshCw, Sparkles, ChevronDown, SlidersHorizontal, X, ArrowRight, CheckCircle2, ExternalLink } from "lucide-react";
import { api, SavingsInsight, WorkflowDef, WorkflowStep } from "@/lib/api";
import BottomNav from "@/components/BottomNav";

const CATEGORY_LINKS: Record<string, { label: string; url: string }[]> = {
  energy:        [{ label: "uSwitch", url: "https://www.uswitch.com/gas-electricity/" }, { label: "MoneySavingExpert", url: "https://www.moneysavingexpert.com/utilities/cheap-energy/" }],
  mortgage:      [{ label: "Habito", url: "https://www.habito.com" }, { label: "MSE Mortgages", url: "https://www.moneysavingexpert.com/mortgages/best-buys/" }],
  car_finance:   [{ label: "MoneySuperMarket", url: "https://www.moneysupermarket.com/car-finance/" }, { label: "MSE Car Finance", url: "https://www.moneysavingexpert.com/loans/car-finance/" }],
  car_insurance: [{ label: "Compare the Market", url: "https://www.comparethemarket.com/car-insurance/" }, { label: "Confused.com", url: "https://www.confused.com/car-insurance" }],
  broadband:     [{ label: "uSwitch", url: "https://www.uswitch.com/broadband/" }, { label: "MoneySuperMarket", url: "https://www.moneysupermarket.com/broadband/" }],
  mobile:        [{ label: "uSwitch", url: "https://www.uswitch.com/mobiles/" }, { label: "MoneySuperMarket", url: "https://www.moneysupermarket.com/mobile-phones/" }],
  groceries:     [{ label: "Trolley.co.uk", url: "https://trolley.co.uk" }, { label: "MySupermarket", url: "https://www.mysupermarket.co.uk" }],
  eating_out:    [{ label: "Vouchercloud", url: "https://www.vouchercloud.com/restaurants" }, { label: "Tastecard", url: "https://www.tastecard.co.uk" }],
  gym:           [{ label: "PayAsUGym", url: "https://www.payasugym.com" }, { label: "ClassPass UK", url: "https://classpass.com/uk" }],
  subscriptions: [{ label: "MSE Subscriptions", url: "https://www.moneysavingexpert.com/family/cancel-subscriptions/" }, { label: "Which?", url: "https://www.which.co.uk" }],
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
  if (days === 0) return "Today";
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
      >
        <div className="flex items-center gap-2.5">
          <span className="text-base">🔍</span>
          <div>
            <p className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">
              Help us personalise your insights
            </p>
            <p className="text-[12px] text-slate-500 dark:text-slate-400">
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
                  <p className="text-[12px] text-slate-400 dark:text-slate-500">
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
                        <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300 leading-tight text-center">
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
                      <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 leading-tight text-center">
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
      >
        <div className="flex items-center gap-2.5">
          <span className="text-base">🏷️</span>
          <div>
            <p className="text-[14px] font-semibold text-slate-800 dark:text-slate-200">Your labelled bills</p>
            <p className="text-[12px] text-slate-400">{labels.length} bill{labels.length !== 1 ? "s" : ""} categorised</p>
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
                      <span className={`text-[12px] ${lbl.is_skip ? "text-slate-400 dark:text-slate-500 italic" : "text-slate-500 dark:text-slate-400"}`}>
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
                          <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300 leading-tight text-center">
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
                        <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 leading-tight text-center">
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
  const initial: Record<string, string> = {};
  for (const s of workflow.steps) initial[s.id] = insight.user_context?.[s.id] ?? "";
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

  function renderInput(s: WorkflowStep) {
    if (s.type === "select" && s.options) {
      return (
        <div className="flex flex-col gap-2">
          {s.options.map(opt => (
            <button
              key={opt}
              onClick={() => set(s.id, opt)}
              className={`w-full text-left px-4 py-3 rounded-xl border text-[14px] transition-all
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
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-[15px] font-medium">£</span>
        )}
        <input
          type={s.type === "text" ? "text" : "number"}
          inputMode={s.type === "text" ? "text" : "decimal"}
          value={values[s.id]}
          onChange={e => set(s.id, e.target.value)}
          placeholder={s.placeholder ?? ""}
          className={`w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700/50 text-[15px] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${s.type === "currency" ? "pl-8" : ""}`}
        />
        {s.unit && (
          <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-[13px]">{s.unit}</span>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
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
              <h2 className="text-[18px] font-bold text-slate-900 dark:text-slate-100 mt-0.5">
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
                Saved! We're generating a personalised insight for you.
              </p>
            </div>
          ) : (
            <>
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
                <p className="text-[13px] text-slate-500 dark:text-slate-400">
                  Step {step + 1} of {totalSteps}
                </p>
                <p className="text-[16px] font-semibold text-slate-800 dark:text-slate-200">
                  {currentStep.label}
                </p>
                {renderInput(currentStep)}
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
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
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
          <p className="text-[15px] font-semibold text-slate-900 dark:text-slate-100 leading-snug">
            {insight.title}
          </p>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed">
            {insight.body}
          </p>

          {/* Savings + timestamp */}
          <div className="flex items-center justify-between">
            {insight.savings_estimate ? (
              <span className="text-[12px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-2.5 py-1 rounded-lg">
                {insight.savings_estimate}
              </span>
            ) : <span />}
            <span className="text-[11px] text-slate-400 dark:text-slate-500">{timeAgo(insight.refreshed_at)}</span>
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
              className="w-full mt-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white text-[13px] font-semibold flex items-center justify-center gap-2 transition-all"
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
            >
              <span className="text-[12px] text-slate-400 dark:text-slate-500">
                Based on {insight.triggered_by.length} transaction{insight.triggered_by.length > 1 ? "s" : ""}
              </span>
              <ChevronDown size={14} className={`text-slate-400 transition-transform duration-200 ${showTriggers ? "rotate-180" : ""}`} />
            </button>
            {showTriggers && (
              <div className="px-4 pb-3 space-y-1.5">
                {insight.triggered_by.map(t => (
                  <div key={t.merchant_key} className="flex items-center justify-between text-[12px]">
                    <span className="text-slate-600 dark:text-slate-300 truncate max-w-[65%]">{t.display_name}</span>
                    <span className="text-slate-400 dark:text-slate-500">£{t.monthly_amount.toFixed(2)}/mo · {t.occurrences}×</span>
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InsightsPage() {
  const [insights, setInsights] = useState<SavingsInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshQueued, setRefreshQueued] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [labelOptions, setLabelOptions] = useState<Record<string, { icon: string; label: string }>>({});
  const [workflows, setWorkflows] = useState<Record<string, import("@/lib/api").WorkflowDef>>({});

  const loadInsights = useCallback(async () => {
    try {
      const data = await api.getSavingsInsights();
      setInsights(data);
      setError(null);
    } catch {
      setError("Couldn't load insights");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInsights();
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

  const pinned = insights.filter(i => i.pinned);
  const unpinned = insights.filter(i => !i.pinned);

  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-28">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-white/80 dark:bg-slate-900/80 backdrop-blur border-b border-slate-200 dark:border-slate-700">
        <div className="max-w-[430px] mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-[17px] font-bold text-slate-900 dark:text-slate-100">Savings Insights</h1>
            <p className="text-[12px] text-slate-400">Personalised tips based on your spending</p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing || refreshQueued}
            className="flex items-center gap-1.5 text-[13px] font-medium text-indigo-600 dark:text-indigo-400 disabled:opacity-40"
          >
            <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
            {refreshQueued ? "Searching…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="max-w-[430px] mx-auto px-4 pt-4 space-y-4">
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

        {!loading && error && (
          <div className="bg-red-50 dark:bg-red-900/20 rounded-2xl p-4 text-[14px] text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {!loading && !error && insights.length === 0 && !refreshQueued && (
          <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
            <span className="text-5xl">💡</span>
            <div>
              <p className="text-[15px] font-semibold text-slate-700 dark:text-slate-300">No insights yet</p>
              <p className="text-[13px] text-slate-400 mt-1">Tap Refresh to search for savings based on your transactions</p>
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
            <p className="text-[13px] text-indigo-700 dark:text-indigo-300">
              Searching for the latest deals… Results appear in ~20 seconds.
            </p>
          </div>
        )}

        {pinned.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2 px-1">
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
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2 px-1">
                For You
              </p>
            )}
            <div className="space-y-3">
              {unpinned.map(i => <InsightCard key={i.id} insight={i} workflow={workflows[i.category] ?? null} onPin={handlePin} onContextSaved={loadInsights} />)}
            </div>
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
