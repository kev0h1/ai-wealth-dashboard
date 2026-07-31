"use client";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Repeat } from "lucide-react";
import { api } from "@/lib/api";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { CATEGORY_COLOURS } from "@/lib/categories";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useSheetOpen } from "@/lib/useSheetOpen";
import { useSheetA11y } from "@/lib/useSheetA11y";
import SegmentedControl from "@/components/SegmentedControl";

// Emerald income voice — single definition used throughout this file
const INCOME_COLOUR = "#4ade80";

interface UpcomingEditSheetProps {
  item: {
    name: string;
    amount: number;
    expected_date: string;
    type: "bill" | "income";
    category?: string | null;
    edited?: boolean;
    rule_label?: string | null;
  };
  onClose: () => void;
  onDismiss: () => void;
  onSaved: () => void;
}

export default function UpcomingEditSheet({ item, onClose, onDismiss, onSaved }: UpcomingEditSheetProps) {
  useLockBodyScroll();
  useSheetOpen();
  const panelRef = useSheetA11y<HTMLDivElement>(onClose);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const [dateVal, setDateVal] = useState(item.expected_date);
  const [amountVal, setAmountVal] = useState(item.amount.toFixed(2));
  const [scope, setScope] = useState<"one" | "future">("one");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Destructive confirm two-step state
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  // Repeats section state
  const [rulesExpanded, setRulesExpanded] = useState(false);
  const [ruleText, setRuleText] = useState("");
  const [rulePreviewing, setRulePreviewing] = useState(false);
  const [rulePreview, setRulePreview] = useState<{
    schedule: Record<string, unknown>;
    label: string;
    next_dates: string[];
  } | null>(null);
  const [ruleError, setRuleError] = useState<string | null>(null);
  const [ruleApplying, setRuleApplying] = useState(false);
  const [ruleClearing, setRuleClearing] = useState(false);

  const catName = item.type === "income" ? (item.category || "Income") : (item.category || "Other");
  const colour = item.type === "income"
    ? INCOME_COLOUR
    : (CATEGORY_COLOURS[catName as keyof typeof CATEGORY_COLOURS] ?? CATEGORY_COLOURS.Other);
  const Icon = getCategoryIcon(catName, {});

  const formattedDate = new Date(item.expected_date).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const sign = item.type === "income" ? "+" : "−";

  const ariaLabel = item.type === "income"
    ? `Edit income prediction: ${item.name}`
    : `Edit ${item.name}`;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const newAmount = parseFloat(amountVal);
    if (isNaN(newAmount) || newAmount <= 0) { setError("Enter a valid amount"); return; }
    if (dateVal === item.expected_date && newAmount === item.amount) { onClose(); return; }
    setSaving(true);
    setError(null);
    try {
      const params: { key: string; date: string; new_date?: string; new_amount?: number; scope: "one" | "future" } = {
        key: item.name,
        date: item.expected_date,
        scope,
      };
      if (dateVal !== item.expected_date) params.new_date = dateVal;
      if (newAmount !== item.amount) params.new_amount = newAmount;
      await api.editUpcoming(params);
      onSaved();
      onClose();
    } catch {
      setError("Couldn't save — please try again");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    try {
      await api.clearUpcomingOverride({ key: item.name, date: item.expected_date });
      onSaved();
      onClose();
    } catch {
      setError("Couldn't reset — please try again");
    }
  }

  async function handlePreviewRule() {
    setRulePreviewing(true);
    setRuleError(null);
    setRulePreview(null);
    try {
      const resp = await api.previewUpcomingRule({
        key: item.name,
        text: ruleText,
        anchor_date: item.expected_date,
      });
      if (!resp.ok) {
        setRuleError(resp.error || "Couldn't understand that — try something like 'every Sunday' or 'last Friday of the month'");
      } else {
        setRulePreview({
          schedule: resp.schedule!,
          label: resp.label!,
          next_dates: resp.next_dates!,
        });
      }
    } catch {
      setRuleError("Couldn't reach server — please try again");
    } finally {
      setRulePreviewing(false);
    }
  }

  async function handleApplyRule() {
    if (!rulePreview) return;
    setRuleApplying(true);
    setRuleError(null);
    try {
      await api.applyUpcomingRule({ key: item.name, schedule: rulePreview.schedule });
      onSaved();
      onClose();
    } catch {
      setRuleError("Couldn't save rule — please try again");
    } finally {
      setRuleApplying(false);
    }
  }

  async function handleClearRule() {
    setRuleClearing(true);
    setRuleError(null);
    try {
      await api.clearUpcomingRule({ key: item.name });
      onSaved();
      onClose();
    } catch {
      setRuleError("Couldn't remove rule — please try again");
    } finally {
      setRuleClearing(false);
    }
  }

  function formatNextDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }

  if (!mounted) return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-[65] fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className="fixed inset-x-0 bottom-0 z-[70]"
        style={reduceMotion ? undefined : { animation: "slideUpSheet 280ms cubic-bezier(0.32, 0.72, 0, 1) both" }}
      >
        <div
          className="mx-auto w-full max-w-[500px] bg-white dark:bg-slate-800 rounded-t-3xl flex flex-col"
          style={{ maxHeight: "85svh" }}
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
            <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full" />
          </div>

          {/* Header */}
          <div className="flex items-center gap-3 px-5 pt-2 pb-3 flex-shrink-0">
            <span
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: `${colour}26` }}
              aria-hidden="true"
            >
              <Icon size={16} style={{ color: colour }} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate">{item.name}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Predicted {formattedDate} · {sign}£{item.amount.toFixed(2)}
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 flex-shrink-0 ml-2 active:bg-slate-200 dark:active:bg-slate-600 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
            >
              <X size={15} />
            </button>
          </div>

          {/* Scrollable content */}
          <div
            className="overflow-y-auto flex-1 px-5 space-y-3"
            style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom, 0px))" }}
          >
            <form onSubmit={handleSave} className="space-y-3">

              {/* Date + Amount side by side */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    value={dateVal}
                    onChange={e => setDateVal(e.target.value)}
                    className="w-full min-h-[48px] px-3 rounded-xl bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 text-sm appearance-none text-left [&::-webkit-date-and-time-value]:text-left"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                    Amount
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 text-sm pointer-events-none select-none">£</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={amountVal}
                      onChange={e => setAmountVal(e.target.value)}
                      className="w-full min-h-[48px] pl-7 pr-3 rounded-xl bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 text-sm text-left tabular-nums"
                    />
                  </div>
                </div>
              </div>

              {/* Repeats section */}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">
                  Repeats
                </p>
                {item.rule_label ? (
                  // Active rule row
                  <div className="flex items-center gap-2 py-1">
                    <Repeat size={14} className="text-indigo-500 flex-shrink-0" />
                    <span className="text-sm text-slate-700 dark:text-slate-200 flex-1">{item.rule_label}</span>
                    <button
                      type="button"
                      disabled={ruleClearing}
                      onClick={handleClearRule}
                      className="min-h-[36px] px-2 text-sm text-slate-500 dark:text-slate-400 bg-transparent hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 disabled:opacity-60"
                    >
                      {ruleClearing ? "Removing…" : "Remove"}
                    </button>
                  </div>
                ) : !rulesExpanded ? (
                  // Collapsed affordance
                  <button
                    type="button"
                    onClick={() => setRulesExpanded(true)}
                    className="w-full min-h-[44px] px-3 rounded-xl bg-slate-50 dark:bg-slate-700 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
                  >
                    <Repeat size={14} className="flex-shrink-0" />
                    Set a schedule
                  </button>
                ) : (
                  // Expanded rule builder
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={ruleText}
                      onChange={e => { setRuleText(e.target.value); setRulePreview(null); setRuleError(null); }}
                      placeholder="e.g. every Sunday · last Friday of the month"
                      className="w-full min-h-[48px] px-3 rounded-xl bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 text-sm"
                    />
                    {ruleError && (
                      <p className="text-xs text-rose-600 dark:text-rose-400">{ruleError}</p>
                    )}
                    {rulePreview ? (
                      // Readback card
                      <div className="rounded-xl bg-indigo-50 dark:bg-indigo-900/20 p-3 space-y-1.5">
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{rulePreview.label}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {rulePreview.next_dates.map(formatNextDate).join(" · ")}
                        </p>
                        <div className="flex flex-col gap-2 pt-1">
                          <button
                            type="button"
                            disabled={ruleApplying}
                            onClick={handleApplyRule}
                            className="w-full min-h-[44px] rounded-xl bg-indigo-600 text-white text-sm font-semibold active:scale-95 transition-transform disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                          >
                            {ruleApplying ? "Applying…" : "Apply schedule"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setRulePreview(null)}
                            className="w-full min-h-[40px] rounded-xl text-slate-600 dark:text-slate-300 text-sm font-semibold bg-transparent hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
                          >
                            Edit
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={!ruleText.trim() || rulePreviewing}
                        onClick={handlePreviewRule}
                        className="w-full min-h-[44px] rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-semibold active:scale-95 transition-transform disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
                      >
                        {rulePreviewing ? "Checking…" : "Preview"}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Scope selector */}
              <div>
                <SegmentedControl
                  options={[
                    { value: "one", label: "Just this one" },
                    { value: "future", label: "This & future" },
                  ]}
                  value={scope}
                  onChange={(v) => setScope(v as "one" | "future")}
                  ariaLabel="Edit scope"
                />
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1.5">
                  {scope === "one" ? "Only edits this occurrence" : "Updates every upcoming one until a real payment replaces it"}
                </p>
              </div>

              {/* Error */}
              {error && (
                <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
              )}

              {/* Action buttons */}
              <div className="flex flex-col gap-2 pt-1">
                {/* Save */}
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full min-h-[48px] rounded-xl bg-indigo-600 text-white text-sm font-semibold active:scale-95 transition-transform disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                >
                  {saving ? "Saving…" : "Save"}
                </button>

                {/* Reset to prediction — only if edited */}
                {item.edited && (
                  <button
                    type="button"
                    onClick={handleReset}
                    className="w-full min-h-[48px] rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-semibold active:scale-95 transition-transform focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
                  >
                    Reset to prediction
                  </button>
                )}

                {/* Destructive remove — two-step confirm */}
                {!confirmingRemove ? (
                  <button
                    type="button"
                    onClick={() => setConfirmingRemove(true)}
                    className="w-full min-h-[44px] rounded-xl text-rose-600 dark:text-rose-400 text-sm font-semibold bg-transparent hover:bg-rose-50 dark:hover:bg-rose-900/20 active:scale-95 transition-transform focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2"
                  >
                    {item.type === "income" ? "Not income" : "Not a bill"}
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-slate-600 dark:text-slate-300 flex-1">Stop predicting this?</p>
                    <button
                      type="button"
                      onClick={() => { onDismiss(); onClose(); }}
                      className="min-h-[36px] px-3 rounded-xl bg-rose-600 text-white text-sm font-semibold active:scale-95 transition-transform focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2"
                    >
                      Remove
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingRemove(false)}
                      className="min-h-[36px] px-3 rounded-xl text-slate-600 dark:text-slate-300 text-sm font-semibold bg-transparent hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
                    >
                      Keep
                    </button>
                  </div>
                )}
              </div>
            </form>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
