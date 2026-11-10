"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import MoneyText from "@/components/MoneyText";
import FilingSourceIcon from "@/components/FilingSourceIcon";
import { SheetFrame } from "@/components/SheetFrame";
import { usePreferences } from "@/components/PreferencesContext";
import { api } from "@/lib/api";
import { invalidateAfterTransactionCorrection, notifyTransactionsChanged } from "@/lib/cacheInvalidation";
import {
  filedTransferAccountLabel, filedTransferRoute, filingDateRange, filedSeriesHistoryHref, recentFiledTransfers, shortFilingDate, movementMoney, maskFilingCopy, type FiledTransferItem,
  type FiledTransfersQuery, type FiledTransfersResponse, type FilingSource,
} from "@/lib/filedTransfers";
import styles from "./FiledTransfersSheet.module.css";

const PAGE_SIZE = 10;
type Period = { start: string; end: string; label: string };

export interface FiledTransfersSheetProps {
  onClose: () => void;
  onChanged?: (ids: string[]) => void;
  onOpenReview?: () => void;
  period?: Period;
  initialSource?: FilingSource;
  expectedTotal?: number | null;
  nested?: boolean;
}

function sourceLabel(actor: FiledTransferItem["actor"]): string | null {
  if (actor === "sorted") return "Filed by Sorted";
  if (actor === "user") return "You confirmed";
  return null;
}

function account(item: FiledTransferItem): string | null {
  const one = item.from_account && filedTransferAccountLabel(item.from_account);
  const two = item.to_account && filedTransferAccountLabel(item.to_account);
  return one && two ? `${one} to ${two}` : one || two || null;
}

function periodQuery(period: Period | undefined, source: FilingSource, page: number): FiledTransfersQuery {
  return { ...(period ? { from: period.start, to: period.end } : {}), source, page, page_size: PAGE_SIZE };
}

