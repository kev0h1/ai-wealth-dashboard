"use client";

import { ChevronDown, Landmark, RotateCcw, Sparkles, UserRoundCheck } from "lucide-react";
import MoneyText from "@/components/MoneyText";
import { type TransferView, shortDate, sourceLabel } from "./fixtures";
import styles from "./rows.module.css";

type Props = {
  rows: TransferView[];
  variant: "a" | "b";
  formatMoney: (amount: number, sign?: "debit" | "credit") => string;
  busyId: string | null;
  undoingId: string | null;
  errors: Record<string, string>;
  onAskUndo: (id: string) => void;
};

function SourceMark({ source }: { source: TransferView["source"] }) {
  const Icon = source === "confirmed" ? UserRoundCheck : source === "ai" ? Sparkles : Landmark;
  return <span className={styles.source}><Icon size={14} aria-hidden="true" />{sourceLabel({ source })}</span>;
}

function Receipt({ row, formatMoney }: Pick<Props, "formatMoney"> & { row: TransferView }) {
  return <div className={styles.receipt} aria-label={`Receipt dates for ${row.fromBank} to ${row.toBank}`}>
    {row.visibleOccurrences.map(item => <div className={styles.receiptRow} key={item.date}>
      <time dateTime={item.date}>{shortDate(item.date)}</time>
      <span><MoneyText text={formatMoney(item.amount, "debit")} /></span>
      <span><MoneyText text={formatMoney(item.amount, "credit")} /></span>
    </div>)}
  </div>;
}

function Undo({ row, busyId, undoingId, errors, onAskUndo }: Pick<Props, "busyId" | "undoingId" | "errors" | "onAskUndo"> & { row: TransferView }) {
  const busy = busyId === row.id || undoingId === row.id;
  const route = `${row.fromBank} to ${row.toBank}`;
  return <>
    <button type="button" disabled={busy} onClick={() => onAskUndo(row.id)} className={styles.undo}>
      <RotateCcw size={15} aria-hidden="true" />{busy ? "Undoing…" : `Undo ${route}`}
    </button>
    {errors[row.id] && <p className={styles.error} role="alert">{errors[row.id]}</p>}
  </>;
}

function CompactRow({ row, formatMoney, busyId, undoingId, errors, onAskUndo }: Pick<Props, "formatMoney" | "busyId" | "undoingId" | "errors" | "onAskUndo"> & { row: TransferView }) {
  const route = `${row.fromBank} to ${row.toBank}`;
  return <details className={styles.compact}>
    <summary className={styles.compactSummary}>
      <span className={styles.route}><span>{route}</span><small>{row.kind === "transfer" ? "Own-account transfer" : "Other movement"}</small></span>
      <span className={styles.total}><MoneyText text={formatMoney(row.total)} /><small>Total</small></span>
      <ChevronDown size={17} aria-hidden="true" className={styles.chevron} />
      <span className={styles.compactMeta}><SourceMark source={row.source} /><span>{row.cadence} · {row.visibleOccurrences.length} {row.visibleOccurrences.length === 1 ? "payment" : "payments"} · latest {shortDate(row.latest)}</span></span>
    </summary>
    <div className={styles.detail}>
      <p className={styles.accounts}>{row.fromBank} · {row.fromAccount} to {row.toBank} · {row.toAccount}</p>
      <p className={styles.reason}>{row.reason}</p>
      <div className={styles.receiptHeader}><span>Date</span><span>Out</span><span>In</span></div>
      <Receipt row={row} formatMoney={formatMoney} />
      <Undo row={row} busyId={busyId} undoingId={undoingId} errors={errors} onAskUndo={onAskUndo} />
    </div>
  </details>;
}

function EvidenceRow({ row, formatMoney, busyId, undoingId, errors, onAskUndo }: Pick<Props, "formatMoney" | "busyId" | "undoingId" | "errors" | "onAskUndo"> & { row: TransferView }) {
  const route = `${row.fromBank} to ${row.toBank}`;
  return <article className={styles.evidence}>
    <div className={styles.evidenceTop}><div className={styles.route}><span>{route}</span><small>{row.kind === "transfer" ? "Own-account transfer" : "Other movement"}</small></div><span className={styles.total}><MoneyText text={formatMoney(row.total)} /><small>Total</small></span></div>
    <SourceMark source={row.source} />
    <p className={styles.reason}>{row.reason}</p>
    <p className={styles.evidenceMeta}>{row.cadence} · {row.visibleOccurrences.length} {row.visibleOccurrences.length === 1 ? "payment" : "payments"} · latest {shortDate(row.latest)}</p>
    <details className={styles.evidenceDetails}>
      <summary>See accounts and receipt <ChevronDown size={16} aria-hidden="true" /></summary>
      <div className={styles.detail}>
        <p className={styles.accounts}>{row.fromBank} · {row.fromAccount} to {row.toBank} · {row.toAccount}</p>
        <div className={styles.receiptHeader}><span>Date</span><span>Out</span><span>In</span></div>
        <Receipt row={row} formatMoney={formatMoney} />
      </div>
    </details>
    <Undo row={row} busyId={busyId} undoingId={undoingId} errors={errors} onAskUndo={onAskUndo} />
  </article>;
}

export function SeriesRows({ rows, variant, formatMoney, busyId, undoingId, errors, onAskUndo }: Props) {
  if (!rows.length) return <div className={styles.empty}><p>No filed transfers match this view.</p><p>Try all time or return to the transfers review.</p></div>;
  return <div className={`${styles.rows} ${variant === "a" ? styles.compactRows : styles.evidenceRows}`}>
    {rows.map(row => variant === "a"
      ? <CompactRow key={row.id} row={row} formatMoney={formatMoney} busyId={busyId} undoingId={undoingId} errors={errors} onAskUndo={onAskUndo} />
      : <EvidenceRow key={row.id} row={row} formatMoney={formatMoney} busyId={busyId} undoingId={undoingId} errors={errors} onAskUndo={onAskUndo} />)}
  </div>;
}
