"use client";

import { useId, type ReactNode } from "react";
import { ArrowDownLeft, ArrowLeftRight, ChevronDown, ChevronRight, ReceiptText, Target, Wallet } from "lucide-react";
import { accountPaymentGap, type UpcomingAccountEvent, type UpcomingAccountSummary, type UpcomingSuggestedMove } from "@/lib/upcomingAccounts";
import { fulfilmentRow, hasPlanSource, remaining, type Plan } from "@/lib/upcomingPlans";
import { cardRepaymentShortCopy, type AccountStatus } from "@/lib/upcomingAccountStatus";
import { accountReading } from "@/lib/upcomingAccountPresentation";
import { coveredByMoveSentence } from "@/lib/coverSuggestion";
import { dateLabel, money, useMaskedMoney } from "./detailPrimitives";
import { useBalancesHidden, maskMoneyText } from "@/lib/balancesHidden";
import { AccountMoney, AccountSignal } from "./accountPresentation";
import styles from "./UpcomingAccounts.module.css";
import MoneyText from "@/components/MoneyText";

export interface UpcomingAccountDetailsProps {
  account: UpcomingAccountSummary;
  periodLabel: string;
  plans?: Plan[];
  plansStatus?: "loading" | "error" | "ready";
  onPlan?: (id: string) => void;
  onEvent?: (eventId: string) => void;
  editableEventIds?: ReadonlySet<string>;
}

function activityDate(iso: string) {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(date) : "Date unavailable";
}

function EventLine({ event, onEvent, align }: { event: UpcomingAccountEvent; onEvent?: (id: string) => void; align?: boolean }) {
  const hidden = useBalancesHidden();
  const uncounted = event.credited === false;
  const incoming = event.kind === "income" || event.kind === "inflow";
  const Icon = incoming ? ArrowDownLeft : event.kind === "movement" ? ArrowLeftRight : ReceiptText;
  const content = <><span className={styles.eventIcon}><Icon size={17} aria-hidden="true" /></span><span className={styles.eventIdentity}><strong>{event.name}</strong><small>{activityDate(event.date)}{uncounted ? " · Not counted until it is confirmed." : ""}</small></span><span data-uncredited-income={uncounted ? "true" : undefined} className={styles.eventAmount}><AccountMoney pence={Math.round(event.amount * 100)} exact positive={incoming} /></span>{onEvent && <ChevronRight size={14} className={styles.muted} aria-hidden="true" />}</>;
  return <li>{onEvent ? <button type="button" data-flow-focus={`event-${event.id}`} aria-label={maskMoneyText(`${event.name}, ${activityDate(event.date)}, ${money(Math.round(event.amount * 100), incoming)}. Open details`, hidden)} onClick={() => onEvent(event.id)} className={`${styles.eventRow} ${styles.eventEditable} min-h-11`}>{content}</button> : <div className={`${styles.eventRow} ${align ? styles.eventEditable : ""}`}>{content}</div>}</li>;
}

function SuggestedLine({ move }: { move: UpcomingSuggestedMove }) {
  return <li data-suggested-move={move.id} className={styles.suggestedEvent}><div className={styles.eventRow}>
    <span className={styles.eventIcon}><ArrowLeftRight size={17} aria-hidden="true" /></span>
    <span className={styles.eventIdentity}><strong>Move {move.amount < 0 ? "to" : "from"} {move.counterpartName}</strong><small>{move.byDate ? <>By <time dateTime={move.byDate}>{activityDate(move.byDate)}</time></> : "Date not set"} · <span className={styles.suggestionLabel}>Suggested</span></small></span>
    <span className={styles.eventAmount}><AccountMoney pence={Math.round(move.amount * 100)} exact={Math.round(move.amount * 100) % 100 !== 0} positive /></span>
  </div></li>;
}

