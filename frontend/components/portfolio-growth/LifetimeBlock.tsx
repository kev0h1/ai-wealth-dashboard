"use client";

import { ANCHOR_EDIT, ANCHOR_PROMPT, ANCHOR_USER_NOTE, fromProvider, money, percent, reconciliationText, shortDate, type InvestmentGrowth } from "@/lib/investmentGrowth";
import { ink, label, Marker, Money, whisper } from "./Parts";

const linkBtn = "touch-manipulation inline-flex min-h-[44px] items-center rounded-xl text-[14px] font-semibold text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300";

/** The PRIMARY lifetime figure (G278). With an anchor: growth since the user
 *  started, the provider's own rate as entered, the reconciliation line and an
 *  "Edit anchor" link. Without one: a single entry point. Never advice, and no
 *  control here moves money. */
export default function LifetimeBlock({ g, hidden, onAnchor, onOverride, detail }: {
  g: InvestmentGrowth;
  hidden?: boolean;
  onAnchor?: () => void;
  onOverride?: (on: boolean) => void;
  /** The drill-in also shows how paid in is built up. */
  detail?: boolean;
}) {
  const life = g.lifetime;
  if (!life) {
    return onAnchor ? (
      <button type="button" onClick={onAnchor} className={`${linkBtn} text-left`}>{ANCHOR_PROMPT}</button>
    ) : null;
  }
  const rc = life.reconciliation;
  const rate = life.rate_of_return;
  const pct = life.growth_pct === null ? null : percent(life.growth_pct, { hidden });
  return (
    <section aria-label="Lifetime growth" className="space-y-2">
      <div>
        <p className={`flex items-center gap-1.5 ${label}`}><Marker n={life.growth_abs} />Growth since you started</p>
        <p className="mt-1">
          <Money text={money(life.growth_abs, { sign: true, hidden })} className={`text-[22px] font-bold leading-tight tracking-tight ${ink}`} />
          {pct ? <span className={`ml-2 text-[12px] ${whisper}`}>{pct} of paid in</span> : null}
        </p>
        <p className={`mt-0.5 text-[12px] ${whisper}`}>
          Paid in <Money text={money(life.paid_in, { hidden })} className={ink} />, from your {shortDate(life.since, true)} anchor
          {life.paid_in_after || life.withdrawn_after ? " and what you have paid in since" : ""}.
        </p>
      </div>

      {rate ? (
        <p className={`text-[13px] ${ink}`}>
          Personal rate of return <Money text={percent(rate.pct, { hidden })} className="font-semibold" />{" "}
          <span className={whisper}>{rate.label || fromProvider(life.provider)}, as of {shortDate(rate.as_of, true)}</span>
        </p>
      ) : null}

      {rc ? (
        <div>
          <p className={`text-[12px] leading-snug ${whisper}`}>
            {rc.override
              ? `Showing ${life.provider}'s ${money(rc.provider_value, { hidden })} for ${shortDate(rc.date)} only. Sorted's own figure was ${money(rc.ours, { hidden })}.`
              : reconciliationText(rc, life.provider, hidden)}
          </p>
          {onOverride ? (
            <button type="button" onClick={() => onOverride(!rc.override)} className={linkBtn}>
              {rc.override ? "Show Sorted's figure" : `Use ${life.provider}'s value`}
            </button>
          ) : null}
        </div>
      ) : null}

      {detail ? (
        <dl className={`grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] ${whisper}`}>
          <dt>Paid in at anchor</dt><dd className="text-right"><Money text={money(life.net_paid_in_at_anchor, { hidden })} className={ink} /></dd>
          <dt>Paid in since</dt><dd className="text-right"><Money text={money(life.paid_in_after, { hidden })} className={ink} /></dd>
          {life.withdrawn_after ? <><dt>Taken out since</dt><dd className="text-right"><Money text={money(life.withdrawn_after, { hidden })} className={ink} /></dd></> : null}
        </dl>
      ) : null}

      <p className={`text-[12px] ${whisper}`}>{ANCHOR_USER_NOTE}</p>
      {onAnchor ? <button type="button" onClick={onAnchor} className={linkBtn}>{ANCHOR_EDIT}</button> : null}
    </section>
  );
}
