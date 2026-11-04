"use client";

import { useEffect, useId, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Check, ChevronDown, ChevronRight, Info, PiggyBank, ReceiptText, TriangleAlert } from "lucide-react";
import { BankBadge, BANK_META, bankKey, bankLogoSrc } from "@/components/AccountMiniCard";
import { MaskedAmount, maskMoneyText, useBalancesHidden } from "@/lib/balancesHidden";
import type { UpcomingFlowNavigation } from "@/components/UpcomingFlowSheet";
import { reading, PERIOD, type Account, type Move, type Status } from "./fixtures";
import styles from "./preview.module.css";

export type Variant = "a" | "b";
export type View = { kind: "account"; accountId: string } | { kind: "event" | "plan"; accountId: string; id: string };
type Reading = ReturnType<typeof reading>;

export function money(pence: number, exact = false) {
  const digits = exact || Math.abs(pence) > 0 && Math.abs(pence) < 100 ? 2 : 0;
  return `${pence < 0 ? "−" : ""}£${(Math.abs(pence) / 100).toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
export function Money({ pence, exact = false, positive = false }: { pence: number | null; exact?: boolean; positive?: boolean }) {
  const hidden = useBalancesHidden();
  if (pence === null) return <span className={styles.unknown}>Not yet known</span>;
  const plus = positive && pence > 0 ? "+" : "";
  return hidden ? <MaskedAmount text={`${pence < 0 ? "−" : plus}£••••`} /> : <span className="money">{plus}{money(pence, exact)}</span>;
}
export function Badge({ account }: { account: Account }) {
  const meta = BANK_META[bankKey({ provider: account.bank })];
  return <BankBadge logoSrc={bankLogoSrc(meta)} initials={meta?.initials ?? account.bank.slice(0, 2).toUpperCase()} initialsSize={meta?.initialsSize} altText="" brandBg={meta?.bg} size={32} />;
}
function Signal({ value }: { value: Reading["signal"] }) {
  const Icon = value === "risk" ? TriangleAlert : Info;
  return value ? <Icon size={14} className={value === "risk" ? styles.risk : value === "watch" ? styles.watch : styles.muted} aria-hidden="true" /> : null;
}
function rowLabel(account: Account, result: Reading, status: Status) {
  const figure = result.headline === null ? "balance not yet known" : `${money(result.headline)}, ${result.gap ? result.earlierGap ? "short before payday" : status === "ready" ? "short after payments and plans" : "short after payments" : status === "ready" && account.plans.length ? "left after payments and plans" : "left after payments"}`;
  const moves = result.moves.map(move => `${money(Math.abs(move.pence), move.pence % 100 !== 0)} ${move.pence < 0 ? `set aside for ${move.bank}` : `suggested from ${move.bank}`}`).join(", ");
  return `Open ${account.bank}, ${account.name}: ${figure}${moves ? `, ${moves}` : ""}${result.afterMove !== null ? `, ${money(result.afterMove)} after the suggested move` : ""}`;
}
function ResultCaption({ result, account, status }: { result: Reading; account: Account; status: Status }) {
  return <>{result.headline === null ? "Check balance" : result.gap ? result.earlierGap ? "Short before payday" : "Short" : status === "ready" && account.plans.length ? "Left after plans" : "Left after payments"}</>;
}
function RowNote({ result, account, status }: { result: Reading; account: Account; status: Status }) {
  if (result.headline === null) return <>This account’s balance needs checking.</>;
  if (status !== "ready") return <>Payments only. Plans are still to be checked.</>;
  const incoming = result.moves.filter(move => move.pence > 0), outgoing = result.moves.filter(move => move.pence < 0);
  if (incoming.length) return <>A <Money pence={incoming.reduce((sum, move) => sum + move.pence, 0)} exact={incoming.some(move => move.pence % 100 !== 0)} /> move from {incoming.map(move => move.bank).join(" and ")}{result.afterMove !== null && result.afterMove >= 0 ? " covers it" : " would help"}. <Money pence={result.afterMove} /> after the move{result.afterMove !== null && result.afterMove < 0 ? ", still short" : ""}.</>;
  if (outgoing.length) return <><Money pence={outgoing.reduce((sum, move) => sum - move.pence, 0)} exact={outgoing.some(move => move.pence % 100 !== 0)} /> set aside for {outgoing.map(move => move.bank).join(" and ")}. <Money pence={result.afterMove} /> after the move.</>;
  if (result.earlierGap) return <>Income arrives after a payment falls due. <Money pence={result.afterPlans} /> left at the end of the period.</>;
  if (result.signal === "risk") return <>Payments need more money{result.firstShort ? ` by ${shortDate(result.firstShort)}` : ""}. Tap to see the gap.</>;
  if (result.gap) return <>Payments are covered. More money is needed for {account.plans.length === 1 ? account.plans[0].name : "your plans"}.</>;
  return null;
}
export function AccountList({ accounts, status, variant, onOpen, retry }: { accounts: Account[]; status: Status; variant: Variant; onOpen(account: Account): void; retry(): void }) {
  const id = useId(), [open, setOpen] = useState(false), [animate, setAnimate] = useState(false);
  useEffect(() => { try { setOpen(sessionStorage.getItem(`g417:fine:${variant}`) === "1"); } catch {} }, [variant]);
  const toggle = () => { setAnimate(true); setOpen(!open); try { sessionStorage.setItem(`g417:fine:${variant}`, open ? "0" : "1"); } catch {} };
  const rows = accounts.map(account => ({ account, result: reading(account, status) }));
  const attention = rows.filter(row => row.result.signal !== null).sort((a, b) => Number(b.result.signal === "risk") - Number(a.result.signal === "risk"));
  const fine = rows.filter(row => row.result.signal === null);
  const needs = attention.filter(row => !row.result.moves.some(move => move.pence < 0));
  const sources = attention.filter(row => row.result.moves.some(move => move.pence < 0));
  const hidden = useBalancesHidden();
  const row = ({ account, result }: typeof rows[number]) => <button type="button" data-account-row={account.id} key={account.id} aria-label={maskMoneyText(rowLabel(account, result, status), hidden)} onClick={() => onOpen(account)} className={`${styles.accountRow} ${result.signal ? styles.attentionRow : ""}`}>
    <span className={styles.bankMark}><Badge account={account} /></span><span className={styles.identity}><strong>{account.bank}</strong><span>{account.name}</span></span>
    <span className={styles.figure}><strong><Money pence={result.headline} /></strong><span className={styles.caption}><Signal value={result.signal} /><ResultCaption result={result} account={account} status={status} /></span></span>
    <ChevronRight size={14} className={styles.chevron} aria-hidden="true" />
    {result.signal && <span className={styles.rowNote}><RowNote account={account} result={result} status={status} /></span>}
  </button>;
  return <section data-account-list data-variant={variant} className={`${styles.accountList} ${variant === "a" ? styles.listA : styles.listB}`} aria-labelledby={id + "-heading"}>
    <div className={styles.listHeading}><h2 id={id + "-heading"}>By account</h2><p>{PERIOD}</p></div>
    {accounts.length === 0 ? <p className={styles.listMessage}>No account payments are expected in this period.</p> : <>
      {attention.length === 0 && <p className={styles.listMessage}><Check size={16} aria-hidden="true" />{status === "ready" ? "Every account covers its payments and linked plans." : "Every account covers its payments. Plans are still to be checked."}</p>}
      {variant === "a" ? attention.map(row) : <>{needs.length > 0 && <section className={styles.actionGroup}><h3>{needs.every(row => row.result.headline === null) ? "Needs checking" : "Needs money"}</h3><div className={styles.groupRows}>{needs.map(row)}</div></section>}{sources.length > 0 && <section className={styles.actionGroup}><h3>Suggested funding</h3><div className={styles.groupRows}>{sources.map(row)}</div></section>}</>}
      {fine.length > 0 && <div className={styles.fineGroup}><button type="button" data-fine-fold aria-expanded={open} aria-controls={id + "-fine"} onClick={toggle} className={styles.fineToggle}><span>{fine.length} {fine.length === 1 ? "account" : "accounts"} {status === "ready" ? fine.length === 1 ? "is fine" : "are fine" : "cover payments"}</span><ChevronDown size={16} aria-hidden="true" className={open ? styles.rotated : ""} /></button><div data-fine-region id={id + "-fine"} inert={!open} className={`grid ${animate ? "transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none" : ""} ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}><div className="min-h-0 overflow-hidden"><div className={styles.fineRows}>{fine.map(row)}</div></div></div></div>}
    </>}
    {status !== "ready" && <p className={styles.pending} role="status">{status === "loading" ? "Checking goals and set-asides. Figures show payments only." : <>Goals and set-asides could not be checked. Figures show payments only. <button type="button" className={styles.retry} onClick={retry}>Try again</button></>}</p>}
    {accounts.length > 0 && <p className={styles.listFootnote}>{rows.some(row => row.result.moves.length > 0) ? "Suggested moves are for you to make. Nothing has been moved." : "Tap an account for its working."}</p>}
  </section>;
}

