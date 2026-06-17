"use client";

import { useState, useEffect } from "react";
import {
  X, ChevronRight, ChevronLeft,
  Building2, Upload, PieChart, List,
  Tag, Target, TrendingDown, Lightbulb, Sparkles,
} from "lucide-react";

const STEPS = [
  {
    Icon: Sparkles,
    color: "#4f46e5",
    bg: "#ede9fe",
    title: "Welcome to Wealth Dashboard",
    description:
      "Track all your money in one place. This short tour walks you through everything the app can do — from connecting your bank to eliminating debt.",
    tip: undefined,
  },
  {
    Icon: Building2,
    color: "#2563eb",
    bg: "#dbeafe",
    title: "Connect Open Banking",
    description:
      "Go to the Accounts page and tap + Add Account. Choose your bank, sign in securely, and your transactions will start syncing automatically.",
    tip: "Supports most UK banks via TrueLayer and Yapily.",
  },
  {
    Icon: Upload,
    color: "#0891b2",
    bg: "#cffafe",
    title: "Upload a Statement",
    description:
      "If your bank isn't supported for open banking, export a CSV statement from your bank's website and upload it from the Accounts page.",
    tip: "Works with NatWest, Barclays, HSBC, Monzo exports and more.",
  },
  {
    Icon: PieChart,
    color: "#0891b2",
    bg: "#cffafe",
    title: "View Your Spending",
    description:
      "The Spend page breaks down where your money goes by category within each pay period. Tap the arrows to move between periods and see trends.",
    tip: "Set your pay period in Spend → Pay period settings.",
  },
  {
    Icon: List,
    color: "#4f46e5",
    bg: "#ede9fe",
    title: "Browse Transactions",
    description:
      "Tap any transaction on the Home or Spend page to open the detail sheet. You can see the merchant, amount, date, and current category.",
    tip: "Transactions are pulled from all your connected accounts.",
  },
  {
    Icon: Tag,
    color: "#7c3aed",
    bg: "#f3e8ff",
    title: "Change Transaction Category",
    description:
      "Open a transaction and tap its category badge to reassign it. To automate this, go to Settings → Categorisation Rules and describe the rule in plain English.",
    tip: "Example rule: \"Always put Greggs as Eating Out\".",
  },
  {
    Icon: Target,
    color: "#059669",
    bg: "#d1fae5",
    title: "Create a Budget",
    description:
      "On the Budget page, pick a category from the dropdown and enter a monthly limit, then tap +. Or type a plain-English instruction like \"limit eating out to £200\" and the AI will set it up.",
    tip: "The Spend Pacing Curve shows if you're on track in real time.",
  },
  {
    Icon: TrendingDown,
    color: "#b91c1c",
    bg: "#fee2e2",
    title: "Track & Eliminate Debt",
    description:
      "The Debt page shows your total balance across all credit cards and loans. Set a payoff goal by date or monthly amount, pick Avalanche or Snowball strategy, and watch the burndown chart.",
    tip: "Avalanche saves the most interest. Snowball gives faster wins.",
  },
  {
    Icon: Lightbulb,
    color: "#d97706",
    bg: "#fef3c7",
    title: "AI Savings Insights",
    description:
      "Insights analyses your actual spending and surfaces personalised tips — cheaper energy tariffs, subscription savings, remortgage opportunities and more.",
    tip: "Tap Refresh to generate new insights from your latest transactions.",
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function TutorialModal({ open, onClose }: Props) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  if (!open) return null;

  const current = STEPS[step];
  const { Icon } = current;
  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-t-3xl shadow-2xl overflow-hidden"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 8px)" }}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 z-10"
          aria-label="Close tutorial"
        >
          <X size={15} className="text-slate-500 dark:text-slate-400" />
        </button>

        <div className="px-6 pt-7 pb-2">
          {/* Icon */}
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
            style={{ backgroundColor: current.bg }}
          >
            <Icon size={26} style={{ color: current.color }} />
          </div>

          {/* Counter */}
          <p className="text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: current.color }}>
            {step + 1} / {STEPS.length}
          </p>

          {/* Title */}
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-2 leading-snug">
            {current.title}
          </h2>

          {/* Description */}
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
            {current.description}
          </p>

          {/* Tip */}
          {current.tip && (
            <div
              className="mt-3 px-3 py-2.5 rounded-xl text-xs font-medium leading-relaxed"
              style={{ backgroundColor: current.bg, color: current.color }}
            >
              💡 {current.tip}
            </div>
          )}

          {/* Progress dots */}
          <div className="flex items-center gap-1.5 mt-5 mb-4">
            {STEPS.map((s, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                aria-label={`Go to step ${i + 1}`}
                className="rounded-full transition-all duration-200"
                style={{
                  width: i === step ? 20 : 7,
                  height: 7,
                  backgroundColor: i === step ? current.color : "#e2e8f0",
                }}
              />
            ))}
          </div>

          {/* Navigation */}
          <div className="flex gap-2.5 pb-1">
            {!isFirst && (
              <button
                onClick={() => setStep(s => s - 1)}
                className="flex items-center gap-1 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-sm font-medium active:scale-95 transition-transform"
              >
                <ChevronLeft size={16} /> Back
              </button>
            )}
            <button
              onClick={() => (isLast ? onClose() : setStep(s => s + 1))}
              className="flex-1 flex items-center justify-center gap-1 py-2.5 rounded-xl text-white text-sm font-semibold active:scale-95 transition-transform"
              style={{ backgroundColor: current.color }}
            >
              {isLast ? "Let's go!" : (<>Next <ChevronRight size={16} /></>)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
