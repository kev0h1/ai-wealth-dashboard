"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, CircleHelp, CreditCard, Landmark, PiggyBank, ReceiptText, ShieldCheck } from "lucide-react";
import { Account, Transaction, TransferPairSuggestion, api } from "@/lib/api";
import { SheetFrame } from "@/components/SheetFrame";
import TeachingSheet from "@/components/TeachingSheet";
import { accountBrand, BankBadge } from "@/components/AccountMiniCard";
import { usePreferences } from "@/components/PreferencesContext";
import { invalidateAfterTransactionCorrection, notifyTransactionsChanged } from "@/lib/cacheInvalidation";
import { displayAccountName } from "@/lib/accountName";
import { formatDate, dateToUTCDay } from "@/lib/payPeriod";
import { formatCurrency } from "@/lib/currency";
import { remainingReviewItem, type MiscategorisedItem } from "@/lib/transferReview";
export type { MiscategorisedItem, MiscategorisedMember } from "@/lib/transferReview";
import Spinner from "@/components/Spinner";

const button = "min-h-11 rounded-xl px-3 py-2 text-sm font-semibold disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
const surface = "rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900";
type Choice = "transfer" | "savings" | "card" | "spending";
const choices = [
  { key: "transfer", label: "Another of my accounts", Icon: Landmark },
  { key: "savings", label: "Savings or investments", Icon: PiggyBank },
  { key: "card", label: "Paying off a card", Icon: CreditCard },
  { key: "spending", label: "Spending", Icon: ReceiptText },
] as const;

interface MiscategorisedReviewSheetProps {
  onClose: () => void;
  onChanged?: () => void;
  accounts: Account[];
  // Synthetic fixtures for the real-component browser regression only.
  initialItems?: MiscategorisedItem[];
  initialPairs?: TransferPairSuggestion[];
  periodStart?: Date;
}

function toTransaction(item: MiscategorisedItem): Transaction {
  return { id: item.id, account_id: item.account_id ?? "", date: item.date,
    amount: item.amount, currency: item.currency, description: item.description ?? "",
    merchant_name: item.merchant_name ?? undefined, category: item.category ?? undefined,
    transaction_type: item.transaction_type === "credit" ? "credit" : "debit" };
}