export function shortDate(date: string) { return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }); }
export function SuggestedRow({ move }: { move: Move }) {
  const Icon = move.pence > 0 ? ArrowDownLeft : ArrowUpRight;
  return <div className={styles.suggestedRow} data-suggested-move={move.id}><Icon size={18} aria-hidden="true" /><span><strong>Move {move.pence > 0 ? "from" : "to"} {move.bank}</strong><small>{move.by ? `By ${shortDate(move.by)}` : "Date not set"} · <span className={styles.suggestedLabel}>Suggested</span></small></span><span className={styles.moveAmount}><Money pence={move.pence} positive exact={move.pence % 100 !== 0} /></span></div>;
}
function LedgerRow({ label, pence, total = false, suggestion = false }: { label: string; pence: number | null; total?: boolean; suggestion?: boolean }) {
  return <div className={`${styles.ledgerRow} ${total ? styles.ledgerTotal : ""} ${suggestion ? styles.suggestionOperand : ""}`}><dt>{label}</dt><dd><Money pence={pence} exact /></dd></div>;
}
export function AccountDetails({ account, status, variant, navigation }: { account: Account; status: Status; variant: Variant; navigation: UpcomingFlowNavigation<View> }) {
  const result = reading(account, status), id = useId();
  const hidden = useBalancesHidden();
  const headline = result.earlierGap ? result.headline : status === "ready" ? result.afterPlans : result.afterPayments;
  const incoming = account.events.filter(event => event.pence > 0).reduce((sum, event) => sum + event.pence, 0);
  const outgoing = account.events.filter(event => event.pence < 0).reduce((sum, event) => sum + event.pence, 0);
  const activity = [...result.events.map(event => ({ key: event.id, date: event.date, event, move: null as Move | null })), ...result.moves.map(move => ({ key: move.id, date: move.by ?? "9999-12-31", event: null, move }))].sort((a, b) => a.date.localeCompare(b.date) || Number(Boolean(b.move)) - Number(Boolean(a.move)));
  return <div data-account-sheet={account.id} data-variant={variant} className={`${styles.sheet} ${variant === "b" ? styles.sheetB : ""}`}>
    <section className={styles.resultBlock} aria-label="Account result before suggested moves"><p className={styles.metricLabel}>{result.earlierGap ? "Short before income arrives" : status === "ready" ? "After payments and plans" : "After payments"}</p><div className={styles.headline}><strong data-pre-move><Money pence={headline} /></strong>{result.gap !== null && result.gap > 0 && <span className={styles.shortStatus}><Signal value={result.signal} />Short</span>}</div><p className={styles.note}>{headline === null ? "This account’s balance needs checking." : result.earlierGap ? `Money is needed by ${result.firstShort ? shortDate(result.firstShort) : "the next payment"}, before income arrives.` : status !== "ready" ? "Before goals, set-asides and suggested moves." : result.gap ? "Before suggested moves. This is the gap to act on." : "Before suggested moves."}</p>
      {result.earlierGap && <p className={styles.note}>{status === "ready" ? "After payments and plans" : "After payments"}: <Money pence={status === "ready" ? result.afterPlans : result.afterPayments} /> at the end of the period. That later balance does not remove this earlier gap.</p>}
    </section>
    {result.moves.length > 0 && <section className={styles.moveBridge} aria-label="Effect of suggested moves"><div className={styles.afterMove}><p className={styles.metricLabel}>Balance after the suggested {result.moves.length === 1 ? "move" : "moves"}</p><strong data-after-move><Money pence={result.afterMove} /></strong></div>{result.moves.map(move => <SuggestedRow move={move} key={move.id} />)}<p className={styles.note}>{result.afterMove !== null && result.afterMove < 0 ? "The suggestion leaves a gap. More money is still needed." : result.moves.some(move => move.pence < 0) ? "This includes the amount set aside for the other account." : "The suggestion covers this gap. You still need to make the move."}</p></section>}
    {result.moves.length === 0 && result.headline !== null && <div className={styles.verdict}><Signal value={result.signal} /><p>{result.signal === "risk" ? status === "ready" ? "Payments need more money. No covering move is suggested." : "Payments need more money. Suggested moves are still to be checked." : result.gap ? "Payments are covered. Check the plans still to set aside below." : status === "ready" ? "Payments and linked plans are covered." : "Payments are covered. Plans are still to be checked."}</p></div>}
    {status !== "ready" && <p className={styles.note} role="status">{status === "loading" ? "Checking goals and set-asides. The account’s full result is not known yet." : "Goals and set-asides could not be checked. Close this sheet and try again."}</p>}
    <details data-working className={styles.working} open={variant === "b" ? true : undefined}><summary>How this adds up<ChevronDown size={16} aria-hidden="true" /></summary><dl>
      <LedgerRow label="Cash now" pence={account.opening} />{incoming > 0 && <LedgerRow label="Income to come" pence={incoming} />}{outgoing < 0 && <LedgerRow label="Payments to come" pence={outgoing} />}<LedgerRow label="After payments" pence={result.afterPayments} total />
      {status === "ready" && result.reserved !== null && result.reserved > 0 && <LedgerRow label="Still to set aside" pence={-result.reserved} />}{status === "ready" && result.reserved !== null && result.reserved > 0 && <LedgerRow label="After payments and plans" pence={result.afterPlans} total />}
      {result.moves.map(move => <LedgerRow key={move.id} label={`Suggested ${move.pence > 0 ? "from" : "to"} ${move.bank}`} pence={move.pence} suggestion />)}{result.moves.length > 0 && <LedgerRow label={result.moves.length === 1 ? "If you make the suggested move" : "If you make the suggested moves"} pence={result.afterMove} total />}
    </dl><p className={styles.note}>{status !== "ready" ? "Goals and set-asides are not included while they are being checked." : "Suggested moves are separate from expected payments. Nothing has been moved."}</p></details>
    {status === "ready" && account.plans.length > 0 && <section className={styles.evidenceSection} aria-labelledby={id + "-plans"}><h3 id={id + "-plans"}>Still to set aside</h3><ul className={styles.activity}>{account.plans.map(plan => <li key={plan.id}><button type="button" data-flow-focus={`plan-${plan.id}`} onClick={() => navigation.goTo({ kind: "plan", accountId: account.id, id: plan.id })} className={styles.activityRow} aria-label={maskMoneyText(`View ${plan.name}, ${money(plan.pence, true)} still to set aside`, hidden)}><PiggyBank size={18} aria-hidden="true" /><span><strong>{plan.name}</strong><small>{plan.note}</small></span><span className={styles.moveAmount}><Money pence={plan.pence} exact /></span><ChevronRight size={14} aria-hidden="true" /></button></li>)}</ul></section>}
    <section className={styles.evidenceSection} aria-labelledby={id + "-activity"}><h3 id={id + "-activity"}>Payments &amp; income</h3>{result.moves.length > 0 && <p className={styles.note}>Suggested moves are for you to make. They are not scheduled payments.</p>}<ul className={styles.activity}>{activity.map(row => <li key={row.key}>{row.move ? <SuggestedRow move={row.move} /> : row.event && <button type="button" data-event-row={row.event.id} data-flow-focus={`event-${row.event.id}`} onClick={() => navigation.goTo({ kind: "event", accountId: account.id, id: row.event!.id })} className={styles.activityRow} aria-label={maskMoneyText(`View ${row.event.name}, ${money(row.event.pence, true)}, ${shortDate(row.event.date)}`, hidden)}>{row.event.kind === "income" ? <ArrowDownLeft size={18} aria-hidden="true" /> : <ReceiptText size={18} aria-hidden="true" />}<span><strong>{row.event.name}</strong><small>{shortDate(row.event.date)}</small></span><span className={styles.moveAmount}><Money pence={row.event.pence} positive exact /></span><ChevronRight size={14} aria-hidden="true" /></button>}</li>)}</ul></section>
  </div>;
}
export function RecordDetails({ view, account }: { view: Exclude<View, { kind: "account" }>; account: Account }) {
  const record = view.kind === "plan" ? account.plans.find(plan => plan.id === view.id)! : account.events.find(event => event.id === view.id)!;
  return <div className={styles.sheet}><p className={styles.metricLabel}>{view.kind === "plan" ? "Still to set aside" : record.pence > 0 ? "Expected income" : "Expected payment"}</p><p className={styles.recordAmount}><Money pence={record.pence} exact /></p><dl><div className={styles.ledgerRow}><dt>{view.kind === "plan" ? "Paid from" : "Account"}</dt><dd>{account.bank}</dd></div></dl><p className={styles.note}>{account.name}{"date" in record ? ` · ${shortDate(record.date)}` : " · This pay period"}</p><p className={styles.demoNote}>Fictional example for this design round. Use Back to return to the account.</p></div>;
}
