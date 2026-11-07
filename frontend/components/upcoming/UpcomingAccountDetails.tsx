"use client";

import { useId, type ReactNode } from "react";
import { ArrowDownLeft, ArrowUpRight, ChevronDown, ChevronRight, PiggyBank } from "lucide-react";
import { useColours } from "@/components/ColourProvider";
import { useCategoryIcons } from "@/components/IconProvider";
import { accountPaymentGap, type UpcomingAccountEvent, type UpcomingAccountSummary, type UpcomingSuggestedMove } from "@/lib/upcomingAccounts";
import { fulfilmentRow, hasPlanSource, remaining, type Plan } from "@/lib/upcomingPlans";
import { cardRepaymentShortCopy, type AccountStatus } from "@/lib/upcomingAccountStatus";
import { accountActionReading, accountCoverLine } from "@/lib/upcomingAccountPresentation";
import { UNCOVERED_OPTIONS } from "@/lib/coverNarrative";
import { money, useMaskedMoney } from "./detailPrimitives";
import { useBalancesHidden, maskMoneyText } from "@/lib/balancesHidden";
import { AccountMoney, AccountSignal } from "./accountPresentation";
import styles from "./UpcomingAccounts.module.css";
import MoneyText from "@/components/MoneyText";
import CoverNote from "@/components/CoverNote";
import UpcomingCategoryIcon, { upcomingCategoryAppearance } from "./UpcomingCategoryIcon";

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
  const { colours } = useColours();
  const { icons } = useCategoryIcons();
  const uncounted = event.credited === false;
  const incoming = event.kind === "income" || event.kind === "inflow";
  const category = event.category || (event.kind === "movement" || event.kind === "inflow" ? "Transfer" : undefined);
  const appearance = upcomingCategoryAppearance(category, incoming ? "income" : "bill", colours, icons);
  const content = <><UpcomingCategoryIcon {...appearance} /><span className={styles.eventIdentity}><strong>{event.name}</strong><small>{activityDate(event.date)}{uncounted ? " · Not counted until it is confirmed." : ""}</small></span><span data-uncredited-income={uncounted ? "true" : undefined} className={styles.eventAmount}><AccountMoney pence={Math.round(event.amount * 100)} exact positive={incoming} /></span>{onEvent && <ChevronRight size={14} className={styles.muted} aria-hidden="true" />}</>;
  return <li>{onEvent ? <button type="button" data-flow-focus={`event-${event.id}`} aria-label={maskMoneyText(`${event.name}, ${activityDate(event.date)}, ${money(Math.round(event.amount * 100), incoming)}. Open details`, hidden)} onClick={() => onEvent(event.id)} className={`${styles.eventRow} ${styles.eventEditable} min-h-11`}>{content}</button> : <div className={`${styles.eventRow} ${align ? styles.eventEditable : ""}`}>{content}</div>}</li>;
}

function SuggestedContent({ move }: { move: UpcomingSuggestedMove }) {
  const Icon = move.amount > 0 ? ArrowDownLeft : ArrowUpRight;
  return <div className={styles.eventRow}>
    <span className={styles.eventIcon}><Icon size={18} aria-hidden="true" /></span>
    <span className={styles.eventIdentity}><strong>Move {move.amount < 0 ? "to" : "from"} {move.counterpartName}</strong><small>{move.byDate ? <>By <time dateTime={move.byDate}>{activityDate(move.byDate)}</time></> : "Date not set"} · <span className={styles.suggestionLabel}>Suggested</span></small></span>
    <span className={styles.eventAmount}><AccountMoney pence={Math.round(move.amount * 100)} exact={Math.round(move.amount * 100) % 100 !== 0} positive /></span>
  </div>;
}
function SuggestedLine({ move }: { move: UpcomingSuggestedMove }) {
  return <li data-suggested-move={move.id} className={styles.suggestedEvent}><SuggestedContent move={move} /></li>;
}

function PlanRow({ plan, onPlan }: { plan: Plan; onPlan?: (id: string) => void }) {
  const hidden = useBalancesHidden();
  const unassigned = !hasPlanSource(plan), estimated = !unassigned && plan.evidence === "recent-transfers";
  const paid = unassigned ? null : fulfilmentRow(plan);
  const content = <><PiggyBank size={18} aria-hidden="true" className={styles.muted} /><span className={styles.planIdentity}>{plan.name}<small>{unassigned ? "Choose paying account" : paid ? <MoneyText text={maskMoneyText(paid.detail, hidden)} /> : "Still to set aside this period"}</small>{estimated && <small>Paying account based on recent transfers</small>}</span><span className={styles.planAmount}><strong>{plan.amountUnavailable ? "Not yet known" : paid ? <MoneyText text={maskMoneyText(paid.amount, hidden)} /> : <AccountMoney pence={remaining(plan)} exact />}</strong>{(unassigned || paid || estimated) && <small>{unassigned ? "unassigned" : paid ? paid.status : "estimated"}</small>}</span>{onPlan && <ChevronRight size={14} aria-hidden="true" className={styles.muted} />}</>;
  return <li>{onPlan ? <button type="button" data-flow-focus={`plan-${plan.id}`} onClick={() => onPlan(plan.id)} className={`${styles.planRow} ${styles.planEditable}`}>{content}</button> : <div className={styles.planRow}>{content}</div>}</li>;
}