function Row({ item, hidden, undoDisabled, historyStale, onAskUndo, onOpenTransactions }: {
  item: FiledTransferItem; hidden: boolean; undoDisabled: boolean; historyStale: boolean; onAskUndo: (item: FiledTransferItem) => void; onOpenTransactions: (href: string, event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const actor = sourceLabel(item.actor);
  const dates = filingDateRange(item.first_date, item.last_date);
  const header = maskFilingCopy(filedTransferRoute(item), hidden);
  const accountText = account(item);
  const occurrences = recentFiledTransfers(item.occurrences);
  const transactionsHref = filedSeriesHistoryHref(item);
  const allCount = item.all_time_count ?? item.count;
  return <details className={styles.row} data-filed-row onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary tabIndex={0}>
      <span className={styles.route}>{header}<small>{item.kind === "own_transfer" ? "Own-account transfer" : "Other movement"}</small></span>
      <span className={styles.amount}><MoneyText className="money" text={movementMoney(item.total_amount, item.currency, undefined, hidden)} /><small>Total</small></span>
      <ChevronDown size={17} aria-hidden="true" className={styles.chevron} />
      <span className={styles.meta}>
        {actor ? <span className={styles.actor}><FilingSourceIcon actor={item.actor === "user" ? "user" : "sorted"} size={14} />{actor}</span> : <span>Filing source unavailable</span>}
        <span>{item.count} {item.count === 1 ? "payment" : "payments"}{dates ? ` · ${dates}` : ""}</span>
        <span className={styles.pattern}><MoneyText text={[item.cadence, item.amount_pattern ? (hidden ? "Amount pattern hidden" : item.amount_pattern) : null].filter(Boolean).join(" · ") || "Filed movement"} /></span>
      </span>
    </summary>
    {expanded ? <div className={styles.detail}>
      {accountText ? <p>{maskFilingCopy(accountText, hidden)}</p> : null}
      {item.reason ? <p className={styles.reason}><MoneyText text={hidden ? "Filing reason hidden while balances are hidden." : item.reason} /></p> : null}
      {occurrences.length ? <>
        <p className={styles.receiptNote}>Showing {occurrences.length} of {item.count} {item.count === 1 ? "transfer" : "transfers"}{item.count > occurrences.length ? ", most recent first" : ""}.</p>
        <table className={styles.receiptTable} data-filed-receipt>
          <caption className="sr-only">Recent transfers for {header}</caption>
          <thead><tr><th scope="col">Date</th><th scope="col">From and to</th><th scope="col">Amount</th></tr></thead>
          <tbody>{occurrences.map((occurrence, index) => {
            const { debit, credit } = occurrence;
            const leg = debit ?? credit;
            const from = debit ? filedTransferAccountLabel({ bank: debit.account_bank, name: debit.account_name }) : "Source not recorded";
            const to = credit ? filedTransferAccountLabel({ bank: credit.account_bank, name: credit.account_name }) : "Destination not recorded";
            const differentCredit = debit && credit && (debit.currency !== credit.currency || debit.amount !== credit.amount);
            const receivedDate = debit && credit && debit.date.slice(0, 10) !== credit.date.slice(0, 10) ? shortFilingDate(credit.date) : null;
            return <tr key={`${occurrence.date}:${debit?.id ?? credit?.id ?? index}`} data-filed-transfer>
              <td><time dateTime={leg?.date ?? occurrence.date}>{shortFilingDate(leg?.date ?? occurrence.date) ?? "Date unavailable"}</time></td>
              <td><span className={styles.transferRoute}>{maskFilingCopy(from, hidden)}<span>to {maskFilingCopy(to, hidden)}</span></span>{receivedDate ? <small>Received {receivedDate}</small> : null}</td>
              <td><span className="money" aria-label={hidden && leg ? `${leg.transaction_type === "debit" ? "Outgoing" : "Incoming"} amount hidden` : undefined}><MoneyText text={leg ? movementMoney(leg.amount, leg.currency, leg.transaction_type, hidden) : "Amount unavailable"} /></span>{differentCredit ? <small className={styles.receivedAmount}>Received <MoneyText text={movementMoney(credit.amount, credit.currency, "credit", hidden)} /></small> : null}</td>
            </tr>;
          })}</tbody>
        </table>
      </> : <p className={styles.disabled}>Recent transfer details are unavailable.</p>}
      {!item.history_complete ? <p className={styles.disabled}>Some older receipt evidence is unavailable.</p> : null}
      <div className={styles.actions}>
        {item.can_undo ? <button type="button" className={styles.linkButton} disabled={undoDisabled} onClick={() => onAskUndo(item)}><RotateCcw size={15} aria-hidden="true" />Undo this series</button> : null}
        {transactionsHref ? <a className={styles.transactionLink} href={transactionsHref} onClick={event => onOpenTransactions(transactionsHref, event)}>{historyStale || !item.history_complete ? "See recorded transfers in transactions" : `See all ${allCount.toLocaleString("en-GB")} in transactions`}</a> : null}
      </div>
    </div> : null}
  </details>;
}

export default function FiledTransfersSheet({ onClose, onChanged, onOpenReview, period, initialSource = "all", expectedTotal, nested = false }: FiledTransfersSheetProps) {
  const router = useRouter();
  const { hideNetWorth, preferencesReady } = usePreferences();
  const hidden = hideNetWorth || !preferencesReady;
  const [source, setSource] = useState<FilingSource>(initialSource);
  const [data, setData] = useState<FiledTransfersResponse | null>(null);
  const [dataScope, setDataScope] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<FiledTransferItem | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState("");
  const [undoUncertain, setUndoUncertain] = useState(false);
  const [flushPending, setFlushPending] = useState<{ ids: string[]; count: number } | null>(null);
  const [closeStatus, setCloseStatus] = useState("");
  const latest = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const wasConfirming = useRef(false);
  const scopeKey = period ? `${period.start}:${period.end}` : "all";
  useEffect(() => {
    if (pending || wasConfirming.current) headingRef.current?.focus({ preventScroll: true });
    wasConfirming.current = pending !== null;
  }, [pending]);

  const load = (nextSource = source, nextPage = page) => {
    const request = ++latest.current;
    setLoading(true); setError(false);
    api.getFiledTransfers(periodQuery(period, nextSource, nextPage)).then(result => {
      if (request !== latest.current) return;
      if (result.pages !== null && result.pages > 0 && nextPage > result.pages) { setPage(result.pages); return; }
      setData(result); setDataScope(scopeKey); setLoading(false);
    }).catch(() => { if (request === latest.current) { setError(true); setLoading(false); } });
  };
  useEffect(() => {
    // Reset this remote request's loading state before awaiting its result.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(source, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, page, period?.start, period?.end]);
  useEffect(() => () => { latest.current += 1; }, []);

  function chooseSource(next: FilingSource) { latest.current += 1; setLoading(true); setError(false); setSource(next); setPage(1); if (next === source && page === 1) load(next, 1); }
  function choosePage(next: number) { latest.current += 1; setLoading(true); setError(false); setPage(next); }
  function openTransactions(href: string, event: MouseEvent<HTMLAnchorElement>, closeThen: (next: () => void) => void) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    // SheetFrame consumes its history entry and restores focus before the
    // route replaces this surface.
    closeThen(() => router.push(href));
  }
  async function flush(ids: string[], count: number): Promise<boolean> {
    try {
      const result = await api.finishTransferReview();
      if (result.pending) throw new Error("pending");
      invalidateAfterTransactionCorrection("", {});
      notifyTransactionsChanged(ids);
      onChanged?.(ids);
      setFlushPending(null); setPending(null); setUndoError(""); setUndoUncertain(false); setCloseStatus("");
      load(source, page);
      return true;
    } catch {
      // The write is already durable. Leave the confirmation before offering
      // the refresh retry so this path cannot submit the undo a second time.
      setPending(null); setUndoError(""); setFlushPending({ ids, count });
      return false;
    }
  }
  async function confirmUndo() {
    if (!pending || undoing || undoUncertain) return;
    setUndoing(true); setUndoError("");
    try {
      const result = await api.undoFiledTransfer(pending.series_key);
      const ids = result.transaction_ids || [];
      // The durable write has happened. Never let an interrupted route keep
      // warm figures that still include it while the H145 refresh catches up.
      invalidateAfterTransactionCorrection("", {});
      if (!await flush(ids, result.undone)) setUndoError("The series is undone. Totals still need to refresh.");
    } catch {
      invalidateAfterTransactionCorrection("", {});
      setUndoUncertain(true);
      setUndoError("Could not confirm Undo. Reload history before trying again.");
    }
    finally { setUndoing(false); }
  }
  async function retryFlush() { if (flushPending && !undoing) { setUndoing(true); await flush(flushPending.ids, flushPending.count); setUndoing(false); } }
  async function beforeClose() {
    if (undoUncertain) return flush([], 0);
    if (!flushPending) return true;
    const completed = await flush(flushPending.ids, flushPending.count);
    if (!completed) setCloseStatus("The Undo is saved, but totals still need to refresh. Use Refresh totals and try again.");
    return completed;
  }

  const visibleData = dataScope === scopeKey ? data : null;
  const hasHistory = visibleData && visibleData.status !== "preparing" && typeof visibleData.total_series === "number";
  const totalSeries = visibleData?.total_series ?? 0;
  const displayedSource = visibleData?.source || source;
  const scopeTotal = hasHistory ? visibleData.scope_total : expectedTotal;
  const stale = visibleData?.status === "stale";
  const preparing = visibleData?.status === "preparing";
  const totalMismatch = !loading && period && displayedSource === "all" && typeof scopeTotal === "number" && typeof expectedTotal === "number" && Math.abs(scopeTotal - expectedTotal) > 0.009;
  const sourceName = source === "all" ? "all filing sources" : source === "sorted" ? "Filed by Sorted" : "You confirmed";
  const historyBlocked = loading || error || stale || preparing || !!flushPending;
  const title = pending ? "Undo this series?" : "Transfers Sorted filed";
  const description = period ? period.label : "All time";
  return <SheetFrame title={title} description={description} headingRef={headingRef} onClose={onClose} beforeClose={beforeClose} nested={nested} dismissDisabled={undoing || !!flushPending}
    footer={({ close }) => pending ? <div className={styles.confirmActions}><button type="button" className={styles.keep} disabled={undoing} onClick={() => { if (undoUncertain) { setUndoing(true); void flush([], 0).finally(() => setUndoing(false)); } else { setPending(null); setUndoError(""); } }}>{undoUncertain ? "Reload history" : "Keep filed"}</button><button type="button" className={styles.undo} disabled={undoing || undoUncertain} onClick={confirmUndo}>{undoing ? "Undoing…" : "Undo series"}</button></div> : <div className={styles.footer}><div className={styles.pager}>
      <button type="button" aria-label="Previous page" disabled={!hasHistory || visibleData.page <= 1 || historyBlocked} onClick={() => choosePage(Math.max(1, page - 1))}><ChevronLeft size={18} aria-hidden="true" /></button>
      <span>{hasHistory && totalSeries > 0 ? <>Page {visibleData.page} of {visibleData.pages}<small>{(visibleData.page - 1) * visibleData.page_size + 1} to {Math.min(visibleData.page * visibleData.page_size, totalSeries)} of {totalSeries} series</small></> : loading || preparing ? "Loading pages…" : "No pages"}</span>
      <button type="button" aria-label="Next page" disabled={!hasHistory || visibleData.page >= (visibleData.pages ?? 0) || historyBlocked} onClick={() => choosePage(page + 1)}><ChevronRight size={18} aria-hidden="true" /></button>
      </div><button type="button" className={styles.done} onClick={close}>Done</button></div>}>
    {({ closeThen }) => <>{pending ? <section className={styles.confirm}><p>{maskFilingCopy(filedTransferRoute(pending), hidden)}</p><p>This undoes the whole series: {pending.undo_count} {pending.undo_count === 1 ? "payment" : "payments"}, including any outside this pay period. Its entries will return to transfer review.</p><p>Undo changes how the entries are filed. It does not move any money.</p>{undoError ? <p className={styles.alert} role="alert">{undoError}</p> : null}</section> : <div>
      <div className={styles.historyHeader} data-filed-history-header>
        <div className={styles.summary}><p className={styles.count} aria-live="polite" aria-atomic="true">{hasHistory ? `${visibleData.total_series} series` : error ? "Count unavailable" : preparing ? "Preparing series…" : "Loading series…"}</p>{period && displayedSource === "all" ? <p className={styles.total}><MoneyText className="money" text={typeof scopeTotal === "number" ? movementMoney(scopeTotal, visibleData?.scope_currency || "GBP", undefined, hidden) : "Checking…"} /><small>Moved separately</small></p> : null}</div>
        <p className={styles.quiet}>{period ? "Moved separately this pay period. Each payment is counted once, not both entries." : "Your filed transfers, newest first. Includes transfers you confirmed."}</p>
      </div>
        {totalMismatch ? <p className={styles.alert} role="status">This history has a different total from Spend. Close and refresh Spend to check the latest figures.</p> : null}
        {hasHistory && !visibleData.complete ? <p className={styles.alert} role="status">Some historical filing evidence is unavailable.</p> : null}
      <div className={styles.filters} data-filed-filters role="group" aria-label="Filing source">{([ ["all", "All"], ["sorted", "Filed by Sorted"], ["user", "You confirmed"] ] as const).map(([value, label]) => <button key={value} type="button" disabled={!!flushPending} aria-pressed={displayedSource === value} aria-busy={loading && source === value} onClick={() => chooseSource(value)}>{label}</button>)}</div>
      <div className={styles.loadStatus} role="status" aria-live="polite" data-filed-load-status>
        {loading ? <span>{hasHistory ? `Loading ${sourceName}. Previous results shown.` : "Loading your filed transfers…"}</span> : error && hasHistory ? <><span>Could not load {sourceName}. Previous results shown.</span><button type="button" className={styles.linkButton} onClick={() => load()}>Try again</button></> : preparing || stale ? <><span>{preparing ? "Your transfer history is being prepared." : `Updating history${visibleData?.updated_at ? `. Last updated ${shortFilingDate(visibleData.updated_at)}` : ". Previous results shown."}`}</span><button type="button" className={styles.linkButton} onClick={() => load()}>Refresh</button></> : null}
      </div>
      {closeStatus ? <p className={styles.alert} role="status">{closeStatus}</p> : null}
      {flushPending ? <p className={styles.alert} role="status">{flushPending.count ? "Series undone. Totals have not refreshed yet." : "The Undo outcome still needs checking. Reload history after totals refresh."} <button type="button" className={styles.linkButton} disabled={undoing} onClick={retryFlush}>Refresh totals</button></p> : null}
      <div className={styles.listArea} aria-busy={loading || preparing} data-filed-list-area>
        {hasHistory ? visibleData.items.length ? <div className={styles.list}>{visibleData.items.map(item => <Row key={item.series_key} item={item} hidden={hidden} undoDisabled={historyBlocked} historyStale={stale} onAskUndo={setPending} onOpenTransactions={(href, event) => openTransactions(href, event, closeThen)} />)}</div> : <div className={styles.empty}><h3>{displayedSource === "all" ? (period ? "No filed transfers in this pay period" : "No filed transfers yet") : "No series match this filter"}</h3><p>{displayedSource === "all" ? "Filed transfers stay here after transfer review is clear." : "Choose All to see the other filing sources."}</p>{displayedSource !== "all" ? <button type="button" className={styles.linkButton} onClick={() => chooseSource("all")}>Show all filing sources</button> : null}</div> : error ? <div className={styles.empty}><h3>Transfers could not be loaded</h3><p>Your filed transfers have not changed.</p><button type="button" className={styles.linkButton} onClick={() => load()}>Try again</button></div> : <div className={styles.skeleton} data-filed-skeleton aria-hidden="true">{[0, 1, 2].map(index => <div key={index}><span /><span /><span /></div>)}</div>}
      </div>
      {onOpenReview ? <button type="button" className={styles.linkButton} disabled={!!flushPending} onClick={() => closeThen(onOpenReview)}>Review transfers</button> : null}
    </div>}
    </>}
  </SheetFrame>;
}