function PlanRow({ plan, onPlan, fromBank }: { plan: Plan; onPlan?: (id: string) => void; fromBank?: string }) {
  const hidden = useBalancesHidden();
  const unassigned = !hasPlanSource(plan), estimated = !unassigned && plan.evidence === "recent-transfers";
  const paid = unassigned ? null : fulfilmentRow(plan);
  const Icon = plan.kind === "goal" ? Target : Wallet;
  const content = <><Icon size={18} aria-hidden="true" className={styles.muted} /><span className={styles.planIdentity}>{plan.name}<small>{unassigned ? "Choose paying account" : paid ? <MoneyText text={maskMoneyText(paid.detail, hidden)} /> : `${plan.kind === "goal" ? "Goal · " : ""}This period${fromBank ? ` · from ${fromBank}` : ""}`}</small>{estimated && <small>Paying account based on recent transfers</small>}</span><span className={styles.planAmount}><strong>{plan.amountUnavailable ? "Unavailable" : paid ? <MoneyText text={maskMoneyText(paid.amount, hidden)} /> : <AccountMoney pence={remaining(plan)} exact />}</strong>{(unassigned || paid || estimated) && <small>{unassigned ? "unassigned" : paid ? paid.status : "estimated"}</small>}</span>{onPlan && <ChevronRight size={14} aria-hidden="true" className={styles.muted} />}</>;
  return <li>{onPlan ? <button type="button" data-flow-focus={`plan-${plan.id}`} onClick={() => onPlan(plan.id)} className={`${styles.planRow} ${styles.planEditable}`}>{content}</button> : <div className={styles.planRow}>{content}</div>}</li>;
}

function VerdictBlock({ title, children, signal, covered = false }: { title: ReactNode; children?: ReactNode; signal: AccountStatus["signal"]; covered?: boolean }) {
  return <div data-verdict className={styles.verdict}>{signal && <span className={styles.verdictSignal}><AccountSignal signal={signal} /></span>}<div><p data-covered-by-move={covered || undefined} className={styles.verdictTitle}>{title}</p>{children && <div className={styles.note}>{children}</div>}</div></div>;
}

function Verdict({ account, plans, plansStatus }: Required<Pick<UpcomingAccountDetailsProps, "account" | "plans" | "plansStatus">>) {
  const m = useMaskedMoney(), hidden = useBalancesHidden();
  const { result, status, moves } = accountReading(account, plans, plansStatus);
  const gap = accountPaymentGap(account);
  const uncounted = Math.round(account.events.filter(event => event.credited === false).reduce((sum, event) => sum + event.amount, 0) * 100);
  const uncountedLine = uncounted > 0 ? <p data-uncredited-note><MoneyText text={`Expected ${m(uncounted)} is not counted until it is confirmed.`} /></p> : null;
  if (gap !== null) {
    if (plansStatus === "ready" && account.coverSuggestion && account.status === "short") {
      const suggestion = account.coverSuggestion, after = suggestion.shortAfterCover;
      return <VerdictBlock signal={status.signal} covered title={after > 0 ? status.signal === "risk" ? "Payments still need more money" : "Payments fit. Plans need more." : "A suggested move would cover payments"}>
        <p><MoneyText text={after > 0 ? coveredByMoveSentence(m(Math.round(gap * 100)), suggestion, m(Math.round(after * 100))) : `Without the ${m(Math.round(suggestion.amount * 100))} suggestion from ${suggestion.fromCount > 1 ? `${suggestion.fromCount} other accounts` : suggestion.fromName}, payments would be ${m(Math.round(gap * 100))} short.`} /> Nothing has been moved.</p>
        {account.shortFor?.cardRepayment && <p data-card-repayment-short><MoneyText text={maskMoneyText(cardRepaymentShortCopy({ ...account, shortfall: gap }), hidden)} />{status.signal === "risk" ? ". A missed repayment can bring fees and interest." : "."}</p>}{uncountedLine}
      </VerdictBlock>;
    }
    return <VerdictBlock signal="risk" title="Payments need more money"><p data-card-repayment-short={account.shortFor?.cardRepayment || undefined}><MoneyText text={account.shortFor?.cardRepayment ? maskMoneyText(cardRepaymentShortCopy({ ...account, shortfall: gap }), hidden) : `${m(Math.round(gap * 100))} needed for payments.${account.firstShortDate ? ` First shortfall ${dateLabel(account.firstShortDate)}.` : ""}`} /></p><p>{account.shortFor?.cardRepayment ? "A missed repayment can bring fees and interest. " : ""}Goals and allocations are separate from this bill gap.</p>{uncountedLine}</VerdictBlock>;
  }
  if (account.status === "unknown") return <VerdictBlock signal="unknown" title="Balance needs checking">Payments are listed, but availability cannot be confirmed without a balance.</VerdictBlock>;
  if (plansStatus !== "ready") return <VerdictBlock signal="unknown" title={plansStatus === "loading" ? "Loading goals and allocations" : "Goals and allocations need checking"}>{plansStatus === "loading" ? "Loading goals and allocations. This figure covers payments only." : "Goals and allocations could not be checked. This figure covers payments only."}</VerdictBlock>;
  if (result.uncertain) return <VerdictBlock signal="unknown" title="Calculation needs checking">{result.assigned.some(plan => plan.overlapReason === "shared-plan") ? "Plans share a receiving pot. We cannot tell whether they describe the same money, so no combined total is shown." : result.assigned.some(plan => plan.overlapUncertain) ? "A planned move may also fund one of these plans. No combined total is shown until the overlap is clear." : "A plan amount is unavailable, so no combined total is shown."}</VerdictBlock>;
  if (account.status === "unfunded") return <VerdictBlock signal="move" title="A planned move is not fully funded">A planned move is not fully funded when it leaves. It may stay put, with no fee.</VerdictBlock>;
  if ((result.planGap ?? 0) > 0) {
    if (account.coverSuggestion) return <VerdictBlock signal="plan" covered title={account.coverSuggestion.shortAfterCover > 0 ? "Payments fit. Plans need more." : "A suggested move would cover plans"}><p><MoneyText text={coveredByMoveSentence(m(result.planGap!), account.coverSuggestion, m(Math.round(account.coverSuggestion.shortAfterCover * 100)))} /> A suggestion only, nothing has been moved. You can also edit the plan.</p></VerdictBlock>;
    return <VerdictBlock signal="plan" title="Payments fit. Plans need more."><p><MoneyText text={`${m(result.planGap!)} more needed for plans${result.estimated ? " · estimated" : ""}. Payments are covered. You can add money or adjust a plan.`} /></p></VerdictBlock>;
  }
  const outgoing = moves.filter(move => move.amount < 0);
  if (outgoing.length) return <VerdictBlock signal="move" title={outgoing.length === 1 ? `A move to ${outgoing[0].counterpartName} is suggested` : "Moves to other accounts are suggested"}><MoneyText text={`Spend from allows for ${m(outgoing.reduce((sum, move) => sum + Math.round(-move.amount * 100), 0))} to ${outgoing.map(move => move.counterpartName).join(", ")}${result.reservedPence > 0 ? result.assigned.length === 1 ? " and your set-aside" : " and your set-asides" : ""}. Nothing has been moved.`} /></VerdictBlock>;
  return <VerdictBlock signal={null} title={result.estimated ? "Payments and set-asides are estimated to fit" : "Payments and plans fit"}>{result.unassigned.length ? "Other set-asides have no known paying account and are not included in this balance." : "Available is this account’s share of your Left to spend, rather than its bank balance."}</VerdictBlock>;
}