function VerdictBlock({ title, children, signal, covered = false }: { title: ReactNode; children?: ReactNode; signal: AccountStatus["signal"]; covered?: boolean }) {
  return <div data-verdict className={styles.verdict}>{signal && <span className={styles.verdictSignal}><AccountSignal signal={signal} /></span>}<div><p data-covered-by-move={covered || undefined} className={styles.verdictTitle}>{title}</p>{children && <div className={styles.note}>{children}</div>}</div></div>;
}

function Verdict({ account, plans, plansStatus }: Required<Pick<UpcomingAccountDetailsProps, "account" | "plans" | "plansStatus">>) {
  const m = useMaskedMoney(), hidden = useBalancesHidden();
  const reading = accountActionReading(account, plans, plansStatus);
  const { result, signal, moves, gap: fullGap, combinedKnown } = reading;
  const gap = accountPaymentGap(account);
  const uncounted = Math.round(account.events.filter(event => event.credited === false).reduce((sum, event) => sum + event.amount, 0) * 100);
  const uncountedLine = uncounted > 0 ? <p data-uncredited-note><MoneyText text={`Expected ${m(uncounted)} is not counted until it is confirmed.`} /></p> : null;
  if (gap !== null) {
    const named = account.shortFor?.cardRepayment ? <p data-card-repayment-short><MoneyText text={maskMoneyText(cardRepaymentShortCopy({ ...account, shortfall: gap }), hidden)} />{signal === "risk" ? ". A missed repayment can bring fees and interest. Goals and allocations are separate from this bill gap." : "."}</p> : null;
    // G426: an own-savings standing order on the same account keeps its own amber sentence beside the payment gap.
    const savingsLine = account.position?.savingsAtRisk ? <p data-savings-at-risk>{account.position.savingsAtRisk.note}</p> : null;
    if (moves.length) return named || uncountedLine || savingsLine ? <div className={styles.warningNote}>{named}{uncountedLine}{savingsLine}</div> : null;
    return <VerdictBlock signal="risk" title={plansStatus === "ready" ? "Payments need more money. No covering move is suggested." : "Payments need more money. Suggested moves are still to be checked."}>{named}{uncountedLine}{savingsLine}{plansStatus === "ready" && <p data-uncovered-options>{UNCOVERED_OPTIONS}</p>}</VerdictBlock>;
  }
  if (account.status === "unknown") return <VerdictBlock signal="unknown" title="Balance needs checking">Payments are listed, but the account’s result cannot be confirmed without a balance.</VerdictBlock>;
  if (plansStatus !== "ready") return <VerdictBlock signal="unknown" title={plansStatus === "loading" ? "Loading goals and allocations" : "Goals and allocations need checking"}>{plansStatus === "loading" ? "Loading goals and allocations. This figure covers payments only." : "Goals and allocations could not be checked. This figure covers payments only."}</VerdictBlock>;
  if (result.uncertain) return <VerdictBlock signal="unknown" title="Calculation needs checking">{result.assigned.some(plan => plan.overlapReason === "shared-plan") ? "Plans share a receiving pot. We cannot tell whether they describe the same money, so no combined total is shown." : result.assigned.some(plan => plan.overlapUncertain) ? "A planned move may also fund one of these plans. No combined total is shown until the overlap is clear." : "The full effect of these plans cannot be confirmed yet, so no combined total is shown."}</VerdictBlock>;
  // G422: an own-savings standing order this account cannot fund. Amber, never a payment gap; the engine's own sentence says what would cover it or that nothing can.
  if (account.status === "unfunded" && account.position?.savingsAtRisk) return <VerdictBlock signal="move" covered={!account.position.savingsAtRisk.noCover && account.position.savingsAtRisk.covered + 0.005 >= account.position.savingsAtRisk.amount} title="A savings transfer is not fully funded"><p data-savings-at-risk>{account.position.savingsAtRisk.note}</p></VerdictBlock>;
  if (account.status === "unfunded") return <VerdictBlock signal="move" title="A planned move is not fully funded">A planned move is not fully funded when it leaves. It may stay put, with no fee.</VerdictBlock>;
  if (moves.length) return null;
  if (fullGap > 0) {
    return <VerdictBlock signal="plan" title="Payments are covered. Check the plans still to set aside below."><p><MoneyText text={`${m(fullGap)} more needed for plans${result.estimated ? " · estimated" : ""}. You can add money or adjust a plan.`} /></p></VerdictBlock>;
  }
  return <VerdictBlock signal={null} title={result.estimated ? "Payments and linked plans are estimated to be covered." : "Payments and linked plans are covered."}>{result.unassigned.length ? "Other set-asides have no known paying account and are not included in this balance." : !combinedKnown ? "The full result still needs checking." : null}</VerdictBlock>;
}

