"use client";

// The ONE concrete next step after "This isn't me, change it" (G242).
// Two presentations of the same step. Never a list, never a checkbox the
// user ticks to report progress: the aim is read from transactions
// (BEHAVIOURS.md Layer 4). Penny's gradient chip appears only on the
// Penny-led presentation, because only there is Penny giving advice.
import PennyMark from "@/components/PennyMark";
import MoneyText from "@/components/MoneyText";
import { fmtWhole } from "@/lib/aimFormat";

export interface MirrorNextStepProps {
  layout: "inline" | "penny";
  category: string;
  /** The pre-filled aim, from suggested_aim or about 93% of usual. */
  amount: number;
  /** open: the step is waiting. done: the aim now exists. */
  status: "open" | "done";
  busy?: boolean;
  sym?: string;
  /** inline: opens the aim sheet. penny: saves the pre-filled aim in one tap. */
  onAct: () => void;
  onSeeSpend: () => void;
}

export default function MirrorNextStep({ layout, category, amount, status, busy, sym = "£", onAct, onSeeSpend }: MirrorNextStepProps) {
  const link = "inline-flex min-h-[44px] items-center text-[13px] font-semibold text-indigo-700 transition-opacity hover:text-indigo-800 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300 dark:hover:text-indigo-200";
  if (status === "done") {
    return (
      <div className="border-t border-slate-100 px-4 py-3 dark:border-slate-700/60" role="status">
        <p className="text-[13px] leading-relaxed text-slate-700 dark:text-slate-200">
          <MoneyText text={layout === "penny"
            ? `Done. I will only mention it if ${category} looks likely to pass ${fmtWhole(amount, sym)}.`
            : `Aim set at ${fmtWhole(amount, sym)}. It sits beside ${category} on Spend.`} />
        </p>
        <button type="button" onClick={onSeeSpend} className={link}>See it on Spend</button>
      </div>
    );
  }
  return (
    <div className="border-t border-slate-100 px-4 py-3 dark:border-slate-700/60">
      {layout === "penny" ? (
        <span
          className="mb-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white"
          style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" }}
        >
          <PennyMark size={11} />
          Penny
        </span>
      ) : (
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Your next step</p>
      )}
      <p className="text-[13px] leading-relaxed text-slate-700 dark:text-slate-200">
        <MoneyText text={layout === "penny"
          ? `I can tell you if ${category} is heading past ${fmtWhole(amount, sym)} this period. I read it from your transactions, so there is nothing to log.`
          : `Set an aim for ${category}. It is a pace check, not a limit, and about ${fmtWhole(amount, sym)} is close to your usual.`} />
      </p>
      <button
        type="button"
        onClick={onAct}
        disabled={busy}
        className="mt-2 flex min-h-[44px] w-full items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition-[transform,background-color] hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 motion-reduce:transition-none dark:focus-visible:ring-offset-slate-900"
      >
        {layout === "penny" ? <MoneyText text={`Keep an eye on ${category}`} /> : `Set an aim for ${category}`}
      </button>
    </div>
  );
}
