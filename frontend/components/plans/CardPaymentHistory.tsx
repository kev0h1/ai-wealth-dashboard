"use client";

// G476: the card plan sheet's two history panels. `RecentRepayments` sits on the
// amount step (what this card has really been repaid, grouped by paying account
// when there is more than one). `RecognisePayment` sits on the tracking step (the
// automatically found card leg, or the card's recent credits plus a search).
// Same tokens and row styles as FillRulePicker; no screen of its own. Copy is
// hedged and never red.
import { useState } from "react";
import MoneyText from "@/components/MoneyText";
import { api, type CardPlanSearch, type CardRepayment, type CardRepaymentSource, type PlanFillRule } from "@/lib/api";
import { CARD_PLAN_COPY, legMatchLine, repaymentLine, shortRepaymentDate } from "@/lib/cardRepaymentPlan";

const rowClass = "w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset";
const boxClass = "rounded-xl border border-slate-200/70 dark:border-white/[0.08] divide-y divide-slate-100 dark:divide-white/[0.06] overflow-hidden";
const hintClass = "text-xs leading-5 text-slate-600 dark:text-slate-300";

export function RecentRepayments({ repayments, sources, sourceId, onPickSource, onPickAmount }: {
  repayments: readonly CardRepayment[];
  sources: readonly CardRepaymentSource[];
  sourceId: string;
  onPickSource(source: CardRepaymentSource): void;
  onPickAmount(amount: number): void;
}) {
  if (repayments.length === 0) return <p data-testid="card-plan-no-history" className={`mt-3 ${hintClass}`}>{CARD_PLAN_COPY.noHistory}</p>;
  return (
    <div data-testid="card-plan-recent-repayments" className="mt-4 space-y-3">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{CARD_PLAN_COPY.recentTitle}</h4>
      {sources.length > 1 && (
        <div data-testid="card-plan-source-groups" role="radiogroup" aria-label="Paying account" className={boxClass}>
          <p className={`px-3 pt-2.5 ${hintClass}`}>{CARD_PLAN_COPY.sourcePick}</p>
          {sources.map(source => {
            const on = source.account_id === sourceId;
            return (
              <button key={source.account_id} type="button" role="radio" aria-checked={on} onClick={() => onPickSource(source)} className={`${rowClass} active:opacity-70 ${on ? "bg-indigo-50 dark:bg-indigo-950/30" : ""}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">{source.name}</span>
                  <span className="block text-xs text-slate-600 dark:text-slate-300"><MoneyText text={`Usually about £${source.usual_amount.toLocaleString("en-GB", { minimumFractionDigits: 2 })}, ${source.count} ${source.count === 1 ? "payment" : "payments"}`} /></span>
                </span>
                <span aria-hidden="true" className={`size-4 shrink-0 rounded-full border ${on ? "border-indigo-600 bg-indigo-600" : "border-slate-300 dark:border-slate-500"}`} />
              </button>
            );
          })}
        </div>
      )}
      <ul className={boxClass}>
        {repayments.map(item => (
          <li key={`${item.card_date}-${item.amount}-${item.source_account_id ?? "none"}`}>
            <button type="button" onClick={() => onPickAmount(item.amount)} className={`${rowClass} active:opacity-70`}>
              <span className="min-w-0 flex-1 text-sm text-slate-900 dark:text-slate-100"><MoneyText text={repaymentLine(item)} /></span>
              <span className="shrink-0 text-xs font-semibold text-indigo-600 dark:text-indigo-400">Use amount</span>
            </button>
          </li>
        ))}
      </ul>
      <p className={hintClass}>{CARD_PLAN_COPY.recentHelper}</p>
    </div>
  );
}

export function RecognisePayment({ cardId, sourceId, legMatch, credits, ruleChosen, onPickRule, search = api.cardPlanSearch }: {
  cardId: string;
  sourceId: string;
  legMatch: CardRepayment | null;
  credits: readonly CardRepayment[];
  /** True once a rule is already filled in, so the fallback stays out of the way. */
  ruleChosen: boolean;
  onPickRule(rule: PlanFillRule): void;
  search?: typeof api.cardPlanSearch;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<CardPlanSearch | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function run(skip: number) {
    setBusy(true);
    setFailed(false);
    try {
      const page = await search(cardId, sourceId, query.trim(), skip);
      setResult(skip > 0 && result ? { ...page, items: [...result.items, ...page.items] } : page);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  if (legMatch) {
    return <p data-testid="card-leg-match" role="status" className="rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-700 dark:bg-slate-800/60 dark:text-slate-200"><MoneyText text={legMatchLine(legMatch)} /></p>;
  }
  if (ruleChosen) return null;
  return (
    <div data-testid="card-leg-fallback" className="space-y-3">
      <div>
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{CARD_PLAN_COPY.creditsTitle}</h4>
        <p className={`mt-1 ${hintClass}`}>{CARD_PLAN_COPY.creditsHelper}</p>
      </div>
      {credits.length > 0 && (
        <ul data-testid="card-plan-recent-credits" className={boxClass}>
          {credits.map(item => (
            <li key={`${item.card_date}-${item.amount}-${item.narrative}`}>
              <button type="button" disabled={!item.fill_rule} onClick={() => item.fill_rule && onPickRule(item.fill_rule)} className={`${rowClass} enabled:active:opacity-70 disabled:cursor-default`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">{item.narrative || "Payment"}</span>
                  <span className="block text-xs text-slate-600 dark:text-slate-300"><MoneyText text={`+£${item.amount.toFixed(2)} on ${shortRepaymentDate(item.card_date)}`} />{item.fill_rule ? "" : ` · ${CARD_PLAN_COPY.searchUnmatched}`}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <form role="search" onSubmit={event => { event.preventDefault(); void run(0); }} className="space-y-2">
        <label htmlFor="card-plan-search" className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{CARD_PLAN_COPY.searchLabel}</label>
        <div className="flex gap-2">
          <input id="card-plan-search" name="card-plan-search" type="search" autoComplete="off" maxLength={60} value={query} onChange={event => setQuery(event.target.value)} placeholder="e.g. PAYMENT RECEIVED or 200"
            className="min-h-[48px] min-w-0 flex-1 rounded-xl border border-transparent bg-slate-50 px-3 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:bg-slate-700 dark:text-slate-100" />
          <button type="submit" disabled={busy} className="min-h-[48px] rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 active:scale-95 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200">{busy ? "Searching…" : "Search"}</button>
        </div>
        <p className={hintClass}>{CARD_PLAN_COPY.searchHelper}</p>
      </form>
      {failed && <p role="status" className={hintClass}>Search did not load. Try again.</p>}
      {result && result.items.length === 0 && <p role="status" className={hintClass}>{CARD_PLAN_COPY.searchEmpty}</p>}
      {result && result.items.length > 0 && (
        <div data-testid="card-plan-search-results">
          <ul className={boxClass}>
            {result.items.map(item => (
              <li key={item.id}>
                <button type="button" disabled={!item.fill_rule} onClick={() => item.fill_rule && onPickRule(item.fill_rule)} className={`${rowClass} enabled:active:opacity-70 disabled:cursor-default`}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">{item.narrative || item.display_name}</span>
                    <span className="block text-xs text-slate-600 dark:text-slate-300"><MoneyText text={`${item.direction === "out" ? "−" : "+"}£${item.amount.toFixed(2)} on ${shortRepaymentDate(item.date)}`} /> · {item.account_name}{item.fill_rule ? "" : ` · ${CARD_PLAN_COPY.searchUnmatched}`}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {result.has_more && <button type="button" disabled={busy} onClick={() => void run(result.items.length)} className="mt-1.5 flex min-h-[44px] items-center px-1 text-[13px] font-semibold text-indigo-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400">Show more</button>}
        </div>
      )}
    </div>
  );
}