function LedgerLine({ label, pence, total = false, positive = false, suggested = false }: { label: string; pence: number | null; total?: boolean; positive?: boolean; suggested?: boolean }) {
  return <div className={`${styles.ledgerLine} ${total ? styles.ledgerTotal : ""} ${suggested ? styles.ledgerSuggestion : ""}`}><dt>{label}</dt><dd><AccountMoney pence={pence} exact positive={positive} /></dd></div>;
}

/** G417 approved A. The original forecast and every drill-in stay authoritative. */
export default function UpcomingAccountDetails({ account, periodLabel, plans = [], plansStatus = "ready", onPlan, onEvent, editableEventIds }: UpcomingAccountDetailsProps) {
  const id = useId();
  const hidden = useBalancesHidden();
  const reading = accountActionReading(account, plans, plansStatus);
  const coverLine = accountCoverLine(reading);
  const { result, headline, combinedKnown, earlierGap, futureIncome, moves, afterMove, signal, ready } = reading;
  const opening = account.opening === null ? null : Math.round(account.opening * 100);
  const listedPayments = opening !== null && [account.opening, account.income, account.transfersIn, account.outgoing].every(Number.isFinite)
    ? opening + Math.round(account.income * 100) + Math.round(account.transfersIn * 100) - Math.round(account.outgoing * 100) : null;
  const forecastDifference = listedPayments === null || result.afterPayments === null ? null : result.afterPayments - listedPayments;
  const activity = [
    ...account.events.map((event, index) => ({ key: `event:${event.id}`, date: event.date, event, move: null as UpcomingSuggestedMove | null, order: index })),
    ...moves.map((move, index) => ({ key: `move:${move.id}`, date: move.byDate, event: null as UpcomingAccountEvent | null, move, order: index })),
  ].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || Number(Boolean(b.move)) - Number(Boolean(a.move)) || a.order - b.order);
  return <div data-g417-account={account.id} data-g416-account={account.id} className={styles.sheetBody}>
    <section className={styles.resultBlock} aria-label="Account result before suggested moves">
      <p className={styles.metricLabel}>{earlierGap ? futureIncome ? "Short before income arrives" : "Short earlier in this period" : combinedKnown ? "After payments and plans" : "After payments"}</p>
      <div className={styles.headline}><strong data-pre-move data-account-plan-figure><AccountMoney pence={headline} /></strong>{reading.gap > 0 && <span className={styles.shortStatus}><AccountSignal signal={signal} />Short</span>}</div>
      <p className={styles.note}>{headline === null ? "This account’s balance needs checking." : earlierGap ? `${account.firstShortDate ? `First shortfall ${activityDate(account.firstShortDate)}${futureIncome ? ", before income arrives" : ""}.` : "This account has an earlier shortfall."} The figure is the largest gap in this period.` : !ready ? "Before goals, set-asides and suggested moves." : !combinedKnown ? "Payments only. Plans need checking." : reading.gap > 0 ? "Before suggested moves. This is the gap to act on." : "Before suggested moves."}</p>
      {earlierGap && <p className={styles.note}>{combinedKnown ? "After payments and plans" : "After payments"}: <AccountMoney pence={combinedKnown ? reading.afterPlans : reading.afterPayments} /> at the end of the period. That later balance does not remove this earlier gap.</p>}
      {result.estimated && ready && <p className={styles.note}>Paying account based on recent transfers · estimated</p>}
    </section>
    {moves.length > 0 && <section data-verdict data-covered-by-move={reading.incoming > 0 || undefined} className={styles.moveBridge} aria-label="Effect of suggested moves">
      <div className={styles.afterMove}><p className={styles.metricLabel}>Balance after the suggested {moves.length === 1 ? "move" : "moves"}</p><strong data-after-move><AccountMoney pence={afterMove} /></strong></div>
    </section>}
    {coverLine && <CoverNote data-cover-line data-cover-savings={moves.some(move => move.savings) ? "true" : undefined} className="text-[13px]"><MoneyText text={maskMoneyText(coverLine, hidden)} /></CoverNote>}
    <Verdict account={account} plans={plans} plansStatus={plansStatus} />
    {plansStatus !== "ready" && <p className={styles.note} role="status">{plansStatus === "loading" ? "Checking goals and set-asides. The account’s full result is not known yet." : "Goals and set-asides could not be checked. Close this sheet and try again."}</p>}
    <details data-g417-working data-g416-working className={styles.working}><summary>How this adds up<ChevronDown size={16} aria-hidden="true" /></summary><dl className={styles.ledger}>
      <LedgerLine label="Cash now" pence={account.opening === null ? null : Math.round(account.opening * 100)} />
      {account.income > 0 && <LedgerLine label="Income to come" pence={Math.round(account.income * 100)} positive />}
      {account.transfersIn > 0 && <LedgerLine label="Transfers in" pence={Math.round(account.transfersIn * 100)} positive />}
      <LedgerLine label="Payments to come" pence={-Math.round(account.outgoing * 100)} />
      {forecastDifference !== null && forecastDifference !== 0 && <LedgerLine label="Forecast difference" pence={forecastDifference} positive />}
      <LedgerLine label="After payments" pence={result.afterPayments} total />
      {ready && result.reservedPence > 0 && <><LedgerLine label={result.estimated ? "Still to set aside · estimated" : "Still to set aside"} pence={-result.reservedPence} /><LedgerLine label={result.estimated ? "After payments and plans · estimated" : "After payments and plans"} pence={reading.afterPlans} total /></>}
      {moves.map(move => <LedgerLine key={move.id} label={`Suggested ${move.amount < 0 ? "to" : "from"} ${move.counterpartName}${move.savings ? " (savings)" : ""}`} pence={Math.round(move.amount * 100)} suggested />)}
      {moves.length > 0 && <LedgerLine label={moves.length === 1 ? "If you make the suggested move" : "If you make the suggested moves"} pence={afterMove} total />}
    </dl>{forecastDifference !== null && forecastDifference !== 0 && <p className={styles.note}>The listed payments do not fully explain the latest account forecast. The difference is shown above.</p>}{listedPayments === null && result.afterPayments !== null && <p className={styles.note}>Some forecast inputs are unavailable. After payments shows the latest account forecast.</p>}{moves.length > 0 && <p className={styles.note}>Suggested moves are separate from expected payments. Nothing has been moved.</p>}
      {account.position?.lowPoint != null && result.afterPayments !== Math.round(account.position.lowPoint * 100) && <dl className={styles.lowPoint}><div><dt>Lowest point before plans</dt><dd><AccountMoney pence={Math.round(account.position.lowPoint * 100)} exact /></dd></div></dl>}
      {combinedKnown && account.position?.lowPointAndPlans != null && reading.afterPlans !== Math.round(account.position.lowPointAndPlans * 100) && <dl className={styles.lowPoint}><div><dt>Lowest point after plans</dt><dd><AccountMoney pence={Math.round(account.position.lowPointAndPlans * 100)} exact /></dd></div></dl>}
    </details>
    {plansStatus === "ready" && result.assigned.length > 0 && <section aria-labelledby={id + "-plans"} className={styles.detailSection}><h3 id={id + "-plans"}>Still to set aside</h3><ul className={styles.planList}>{result.assigned.map(plan => <PlanRow key={plan.id} plan={plan} onPlan={onPlan} />)}</ul></section>}
    {plansStatus === "ready" && result.unassigned.length > 0 && <section aria-labelledby={id + "-unassigned"} className={styles.detailSection}><h3 id={id + "-unassigned"}>Not assigned to an account</h3><ul className={styles.planList}>{result.unassigned.map(plan => <PlanRow key={plan.id} plan={plan} onPlan={onPlan} />)}</ul></section>}
    {account.hasUnassignedIncome && <p className={styles.note}>Income without a confirmed destination is not included in this account’s working.</p>}
    <section aria-labelledby={id + "-events"} className={styles.detailSection}><h3 id={id + "-events"}>Payments &amp; income</h3>{moves.length > 0 && <p className={styles.note}>Suggested moves are for you to make. They are not scheduled payments.</p>}
      {activity.length ? <ul className={styles.events}>{activity.map(row => row.move ? <SuggestedLine key={row.key} move={row.move} /> : <EventLine key={row.key} event={row.event!} align={Boolean(onEvent)} onEvent={onEvent && (!editableEventIds || editableEventIds.has(row.event!.id)) ? onEvent : undefined} />)}</ul> : <p className={styles.note}>No payments or income expected. {periodLabel}.</p>}
    </section>
  </div>;
}
