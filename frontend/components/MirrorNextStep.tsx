"use client";

// The ONE concrete next step after "This isn't me, change it" (G242), one
// per trait kind. Two presentations of the same step. Never a list, never a
// checkbox the user ticks to report progress: everything is read from
// transactions (BEHAVIOURS.md Layer 4). Penny's gradient chip appears only
// on the Penny-led presentation, because only there is Penny giving advice.
import PennyMark from "@/components/PennyMark";
import MoneyText from "@/components/MoneyText";
import { fmtWhole } from "@/lib/aimFormat";

export type MirrorStepKind = "aim" | "checkpoint" | "plan";

export interface MirrorNextStepProps {
  layout: "inline" | "penny";
  /** aim: set an aim on the trait's category. checkpoint: a verified step before a personal peak.
   *  plan: the matching plan on Planning (G232). */
  kind?: MirrorStepKind;
  category: string;
  /** The pre-filled aim, from suggested_aim or about 93% of usual (aim only). */
  amount?: number;
  /** open: the step is waiting. done: it now exists. */
  status: "open" | "done";
  busy?: boolean;
  sym?: string;
  /** Hedged, personal wording for the checkpoint timing, e.g. "around 2 to 4 November". */
  peakLabel?: string;
  onAct: () => void;
  onSeeNext: () => void;
}

const LINK = "inline-flex min-h-[44px] items-center text-[13px] font-semibold text-indigo-700 transition-opacity hover:text-indigo-800 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300 dark:hover:text-indigo-200";

export default function MirrorNextStep({ layout, kind = "aim", category, amount = 100, status, busy, sym = "£", peakLabel = "around the 2nd to 4th of your pay period", onAct, onSeeNext }: MirrorNextStepProps) {
  const penny = layout === "penny";
  const copy: Record<MirrorStepKind, { body: string; button: string; done: string; link: string }> = {
    aim: {
      body: penny
        ? `I can tell you if ${category} is heading past ${fmtWhole(amount, sym)} this period. I read it from your transactions, so there is nothing to log.`
        : `Set an aim for ${category}. It is a pace check, not a limit, and about ${fmtWhole(amount, sym)} is close to your usual.`,
      button: penny ? `Keep an eye on ${category}` : `Set an aim for ${category}`,
      done: penny
        ? `Done. I will only mention it if ${category} looks likely to pass ${fmtWhole(amount, sym)}.`
        : `Aim set at ${fmtWhole(amount, sym)}. It sits beside ${category} on Spend.`,
      link: "See it on Spend",
    },
    checkpoint: {
      body: `Your spending usually peaks ${peakLabel}. A checkpoint the day before lets me look at your transactions and tell you what I see. There is nothing for you to tick.`,
      button: "Add a checkpoint before the peak",
      done: "Checkpoint added. I will look at your transactions the day before the peak and tell you what I see.",
      link: "Back to Spend",
    },
    plan: {
      body: "Your regular saving looks to have dipped when you drew on it. A plan on Planning can set how much to put back and when, and I will check it against your transactions.",
      button: "See the plan on Planning",
      done: "This opens your saving plan on Planning. That screen is outside this round.",
      link: "Back to Spend",
    },
  };
  const c = copy[kind];
  if (status === "done") {
    return (
      <div className="border-t border-slate-100 px-4 py-3 dark:border-slate-700/60" role="status">
        <p className="text-[13px] leading-relaxed text-slate-700 dark:text-slate-200"><MoneyText text={c.done} /></p>
        <button type="button" onClick={onSeeNext} className={LINK}>{c.link}</button>
      </div>
    );
  }
  return (
    <div className="border-t border-slate-100 px-4 py-3 dark:border-slate-700/60">
      {penny ? (
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
      <p className="text-[13px] leading-relaxed text-slate-700 dark:text-slate-200"><MoneyText text={c.body} /></p>
      <button
        type="button"
        onClick={onAct}
        disabled={busy}
        className="mt-2 flex min-h-[44px] w-full items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition-[transform,background-color] hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 motion-reduce:transition-none dark:focus-visible:ring-offset-slate-900"
      >
        <MoneyText text={c.button} />
      </button>
    </div>
  );
}