function LedgerLine({ label, pence, total = false, positive = false, suggested = false }: { label: string; pence: number | null; total?: boolean; positive?: boolean; suggested?: boolean }) {
  return <div className={`${styles.ledgerLine} ${total ? styles.ledgerTotal : ""} ${suggested ? styles.ledgerSuggestion : ""}`}><dt>{label}{suggested && <span className={styles.suggestionLabel}>Suggested</span>}</dt><dd><AccountMoney pence={pence} exact positive={positive} /></dd></div>;
}

/** G416 approved A. The original forecast and every drill-in stay authoritative. */
export default function UpcomingAccountDetails({ account, periodLabel, plans = [], plansStatus = "ready", onPlan, onEvent, editableEventIds }: UpcomingAccountDetailsProps) {
  const id = useId();
  const { result, available, moves } = accountReading(account, plans, plansStatus);
  const netSuggested = moves.reduce((sum, move) => sum + Math.round(move.amount * 100), 0);
  const conditional = result.afterPlans === null ? null : result.afterPlans + netSuggested;
  const opening = account.opening === null ? null : Math.round(account.opening * 100);
  const listedPayments = opening !== null && [account.opening, account.income, account.transfersIn, account.outgoing].every(Number.isFinite)
    ? opening + Math.round(account.income * 100) + Math.round(account.transfersIn * 100) - Math.round(account.outgoing * 100) : null;
  const forecastDifference = listedPayments === null || result.afterPayments === null ? null : result.afterPayments - listedPayments;
  const activity = [
    ...account.events.map((event, index) => ({ key: `event:${event.id}`, date: event.date, event, move: null as UpcomingSuggestedMove | null, order: index })),
    ...moves.map((move, index) => ({ key: `move:${move.id}`, date: move.byDate, event: null as UpcomingAccountEvent | null, move, order: index })),
  ].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || Number(Boolean(b.move)) - Number(Boolean(a.move)) || a.order - b.order);
  return <div data-g416-account={account.id} className={styles.sheetBody}>
    <section aria-label="Account plan result">
      <div data-account-spend-from><p className={styles.metricLabel}>Spend from</p><p className={styles.primaryAmount}><AccountMoney pence={available} /></p></div>
      <div data-after-payments className={styles.afterPayments}><p className={styles.metricLabel}>After payments</p><p data-account-plan-figure className={styles.secondaryAmount}><AccountMoney pence={result.afterPayments} /></p><p className={styles.note}>Before plans and suggested moves</p></div>
    </section>
    <Verdict account={account} plans={plans} plansStatus={plansStatus} />
    <details data-g416-working className={styles.working}><summary>How this adds up<ChevronDown size={16} aria-hidden="true" /></summary><dl className={styles.ledger}>
      <LedgerLine label="Cash now" pence={account.opening === null ? null : Math.round(account.opening * 100)} />
      {account.income > 0 && <LedgerLine label="Expected income" pence={Math.round(account.income * 100)} positive />}
      {account.transfersIn > 0 && <LedgerLine label="Transfers in" pence={Math.round(account.transfersIn * 100)} positive />}
      <LedgerLine label="Payments to come" pence={-Math.round(account.outgoing * 100)} />
      {forecastDifference !== null && forecastDifference !== 0 && <LedgerLine label="Forecast difference" pence={forecastDifference} positive />}
      <LedgerLine label="After payments" pence={result.afterPayments} total />
      {result.reservedPence > 0 && <><LedgerLine label={result.estimated ? "Still to set aside · estimated" : "Still to set aside"} pence={-result.reservedPence} /><LedgerLine label={result.estimated ? "After payments and plans · estimated" : "After payments and plans"} pence={result.afterPlans} total /></>}
      {moves.map(move => <LedgerLine key={move.id} label={`Move ${move.amount < 0 ? "to" : "from"} ${move.counterpartName}`} pence={Math.round(move.amount * 100)} positive suggested />)}
      {moves.length > 0 && <LedgerLine label={moves.length === 1 ? "If you make the suggested move" : "If you make the suggested moves"} pence={conditional} total />}
    </dl>{forecastDifference !== null && forecastDifference !== 0 && <p className={styles.note}>The listed payments do not fully explain the latest account forecast. The difference is shown above.</p>}{listedPayments === null && result.afterPayments !== null && <p className={styles.note}>Some forecast inputs are unavailable. After payments shows the latest account forecast.</p>}{moves.length > 0 && <p className={styles.note}>The suggested {moves.length === 1 ? "move is" : "moves are"} shown separately from expected payments. Nothing has been moved.</p>}
      <div className={styles.shareLine}><span>Available share of Left to spend</span><strong><AccountMoney pence={available} exact /></strong></div><p className={styles.note}>Your accounts share one Left to spend total. Available also allows for linked plans, timing and suggested moves.</p>
      {account.position?.lowPoint != null && result.afterPayments !== Math.round(account.position.lowPoint * 100) && <dl className={styles.lowPoint}><div><dt>Lowest point before plans</dt><dd><AccountMoney pence={Math.round(account.position.lowPoint * 100)} exact /></dd></div></dl>}
    </details>
    {plansStatus === "ready" && result.assigned.length > 0 && <section aria-labelledby={id + "-plans"} className={styles.detailSection}><h3 id={id + "-plans"}>Still to set aside</h3><ul className={styles.planList}>{result.assigned.map(plan => <PlanRow key={plan.id} plan={plan} onPlan={onPlan} fromBank={hasPlanSource(plan) ? account.bank : undefined} />)}</ul></section>}
    {plansStatus === "ready" && result.unassigned.length > 0 && <section aria-labelledby={id + "-unassigned"} className={styles.detailSection}><h3 id={id + "-unassigned"}>Not assigned to an account</h3><ul className={styles.planList}>{result.unassigned.map(plan => <PlanRow key={plan.id} plan={plan} onPlan={onPlan} fromBank={hasPlanSource(plan) ? account.bank : undefined} />)}</ul></section>}
    {account.hasUnassignedIncome && <p className={styles.note}>Income without a confirmed destination is not included in this account’s working.</p>}
    <section aria-labelledby={id + "-events"} className={styles.detailSection}><h3 id={id + "-events"}>Payments &amp; income</h3>{moves.length > 0 && <p className={styles.note}>Suggested moves are for you to make. They are not scheduled payments.</p>}
      {activity.length ? <ul className={styles.events}>{activity.map(row => row.move ? <SuggestedLine key={row.key} move={row.move} /> : <EventLine key={row.key} event={row.event!} align={Boolean(onEvent)} onEvent={onEvent && (!editableEventIds || editableEventIds.has(row.event!.id)) ? onEvent : undefined} />)}</ul> : <p className={styles.note}>No payments or income expected. {periodLabel}.</p>}
    </section>
  </div>;
}