export default function MiscategorisedReviewSheet({ onClose, onChanged, accounts, initialItems, initialPairs, periodStart }: MiscategorisedReviewSheetProps) {
  const [items, setItems] = useState<MiscategorisedItem[]>(initialItems ?? []);
  const [pairs, setPairs] = useState<TransferPairSuggestion[]>(initialPairs ?? []);
  const [loading, setLoading] = useState(initialItems === undefined || initialPairs === undefined);
  const [loadError, setLoadError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [pendingCount, setPendingCount] = useState(0);
  const pendingRef = useRef(0);
  const changedIds = useRef(new Set<string>());
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState("");
  // A route change or app teardown must not leave a warm client snapshot of
  // pre-review figures. Server-side dirty markers independently protect reads.
  useEffect(() => () => {
    if (pendingRef.current) invalidateAfterTransactionCorrection("", {});
  }, []);
  function saved(ids: string[]) {
    ids.forEach(id => changedIds.current.add(id));
    pendingRef.current += 1;
    setPendingCount(pendingRef.current);
    setCloseError("");
  }
  async function finishReview() {
    if (busyRef.current) return false;
    busyRef.current = true;
    setClosing(true);
    setCloseError("");
    try {
      // Also drains an interrupted review from an earlier visit.
      const result = await api.finishTransferReview();
      if (result.pending) throw new Error("Another choice is still updating. Please try Done again.");
      if (pendingRef.current || result.recomputed) {
        invalidateAfterTransactionCorrection("", {});
        notifyTransactionsChanged([...changedIds.current]);
        onChanged?.();
      }
      pendingRef.current = 0;
      return true;
    } catch {
      setCloseError("Your choices are saved. Totals could not be updated yet. Try Done again.");
      return false;
    } finally { busyRef.current = false; setClosing(false); }
  }
  const [selected, setSelected] = useState<{ tx: Transaction; choice: Exclude<Choice, "transfer"> } | null>(null);
  const [confirmSingle, setConfirmSingle] = useState<{ item: MiscategorisedItem; category: "Transfer" | "Income" } | null>(null);
  const { hideNetWorth, preferencesReady } = usePreferences();
  const hidden = hideNetWorth || !preferencesReady;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    // Both lists must settle before showing a count or an all-clear state.
    Promise.all([
      initialItems !== undefined ? Promise.resolve({ items: initialItems, separate_items: [] }) : api.getMiscategorised(),
      initialPairs !== undefined ? Promise.resolve({ items: initialPairs }) : api.getTransferPairSuggestions(),
    ]).then(([review, suggestions]) => {
      if (cancelled) return;
      setItems([...review.items, ...(review.separate_items ?? [])]);
      setPairs(suggestions.items);
      setResolved(new Set());
    }).catch(() => { if (!cancelled) setLoadError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [revision, initialItems, initialPairs]);

  function begin(key: string) {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(key);
    setErrors(previous => ({ ...previous, [key]: "" }));
    return true;
  }
  function announce(text: string) {
    setMessage(text);
    reviewHeading.current?.focus({ preventScroll: true });
  }
  function end() { busyRef.current = false; setBusy(null); }
  function failed(key: string) { setErrors(previous => ({ ...previous, [key]: "Couldn’t save your choice. Please try again." })); }
  function refresh() { if (initialItems === undefined && initialPairs === undefined) setRevision(value => value + 1); }

  function handleConfirmPair(pair: TransferPairSuggestion) {
    if (!begin(pair.pair_key)) return;
    api.confirmTransferPair(pair.credit.id, pair.debit.id, true).then(() => {
      saved([pair.debit.id, pair.credit.id]);
      setResolved(previous => new Set([...previous, pair.debit.id, pair.credit.id]));
      setPairs(previous => previous.filter(value => value.pair_key !== pair.pair_key));
      announce("Both payments marked as one transfer.");
    }).catch(() => failed(pair.pair_key)).finally(end);
  }

  function handleSeparate(pair: TransferPairSuggestion) {
    if (!begin(pair.pair_key)) return;
    api.dismissTransferPair(pair.pair_key).then(() => {
      setPairs(previous => previous.filter(value => value.pair_key !== pair.pair_key));
      saved([pair.debit.id, pair.credit.id]);
      // Keep both legs visible locally; the separate queue is durable on the server.
      const legs = [pair.debit, pair.credit].map((leg, index): MiscategorisedItem => ({
        ...leg, currency: leg.currency ?? "GBP", id: leg.id, ids: [leg.id], count: 1,
        series_key: `separate:${leg.id}`, first_date: leg.date,
        amount_min: leg.amount, amount_max: leg.amount,
        transaction_type: index === 0 ? "debit" : "credit",
      }));
      setItems(previous => [...previous.filter(item => !legs.some(leg => leg.id === item.id)), ...legs]);
      announce("Review each payment separately. Neither category has changed.");
    }).catch(() => failed(pair.pair_key)).finally(end);
  }

  function handleSingle(item: MiscategorisedItem, category: "Transfer" | "Income") {
    if (!begin(item.id)) return;
    const tx = toTransaction(item);
    const write = tx.transaction_type === "credit"
      ? api.patchTransaction(tx.id, { category, defer_recompute: true })
      : api.resolveMovement(tx.id, { resolution: "mine-here", defer_recompute: true });
    write.then(() => {
      saved([tx.id]);
      setConfirmSingle(null);
      setResolved(previous => new Set([...previous, item.id]));
      announce("Payment saved.");
    }).catch(() => failed(item.id)).finally(end);
  }

  function leg(tx: Pick<Transaction, "id" | "account_id" | "date" | "amount" | "currency" | "transaction_type"> & { description?: string | null; merchant_name?: string | null }) {
    const account = accounts.find(value => value.id === tx.account_id);
    const brand = account ? accountBrand(account) : null;
    const credit = tx.transaction_type === "credit";
    return <div className="flex items-center gap-2.5 py-3">
      <span className="shrink-0">{brand ? <BankBadge logoSrc={brand.logoSrc} initials={brand.initials} altText={brand.label} brandBg={brand.background} size={28} initialsSize="10px" /> : <Landmark size={24} aria-hidden="true" className="text-slate-500 dark:text-slate-400" />}</span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{account?.name ? displayAccountName(account.name) : "Account"}</span><span className="block text-xs text-slate-600 dark:text-slate-400">{formatDate(tx.date)}</span><span className="block break-words text-xs text-slate-600 dark:text-slate-400">{tx.merchant_name || tx.description || "Payment"}</span></span>
      <span aria-label={hidden ? (credit ? "Incoming amount hidden" : "Outgoing amount hidden") : undefined} className={`shrink-0 font-mono text-sm font-semibold tabular-nums ${credit ? "text-emerald-700 dark:text-emerald-300" : "text-slate-900 dark:text-slate-100"}`}>{credit ? "+" : "−"}{hidden ? "••••" : formatCurrency(Math.abs(tx.amount), tx.currency)}</span>
    </div>;
  }

  function error(key: string) { return errors[key] ? <p role="alert" className="mt-3 text-sm text-slate-700 dark:text-slate-300">{errors[key]}</p> : null; }
  function choose(item: MiscategorisedItem, choice: Choice) {
    if (choice === "transfer") setConfirmSingle({ item, category: "Transfer" });
    else setSelected({ tx: toTransaction(item), choice });
  }
  function renderItem(item: MiscategorisedItem) {
    const credit = item.transaction_type === "credit";
    const checking = confirmSingle?.item.id === item.id;
    return <details key={item.id} className={`${surface} group px-3`} data-review-id={item.id}>
      <summary className="min-h-11 cursor-pointer list-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
        {leg(toTransaction(item))}
        <span className="flex items-center justify-between gap-2 pb-3 text-xs font-semibold text-indigo-700 dark:text-indigo-300">{item.count > 1 ? `${item.count} payments to review` : "Review this payment"}<ChevronDown size={16} aria-hidden="true" className="shrink-0 group-open:rotate-180" /></span>
      </summary>
      <div className="border-t border-slate-200 pb-3 pt-3 dark:border-slate-700">
        {periodStart && dateToUTCDay(item.date) < periodStart.getTime() && <p className="mb-2 text-xs text-slate-600 dark:text-slate-400">Earlier pay period</p>}
        {item.count > 1 && <p className="mb-3 text-xs leading-5 text-slate-600 dark:text-slate-400">Showing the latest payment. A category choice changes this payment only.</p>}
        {checking ? <><p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{confirmSingle.category === "Income" ? "Keep as income" : "Another of my accounts"}</p><p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400">Only this payment changes.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={!!busy || closing} onClick={() => handleSingle(item, confirmSingle.category)} className={`${button} bg-indigo-600 text-white`}>{busy === item.id ? "Saving…" : "Save this payment"}</button><button type="button" disabled={!!busy || closing} onClick={() => setConfirmSingle(null)} className={`${button} text-slate-700 dark:text-slate-300`}>Back</button></div></> : <>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{credit ? "Where did this money come from?" : "What was this payment?"}</p>
          <div className="mt-3 space-y-2">{credit ? <>
            <button type="button" disabled={!!busy || closing} onClick={() => choose(item, "transfer")} className={`${button} w-full border border-slate-200 text-left text-slate-800 dark:border-slate-600 dark:text-slate-100`}>Another of my accounts</button>
            <button type="button" disabled={!!busy || closing} onClick={() => setConfirmSingle({ item, category: "Income" })} className={`${button} w-full border border-slate-200 text-left text-slate-800 dark:border-slate-600 dark:text-slate-100`}>Keep as income</button>
          </> : choices.map(({ key, label, Icon }) => <button type="button" key={key} disabled={!!busy || closing} onClick={() => choose(item, key)} className={`${button} flex w-full items-center gap-3 border border-slate-200 text-left text-slate-800 dark:border-slate-600 dark:text-slate-100`}><Icon size={18} className="shrink-0 text-indigo-600 dark:text-indigo-300" aria-hidden="true" /><span className="flex-1">{label}</span><ChevronRight size={16} aria-hidden="true" /></button>)}</div>
        </>}
        {error(item.id)}{error(item.series_key)}
      </div>
    </details>;
  }

  function renderPair(pair: TransferPairSuggestion) {
    const timing = pair.date_diff_days === 0 ? "on the same day" : pair.date_diff_days === 1 ? "a day apart" : `${pair.date_diff_days} days apart`;
    return <article key={pair.pair_key} className={`${surface} p-3`} data-review-pair={pair.pair_key}>
      <div className="flex items-start gap-2.5"><CircleHelp size={20} className="mt-0.5 shrink-0 text-indigo-600 dark:text-indigo-300" aria-hidden="true" /><div><h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">This could be one transfer</h3><p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400">The same amount moved {timing}. It is not confirmed yet.</p></div></div>
      <div className="my-3 divide-y divide-slate-200 border-y border-slate-200 dark:divide-slate-700 dark:border-slate-700">{leg({ ...pair.debit, currency: pair.debit.currency ?? "GBP", transaction_type: "debit" })}{leg({ ...pair.credit, currency: pair.credit.currency ?? "GBP", transaction_type: "credit" })}</div>
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Are these the same transfer?</p>
      <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400">Confirming files both payments together.</p>
      <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" disabled={!!busy || closing} onClick={() => handleConfirmPair(pair)} className={`${button} bg-indigo-600 text-white`}>Yes, same transfer</button><button type="button" disabled={!!busy || closing} onClick={() => handleSeparate(pair)} className={`${button} border border-slate-200 text-slate-700 dark:border-slate-600 dark:text-slate-200`}>Review separately</button></div>
      {busy === pair.pair_key && <p role="status" className="mt-2 text-xs text-slate-600 dark:text-slate-400">Saving your choice…</p>}{error(pair.pair_key)}
    </article>;
  }

  const groups = new Map<string, { items: MiscategorisedItem[]; pairs: TransferPairSuggestion[] }>();
  for (const pair of pairs) {
    const group = groups.get(pair.debit.account_id) ?? { items: [], pairs: [] };
    group.pairs.push(pair); groups.set(pair.debit.account_id, group);
  }
  const visibleItems = items.map(item => remainingReviewItem(item, resolved)).filter((item): item is MiscategorisedItem => item !== null);
  const unlistedCount = items.reduce((total, item) => total + (remainingReviewItem(item, resolved) ? 0 : item.ids.filter(id => !resolved.has(id)).length), 0);
  for (const item of visibleItems) {
    const key = item.account_id ?? "unknown";
    const group = groups.get(key) ?? { items: [], pairs: [] };
    group.items.push(item); groups.set(key, group);
  }
  const count = pairs.length + visibleItems.length + items.filter(item => !remainingReviewItem(item, resolved) && item.ids.some(id => !resolved.has(id))).length;
  return <>
    <SheetFrame title="Review these transfers" onClose={onClose} beforeClose={finishReview} dismissDisabled={!!busy || closing}
      footer={({ close }) => <>
        {pendingCount > 0 && <p role="status" className="mb-2 text-xs text-slate-600 dark:text-slate-300">{pendingCount} {pendingCount === 1 ? "choice saved" : "choices saved"}. Your overview updates when you finish.</p>}
        {closeError && <p role="alert" className="mb-2 text-sm text-slate-700 dark:text-slate-300">{closeError}</p>}
        <button type="button" disabled={!!busy || closing} onClick={close} className={`${button} w-full bg-indigo-600 text-white hover:bg-indigo-700 active:opacity-80`}>{closing ? "Updating totals…" : "Done"}</button>
      </>}>
      <div className="mb-5"><div className="flex items-start justify-between gap-3"><h2 ref={reviewHeading} tabIndex={-1} className="text-lg font-bold outline-none text-slate-900 dark:text-slate-100">Check the possible match first</h2>{!loading && !loadError && <span className="shrink-0 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300">{count} {count === 1 ? "review" : "reviews"} left</span>}</div><p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Confirm a match, or review each payment separately. Includes earlier pay periods.</p></div>
      {message && <p role="status" className="mb-4 text-sm text-slate-700 dark:text-slate-300">{message}</p>}
      {loading ? <div role="status" className="flex items-center justify-center gap-3 py-12 text-sm text-slate-600 dark:text-slate-300"><Spinner size={24} />Checking your transfers</div> : loadError ? <div role="alert" className="py-8 text-center"><p className="text-sm font-semibold text-slate-900 dark:text-slate-100">We could not load these transfers</p><p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Your saved choices have not changed.</p><button type="button" onClick={() => setRevision(value => value + 1)} className={`${button} mt-4 bg-indigo-600 text-white`}>Try again</button></div> : count === 0 && unlistedCount === 0 ? <div className="py-10 text-center"><ShieldCheck size={28} className="mx-auto text-emerald-700 dark:text-emerald-300" aria-hidden="true" /><h2 className="mt-3 text-base font-semibold text-slate-900 dark:text-slate-100">Nothing needs review</h2><p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Nothing left to check for now.</p></div> : <div className="space-y-4">{Array.from(groups, ([key, group]) => {
        const account = accounts.find(value => value.id === key);
        return <section key={key} aria-label={account?.name ? displayAccountName(account.name) : "Account reviews"} className="rounded-2xl border border-slate-200 p-3 dark:border-slate-700"><div className="mb-3 flex items-center justify-between gap-3"><h2 className="min-w-0 break-words text-sm font-semibold text-slate-900 dark:text-slate-100">{account?.name ? displayAccountName(account.name) : "Account"}</h2><span className="shrink-0 text-xs text-slate-600 dark:text-slate-400">{group.items.length + group.pairs.length} to review</span></div><div className="space-y-3">{group.pairs.map(renderPair)}{group.items.map(renderItem)}</div></section>;
      })}</div>}
      {unlistedCount > 0 && <div className="mt-4"><p className="text-sm text-slate-600 dark:text-slate-300">{unlistedCount} more payments in these groups still need checking.</p><button type="button" disabled={!!busy || closing} onClick={refresh} className={`${button} mt-2 text-indigo-700 dark:text-indigo-300 active:opacity-80`}>Load remaining payments</button></div>}
    </SheetFrame>
    {selected && <TeachingSheet nested deferRecompute key={`${selected.tx.id}:${selected.choice}`} transaction={selected.tx} initialReviewChoice={selected.choice} account={accounts.find(account => account.id === selected.tx.account_id)} onClose={() => setSelected(null)} onUpdated={(tx, ids, reverted) => {
      const affected = [tx.id, ...(ids ?? [])];
      saved(affected);
      setResolved(previous => {
        const next = new Set(previous);
        // The nested teaching flow can undo while still open.
        for (const id of affected) {
          if (reverted) next.delete(id);
          else next.add(id);
        }
        return next;
      });
    }} />}
  </>;
}
