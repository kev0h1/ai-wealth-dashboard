"use client";

import { Fragment, useEffect, useRef, useState, type MouseEvent } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import MoneyText from "@/components/MoneyText";
import FilingSourceIcon from "@/components/FilingSourceIcon";
import { SheetFrame } from "@/components/SheetFrame";
import { usePreferences } from "@/components/PreferencesContext";
import { api } from "@/lib/api";
import { invalidateAfterTransactionCorrection, notifyTransactionsChanged } from "@/lib/cacheInvalidation";
import {
  isSafeFiledTransfersHref, shortFilingDate, movementMoney, maskFilingCopy, type FiledTransferItem,
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

function route(item: FiledTransferItem): string {
  const from = item.from_account?.bank || item.from_account?.name;
  const to = item.to_account?.bank || item.to_account?.name;
  return from && to ? `${from} to ${to}` : item.description || "Moved money";
}

function account(item: FiledTransferItem): string | null {
  const one = item.from_account && [item.from_account.bank, item.from_account.name].filter(Boolean).join(" · ");
  const two = item.to_account && [item.to_account.bank, item.to_account.name].filter(Boolean).join(" · ");
  return one && two ? `${one} to ${two}` : one || two || null;
}

function periodQuery(period: Period | undefined, source: FilingSource, page: number): FiledTransfersQuery {
  return { ...(period ? { from: period.start, to: period.end } : {}), source, page, page_size: PAGE_SIZE };
}

function Row({ item, hidden, undoDisabled, onAskUndo, onOpenTransactions }: {
  item: FiledTransferItem; hidden: boolean; undoDisabled: boolean; onAskUndo: (item: FiledTransferItem) => void; onOpenTransactions: (href: string, event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const actor = sourceLabel(item.actor);
  const latest = shortFilingDate(item.last_date);
  const cadence = item.cadence || "Filed movement";
  const header = maskFilingCopy(route(item), hidden);
  const accountText = account(item);
  return <details className={styles.row}>
    <summary>
      <span className={styles.route}>{header}<small>{item.kind === "own_transfer" ? "Own-account transfer" : "Other movement"}</small></span>
      <span className={styles.amount}><MoneyText className="money" text={movementMoney(item.total_amount, item.currency, undefined, hidden)} /><small>Total</small></span>
      <ChevronDown size={17} aria-hidden="true" className={styles.chevron} />
      <span className={styles.meta}>
        {actor ? <span className={styles.actor}><FilingSourceIcon actor={item.actor === "user" ? "user" : "sorted"} size={14} />{actor}</span> : <span>Filing source unavailable</span>}
        <span>{cadence} · {item.count} {item.count === 1 ? "payment" : "payments"}{latest ? ` · latest ${latest}` : ""}</span>
      </span>
    </summary>
    <div className={styles.detail}>
      {accountText ? <p>{maskFilingCopy(accountText, hidden)}</p> : null}
      {item.reason ? <p className={styles.reason}><MoneyText text={hidden ? "Filing reason hidden while balances are hidden." : item.reason} /></p> : null}
      <table className={styles.receiptTable}>
        <caption className="sr-only">Receipt for {header}</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Entry</th><th scope="col">Amount</th></tr></thead>
        <tbody>{item.occurrences.map((occurrence, index) => <Fragment key={`${occurrence.date}:${index}`}>
          {[occurrence.debit, occurrence.credit].map(leg => leg ? <tr key={`${leg.transaction_type}:${leg.id}`}>
            <td><time dateTime={leg.date}>{shortFilingDate(leg.date) ?? "Date unavailable"}</time></td>
            <td>{leg.transaction_type === "debit" ? "Out" : "In"}<small>{maskFilingCopy([leg.account_bank, leg.account_name].filter(Boolean).join(" · "), hidden)}</small></td>
            <td><span className="money" aria-label={hidden ? `${leg.transaction_type === "debit" ? "Outgoing" : "Incoming"} amount hidden` : undefined}><MoneyText text={movementMoney(leg.amount, leg.currency, leg.transaction_type, hidden)} /></span></td>
          </tr> : null)}
          {!occurrence.debit || !occurrence.credit ? <tr><td colSpan={3} className={styles.disabled}>{!occurrence.debit ? "Outgoing entry unavailable." : "Incoming entry unavailable."}</td></tr> : null}
        </Fragment>)}</tbody>
      </table>
      {!item.history_complete ? <p className={styles.disabled}>Some older receipt evidence is unavailable.</p> : null}
      <div className={styles.actions}>
        {item.can_undo ? <button type="button" className={styles.linkButton} disabled={undoDisabled} onClick={() => onAskUndo(item)}><RotateCcw size={15} aria-hidden="true" />Undo this series</button> : <span className={styles.disabled}>{item.undo_unavailable_reason || "This filing cannot be safely undone from the stored history."}</span>}
        {!undoDisabled && isSafeFiledTransfersHref(item.transactions_href) ? <a className={styles.transactionLink} href={item.transactions_href} onClick={event => onOpenTransactions(item.transactions_href!, event)}>Open transaction history</a> : null}
      </div>
    </div>
  </details>;
}

export default function FiledTransfersSheet({ onClose, onChanged, onOpenReview, period, initialSource = "all", expectedTotal, nested = false }: FiledTransfersSheetProps) {
  const router = useRouter();
  const { hideNetWorth, preferencesReady } = usePreferences();
  const hidden = hideNetWorth || !preferencesReady;
  const [source, setSource] = useState<FilingSource>(initialSource);
  const [data, setData] = useState<FiledTransfersResponse | null>(null);
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
  useEffect(() => {
    if (pending || wasConfirming.current) headingRef.current?.focus({ preventScroll: true });
    wasConfirming.current = pending !== null;
  }, [pending]);

  const load = (nextSource = source, nextPage = page) => {
    const request = ++latest.current;
    setLoading(true); setError(false); setData(null);
    api.getFiledTransfers(periodQuery(period, nextSource, nextPage)).then(result => {
      if (request !== latest.current) return;
      if (result.pages > 0 && nextPage > result.pages) { setPage(result.pages); return; }
      setData(result); setLoading(false);
    }).catch(() => { if (request === latest.current) { setError(true); setLoading(false); } });
  };
  useEffect(() => {
    // Reset this remote request's loading state before awaiting its result.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(source, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, page, period?.start, period?.end]);
  useEffect(() => () => { latest.current += 1; }, []);

  function chooseSource(next: FilingSource) { latest.current += 1; setData(null); setLoading(true); setSource(next); setPage(1); if (next === source && page === 1) load(next, 1); }
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

  const scopeTotal = data?.scope_total;
  const totalMismatch = period && source === "all" && typeof scopeTotal === "number" && typeof expectedTotal === "number" && Math.abs(scopeTotal - expectedTotal) > 0.009;
  const title = pending ? "Undo this series?" : "Transfers Sorted filed";
  const description = period ? period.label : "All time";
  return <SheetFrame title={title} description={description} headingRef={headingRef} onClose={onClose} beforeClose={beforeClose} nested={nested} dismissDisabled={undoing || !!flushPending}
    footer={({ close }) => pending ? <div className={styles.confirmActions}><button type="button" className={styles.keep} disabled={undoing} onClick={() => { if (undoUncertain) { setUndoing(true); void flush([], 0).finally(() => setUndoing(false)); } else { setPending(null); setUndoError(""); } }}>{undoUncertain ? "Reload history" : "Keep filed"}</button><button type="button" className={styles.undo} disabled={undoing || undoUncertain} onClick={confirmUndo}>{undoing ? "Undoing…" : "Undo series"}</button></div> : <div className={styles.footer}><div className={styles.pager}>
      <button type="button" aria-label="Previous page" disabled={!data || data.page <= 1 || loading} onClick={() => setPage(value => Math.max(1, value - 1))}><ChevronLeft size={18} aria-hidden="true" /></button>
      <span>{data && data.total_series > 0 ? <>Page {data.page} of {data.pages}<small>{(data.page - 1) * data.page_size + 1} to {Math.min(data.page * data.page_size, data.total_series)} of {data.total_series} series</small></> : ""}</span>
      <button type="button" aria-label="Next page" disabled={!data || data.page >= data.pages || loading} onClick={() => setPage(value => value + 1)}><ChevronRight size={18} aria-hidden="true" /></button>
      </div><button type="button" className={styles.done} onClick={close}>Done</button></div>}>
    {({ closeThen }) => <>{pending ? <section className={styles.confirm}><p>{maskFilingCopy(route(pending), hidden)}</p><p>This undoes the whole series: {pending.undo_count} {pending.undo_count === 1 ? "payment" : "payments"}, including any outside this pay period. Its entries will return to transfer review.</p><p>Undo changes how the entries are filed. It does not move any money.</p>{undoError ? <p className={styles.alert} role="alert">{undoError}</p> : null}</section> : <div>
      {!loading && !error && data ? <><div className={styles.summary}><p className={styles.count}>{data.total_series} series</p>{period && source === "all" && typeof scopeTotal === "number" ? <p className={styles.total}><MoneyText className="money" text={movementMoney(scopeTotal, data.scope_currency, undefined, hidden)} /><small>Moved separately</small></p> : null}</div>
        <p className={styles.quiet}>{period ? "Moved separately this pay period. Each payment is counted once, not both entries." : "Your filed transfers, newest first. Includes transfers you confirmed."}</p>
        {totalMismatch ? <p className={styles.alert} role="status">This history has a different total from Spend. Close and refresh Spend to check the latest figures.</p> : null}
        {!data.complete ? <p className={styles.alert} role="status">Some historical filing evidence is unavailable.</p> : null}
      </> : null}
      <div className={styles.filters} role="group" aria-label="Filing source">{([ ["all", "All"], ["sorted", "Filed by Sorted"], ["user", "You confirmed"] ] as const).map(([value, label]) => <button key={value} type="button" disabled={!!flushPending} aria-pressed={source === value} onClick={() => chooseSource(value)}>{label}</button>)}</div>
      {closeStatus ? <p className={styles.alert} role="status">{closeStatus}</p> : null}
      {flushPending ? <p className={styles.alert} role="status">{flushPending.count ? "Series undone. Totals have not refreshed yet." : "The Undo outcome still needs checking. Reload history after totals refresh."} <button type="button" className={styles.linkButton} disabled={undoing} onClick={retryFlush}>Refresh totals</button></p> : null}
      {loading ? <div className={styles.skeleton} role="status" aria-label="Loading filed transfers"><span /><span /><span /></div> : error ? <div className={styles.empty}><h3>Transfers could not be loaded</h3><p>Your filed transfers have not changed.</p><button type="button" className={styles.linkButton} onClick={() => load()}>Try again</button></div> : data?.items.length ? <div className={styles.list}>{data.items.map(item => <Row key={item.series_key} item={item} hidden={hidden} undoDisabled={!!flushPending} onAskUndo={setPending} onOpenTransactions={(href, event) => openTransactions(href, event, closeThen)} />)}</div> : <div className={styles.empty}><h3>{source === "all" ? (period ? "No filed transfers in this pay period" : "No filed transfers yet") : "No series match this filter"}</h3><p>{source === "all" ? "Filed transfers stay here after transfer review is clear." : "Choose All to see the other filing sources."}</p>{source !== "all" ? <button type="button" className={styles.linkButton} onClick={() => chooseSource("all")}>Show all filing sources</button> : null}</div>}
      {onOpenReview ? <button type="button" className={styles.linkButton} disabled={!!flushPending} onClick={() => closeThen(onOpenReview)}>Review transfers</button> : null}
    </div>}
    </>}
  </SheetFrame>;
}
