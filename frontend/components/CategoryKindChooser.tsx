"use client";

// The category-kind chooser — survives the CategoryManagerSheet deletion per
// ENGINE.md "What Dies / What Survives": the naming/teaching moment stays,
// inferred with one-tap confirm, but per the Born-in-Context Rule it now
// lives inside the correction picker on a real transaction (TeachingSheet),
// not on a standalone creation sheet. "Keep it, move it." — moved out of
// components/CategoryManagerSheet.tsx (deleted) into its own module so the
// design preview at app/design/category-kind can keep importing it without
// dragging in the rest of the retired Manage sheet.

import { type LucideIcon, Wallet, Receipt, ArrowLeftRight } from "lucide-react";
import { CATEGORY_KINDS, DEFAULT_CUSTOM_COLOUR, type CategoryKind } from "@/lib/categories";

// ── Category kind ───────────────────────────────────────────────────────────
// What a new category MEANS: money spent freely, money already committed, or
// money merely moved between the user's own pots. The app can't tell from the
// name alone, and guessing wrong puts "House Fund" into every headline spend
// figure. So we infer, state the answer plainly, and let one tap correct it —
// a decision already made, never a blank question.
const KIND_META: Record<CategoryKind, {
  label: string;
  icon: LucideIcon;
  consequence: string;   // follows the category name in the verdict sentence
  tail: string;          // one-line consequence on the alternative rows
}> = {
  discretionary: {
    label: "Everyday spending",
    icon: Wallet,
    consequence: "counts as everyday spending, the money you choose to spend.",
    tail: "Money you choose to spend",
  },
  commitment: {
    label: "A bill or commitment",
    icon: Receipt,
    consequence: "counts as spending, but as something you've committed to, not everyday money.",
    tail: "Real spend, already committed",
  },
  movement: {
    label: "Money I move, not spend",
    icon: ArrowLeftRight,
    consequence: "won't count towards your spending at all, it's money moving to your own pot or account.",
    tail: "Won't count towards your spending",
  },
};

export function CategoryKindChooser({ name, kind, onChange }: {
  name: string; kind: CategoryKind; onChange: (kind: CategoryKind) => void;
}) {
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  const others = CATEGORY_KINDS.filter((k) => k !== kind);

  return (
    <div
      role="group"
      aria-label="How this category is counted"
      className="mt-2.5 rounded-2xl bg-slate-50 dark:bg-slate-700/40 p-3"
    >
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        Counted as
      </p>

      {/* The verdict — already decided, stated in words */}
      <div className="mt-1.5 flex items-start gap-2.5">
        <span
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${DEFAULT_CUSTOM_COLOUR}26` }}
        >
          <Icon size={16} className="text-indigo-600 dark:text-indigo-300" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{meta.label}</p>
          <p aria-live="polite" className="mt-0.5 text-[13px] leading-snug text-slate-600 dark:text-slate-300">
            <span className="font-semibold text-slate-800 dark:text-slate-100 break-words">{name}</span>{" "}
            {meta.consequence}
          </p>
        </div>
      </div>

      {/* One tap to correct it */}
      <p className="mt-3 mb-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
        Not quite? Tap the right one.
      </p>
      <div className="space-y-1.5">
        {others.map((k) => {
          const m = KIND_META[k];
          const OtherIcon = m.icon;
          return (
            <button
              key={k}
              type="button"
              onClick={() => onChange(k)}
              aria-label={`Count ${name} as: ${m.label}. ${m.tail}.`}
              className="w-full min-h-[44px] flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left bg-white dark:bg-slate-700 shadow-[0_1px_4px_rgba(0,0,0,0.07)] dark:shadow-none dark:ring-1 dark:ring-slate-600 active:scale-95 transition-transform"
            >
              <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-slate-100 dark:bg-slate-600/60">
                <OtherIcon size={14} className="text-slate-500 dark:text-slate-300" />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-slate-600 dark:text-slate-200 truncate">{m.label}</span>
                <span className="block text-[11px] text-slate-500 dark:text-slate-300 truncate">{m.tail}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
