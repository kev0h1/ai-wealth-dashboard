"use client";

// The ONE concrete next step after "This isn't me, change it" (G242), one per
// trait kind: aim (an aim on the trait's category), checkpoint (a step before
// a personal peak) or plan (the matching plan on Planning). Never a list,
// never a checkbox the user ticks to report progress: everything is read from
// transactions (BEHAVIOURS.md Layer 4), so the checkpoint step has no button
// at all. Neutral ink and indigo actions: it is the app talking, not Penny
// giving advice, so no Penny gradient here.
import MoneyText from "@/components/MoneyText";
import { fmtWhole } from "@/lib/aimFormat";

export type MirrorStepKind = "aim" | "checkpoint" | "plan";

export interface MirrorNextStepProps {
  kind: MirrorStepKind;
  /** The trait's category (aim steps). */
  category?: string;
  /** The pre-filled aim, from suggested_aim or about 93% of usual (aim steps). */
  amount?: number | null;
  /** aim: open until an aim exists on the category, then done. */
  status?: "open" | "done";
  sym?: string;
  onAct?: () => void;
  onSeeNext: () => void;
}

const LINK = "inline-flex min-h-[44px] items-center text-[13px] font-semibold text-indigo-700 transition-opacity hover:text-indigo-800 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300 dark:hover:text-indigo-200";
const PRIMARY = "mt-2 flex min-h-[44px] w-full items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition-[transform,background-color] hover:bg-indigo-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 motion-reduce:transition-none dark:focus-visible:ring-offset-slate-900";

export default function MirrorNextStep({ kind, category = "", amount = null, status = "open", sym = "£", onAct, onSeeNext }: MirrorNextStepProps) {
  const shell = "border-t border-slate-100 px-4 py-3 dark:border-slate-700/60";

  if (kind === "aim" && status === "done") {
    return (
      <div className={shell} role="status">
        <p className="text-[13px] leading-relaxed text-slate-700 dark:text-slate-200">
          Aim set. It sits beside {category} on Spend.
        </p>
        <button type="button" onClick={onSeeNext} className={LINK}>See it on Spend</button>
      </div>
    );
  }

  if (kind === "aim") {
    return (
      <div className={shell}>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Your next step</p>
        <p className="text-[13px] leading-relaxed text-slate-700 dark:text-slate-200">
          <MoneyText text={amount != null
            ? `Set an aim for ${category}. It is a pace check, not a limit, and about ${fmtWhole(amount, sym)} is close to your usual.`
            : `Set an aim for ${category}. It is a pace check, not a limit.`} />
        </p>
        <button type="button" onClick={onAct} className={PRIMARY}>Set an aim for {category}</button>
      </div>
    );
  }

  if (kind === "checkpoint") {
    return (
      <div className={shell}>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Your next step</p>
        <p className="text-[13px] leading-relaxed text-slate-700 dark:text-slate-200">
          Your spending tends to peak early in the pay period. A checkpoint the day before would let me look at your transactions and tell you what I see. Checkpoints are read from your transactions, so there is nothing for you to tick.
        </p>
        <button type="button" onClick={onSeeNext} className={LINK}>Back to Spend</button>
      </div>
    );
  }

  return (
    <div className={shell}>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Your next step</p>
      <p className="text-[13px] leading-relaxed text-slate-700 dark:text-slate-200">
        A plan on Planning can set how much to put aside and when, and I will check it against your transactions.
      </p>
      <button type="button" onClick={onAct} className={PRIMARY}>See the plan on Planning</button>
    </div>
  );
}
