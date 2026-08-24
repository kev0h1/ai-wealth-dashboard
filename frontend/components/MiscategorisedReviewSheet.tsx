"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, ArrowLeftRight, ChevronRight } from "lucide-react";
import { Account, Transaction, TransferPairSuggestion, api } from "@/lib/api";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useSheetOpen } from "@/lib/useSheetOpen";
import { getCategoryColour } from "@/lib/categories";
import { useColours } from "@/components/ColourProvider";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { useCategoryIcons } from "@/components/IconProvider";
import { accountBrand, BankBadge } from "@/components/AccountMiniCard";
import { formatDate, dateToUTCDay } from "@/lib/payPeriod";
import { formatCurrency } from "@/lib/currency";
import Spinner from "@/components/Spinner";
import PennyMark from "@/components/PennyMark";

// − U+2212, never ASCII hyphen-minus, for money (copy rule) — same glyph as
// TeachingSheet.tsx's own MINUS, redefined locally since that one isn't
// exported.
const MINUS = "−";

export type MiscategorisedMember = {
  id: string;
  date: string;
  amount: number;
  account_id: string;
  description: string | null;
  merchant_name: string | null;
};

export type MiscategorisedItem = {
  id: string;
  ids: string[];
  count: number;
  series_key: string;
  merchant_name: string | null;
  description: string | null;
  amount: number;
  amount_min: number | null;
  amount_max: number | null;
  date: string;
  first_date: string | null;
  currency: string;
  category: string | null;
  transaction_type: string;
  // account_id/members — optional/additive, absent on a payload cached
  // before the backend started sending them.
  account_id?: string;
  members?: MiscategorisedMember[];
  // Real per-row evidence for why this was flagged as an own-transfer —
  // optional/additive, absent on a payload cached before this field existed.
  reason?: { kind: "name" } | { kind: "account"; account_id: string };
};

interface MiscategorisedReviewSheetProps {
  onClose: () => void;
  onRecategorise: (tx: Transaction) => void;
  onChanged?: () => void;
  // Resolves account_id -> display name for the sub-line's account segment
  // and the members disclosure — passed down from SpendPage.tsx's own
  // `accounts` state (this sheet does no fetching of its own).
  accounts: Account[];
  // Preview-only seam — additive, defaults to undefined. When provided, the
  // sheet renders this list instead of calling api.getMiscategorised() on
  // mount, so /design/miscategorised can drive the REAL component against a
  // fixture list without gutting it. Production (SpendPage.tsx) never passes
  // this, so its behaviour is unchanged.
  initialItems?: MiscategorisedItem[];
  // Preview-only seam for the cross-account transfer-pair suggestions
  // section — exactly parallel to `initialItems` above. When provided, the
  // sheet renders this list instead of calling
  // api.getTransferPairSuggestions() on mount. Production never passes this.
  initialPairs?: TransferPairSuggestion[];
  // Optional — SpendPage.tsx's own `periodStart` state. This list is
  // deliberately all-time (unlike the banner's period-scoped count that
  // opens it — see the banner's own comment in SpendVerdictView.tsx), so
  // without this the two numbers read as contradictory when juxtaposed.
  // When provided, the list splits into "This period"/"Earlier periods"
  // sections by each item's most recent payment date (`item.date`) against
  // this boundary — but ONLY when the split actually says something (both
  // groups non-empty); a single-group result renders flat, no headers.
  // Undefined (older callers, and /design/miscategorised's flat-list state)
  // renders exactly today's flat list — unchanged from before this prop
  // existed.
  periodStart?: Date;
}

// Turns a miscategorised-list item into a Transaction shape good enough for
// TransactionSheet — account_id now comes straight off the list item (the
// endpoint carries it), so the bank badge in TransactionSheet renders
// correctly; everything else (category picker, save, similar-txn scope)
// still works off the id/description/merchant fields alone.
function toTransaction(item: MiscategorisedItem): Transaction {
  return {
    id: item.id,
    account_id: item.account_id ?? "",
    date: item.date,
    amount: item.amount,
    currency: item.currency,
    description: item.description ?? "",
    merchant_name: item.merchant_name ?? undefined,
    category: item.category ?? undefined,
    transaction_type: item.transaction_type === "credit" ? "credit" : "debit",
  };
}

export default function MiscategorisedReviewSheet({
  onClose,
  onRecategorise,
  onChanged,
  accounts,
  initialItems,
  initialPairs,
  periodStart,
}: MiscategorisedReviewSheetProps) {
  useLockBodyScroll();
  useSheetOpen();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // initialItems (preview-only, see prop doc above) short-circuits the fetch
  // below — undefined in every production call site, so loading/items start
  // exactly as they always have there.
  const [loading, setLoading] = useState(initialItems === undefined);
  const [items, setItems] = useState<MiscategorisedItem[]>(initialItems ?? []);
  // Cross-account transfer-pair suggestions — fetched alongside `items`, own
  // section rendered above the miscategorised groups (see prop doc above).
  // Never gates the sheet's own `loading` state: it's a quiet, additive
  // section that appears whenever it resolves, absent entirely at zero.
  const [pairs, setPairs] = useState<TransferPairSuggestion[]>(initialPairs ?? []);
  // pair_key -> failed-confirm flag, so the restored card can show an inline
  // error line — see handleConfirmPair below. Confirm (unlike dismiss) is a
  // write the user explicitly cares about, so a failure must be visible, not
  // silently swallowed.
  const [pairErrors, setPairErrors] = useState<Set<string>>(new Set());
  const [dismissingIds, setDismissingIds] = useState<Set<string>>(new Set());
  // Which series' "see the payments" disclosure is expanded — collapsed by
  // default, local to this sheet (not persisted).
  const [expandedSeries, setExpandedSeries] = useState<Set<string>>(new Set());

  function toggleMembers(seriesKey: string) {
    setExpandedSeries((prev) => {
      const next = new Set(prev);
      if (next.has(seriesKey)) next.delete(seriesKey);
      else next.add(seriesKey);
      return next;
    });
  }

  const { colours } = useColours();
  const { icons: iconOverrides } = useCategoryIcons();

  useEffect(() => {
    // Preview seam — when the caller injected a fixture list, never hit the
    // real endpoint (this route is also mounted unauthenticated).
    if (initialItems !== undefined) return;
    let cancelled = false;
    api
      .getMiscategorised()
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Preview seam — same contract as the items fetch above.
    if (initialPairs !== undefined) return;
    let cancelled = false;
    api
      .getTransferPairSuggestions()
      .then((res) => {
        if (!cancelled) setPairs(res.items);
      })
      .catch(() => {
        if (!cancelled) setPairs([]);
      });
    return () => {
      cancelled = true;
    };
    // initialPairs is a preview-only seam, deliberately excluded — same
    // one-time-mount-fetch contract as the initialItems effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Optimistic removal like handleDismiss below, but confirm is a write the
  // user explicitly asked for ("Same transfer" fixes both legs' categories
  // AND learns the description pair) — unlike dismiss, a failure must not be
  // swallowed. On failure the card is restored into the list with an inline
  // error line so the owner knows to retry; onChanged only fires on success,
  // since nothing actually changed server-side on failure.
  function handleConfirmPair(pair: TransferPairSuggestion) {
    setPairErrors((prev) => {
      if (!prev.has(pair.pair_key)) return prev;
      const next = new Set(prev);
      next.delete(pair.pair_key);
      return next;
    });
    setPairs((prev) => prev.filter((p) => p.pair_key !== pair.pair_key));
    api
      .confirmTransferPair(pair.credit.id, pair.debit.id)
      .then(() => onChanged?.())
      .catch(() => {
        setPairs((prev) => (prev.some((p) => p.pair_key === pair.pair_key) ? prev : [pair, ...prev]));
        setPairErrors((prev) => new Set(prev).add(pair.pair_key));
      });
  }

  function handleDismissPair(pair: TransferPairSuggestion) {
    setPairs((prev) => prev.filter((p) => p.pair_key !== pair.pair_key));
    api
      .dismissTransferPair(pair.pair_key)
      .catch(() => {})
      .finally(() => onChanged?.());
  }

  function renderPair(pair: TransferPairSuggestion) {
    const debitAccount = accounts.find((a) => a.id === pair.debit.account_id);
    const creditAccount = accounts.find((a) => a.id === pair.credit.account_id);
    const debitBrand = debitAccount ? accountBrand(debitAccount) : null;
    const creditBrand = creditAccount ? accountBrand(creditAccount) : null;
    const timing = pair.date_diff_days === 0 ? "on the same day" : "a day apart";
    const reasonText = `The same amount left ${debitAccount?.name ?? "one account"} and arrived in ${creditAccount?.name ?? "another account"} ${timing}.`;

    function legRow(
      leg: TransferPairSuggestion["debit"],
      account: Account | undefined,
      brand: ReturnType<typeof accountBrand> | null,
      sign: "credit" | "debit"
    ) {
      const label = leg.merchant_name || leg.description || "(no description)";
      return (
        <div className="flex items-center gap-2">
          <span className="flex-shrink-0 self-center inline-flex">
            {brand ? (
              <BankBadge
                logoSrc={brand.logoSrc}
                initials={brand.initials}
                altText={brand.label}
                brandBg={brand.background}
                size={20}
                initialsSize="8px"
              />
            ) : (
              <span className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 flex-shrink-0" />
            )}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold text-slate-700 dark:text-slate-200 truncate">
              {account?.name ?? "Unknown account"}
            </p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
              {formatDate(leg.date)} · {label}
            </p>
          </div>
          <span
            className={`text-[13px] font-semibold font-mono tabular-nums flex-shrink-0 ${
              sign === "credit" ? "text-emerald-500" : "text-slate-900 dark:text-slate-100"
            }`}
          >
            {sign === "credit" ? "+" : MINUS}
            {formatCurrency(leg.amount)}
          </span>
        </div>
      );
    }

    return (
      <div key={pair.pair_key} className="glass-card rounded-xl p-3 space-y-2.5">
        {legRow(pair.debit, debitAccount, debitBrand, "debit")}
        {legRow(pair.credit, creditAccount, creditBrand, "credit")}
        <p className="text-[11px] text-slate-400 dark:text-slate-500 line-clamp-2">{reasonText}</p>
        <div className="flex items-center gap-2 pt-0.5">
          <button
            type="button"
            onClick={() => handleConfirmPair(pair)}
            className="flex-1 min-h-[44px] py-2 rounded-xl text-sm font-semibold text-white active:scale-95 transition-transform"
            style={{ background: "linear-gradient(135deg, #4f46e5, #7c3aed)" }}
          >
            Same transfer
          </button>
          <button
            type="button"
            onClick={() => handleDismissPair(pair)}
            className="flex-1 min-h-[44px] py-2 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 active:scale-95 transition-transform"
          >
            Not the same
          </button>
        </div>
        {/* Confirm-failure line — same house style as SpendVerdictView's
            intent-save error (mt-2 text-[12px] font-semibold text-red-600).
            Absent unless this exact card's last confirm attempt failed. */}
        {pairErrors.has(pair.pair_key) && (
          <p className="text-[12px] font-semibold text-red-600 dark:text-red-400" role="alert">
            Couldn&apos;t file that, try again.
          </p>
        )}
      </div>
    );
  }

  function handleDismiss(item: MiscategorisedItem) {
    if (dismissingIds.has(item.series_key)) return;
    setDismissingIds((prev) => new Set(prev).add(item.series_key));
    // Optimistic — the whole series leaves immediately; a failed call just
    // leaves it out of this list until the next open (it'll re-surface from
    // the count).
    setItems((prev) => prev.filter((t) => t.series_key !== item.series_key));
    api
      .dismissMiscategorisedSeries(item.series_key)
      .catch(() => {})
      .finally(() => onChanged?.());
  }

  // "This period"/"Earlier periods" split — see the `periodStart` prop doc.
  // Items arrive date-desc from the endpoint; filtering preserves that
  // relative order within each group. Only actually split when it explains
  // something (both groups non-empty) — a single-group result falls back to
  // the plain flat list below, headers omitted.
  const thisPeriodItems = periodStart
    ? items.filter((it) => dateToUTCDay(it.date) >= periodStart.getTime())
    : [];
  const earlierItems = periodStart
    ? items.filter((it) => dateToUTCDay(it.date) < periodStart.getTime())
    : [];
  const showSplit = periodStart !== undefined && thisPeriodItems.length > 0 && earlierItems.length > 0;

  function renderItem(item: MiscategorisedItem) {
    const category = item.category || "Other";
    const colour = getCategoryColour(category, colours);
    const CategoryIcon = getCategoryIcon(category, iconOverrides);
    const name = item.merchant_name || item.description || "(no description)";
    const isCredit = item.transaction_type === "credit";
    const dismissing = dismissingIds.has(item.series_key);
    const hasRange =
      item.amount_min != null && item.amount_max != null && item.amount_min !== item.amount_max;
    // The account this series left from — omitted (no dangling
    // " · " separator) when account_id is absent (older cached
    // payload) or doesn't match anything in `accounts`.
    const account = item.account_id ? accounts.find(a => a.id === item.account_id) : undefined;
    const accountName = account?.name;
    const brand = account ? accountBrand(account) : null;
    // Quiet, one-line evidence for why this row was flagged —
    // absent entirely on an older cached payload (no `reason`).
    // When the account-match reason points at the SAME account
    // already named on the sub-line above, avoid repeating the
    // account name back to back (stutter) — refer to it instead.
    let reasonText: string | null = null;
    if (item.reason?.kind === "name") {
      reasonText = "The payee name matches yours.";
    } else if (item.reason?.kind === "account") {
      const reasonAccountId = item.reason.account_id;
      const sameAccountShownAbove = !!account && item.account_id === reasonAccountId;
      if (sameAccountShownAbove) {
        reasonText = "The account number on this payment matches the one shown above.";
      } else {
        const reasonAccount = accounts.find(a => a.id === reasonAccountId);
        reasonText = reasonAccount
          ? `The account number matches your ${reasonAccount.name}.`
          : "The account number matches one of your accounts.";
      }
    }
    const membersOpen = expandedSeries.has(item.series_key);
    const hasMembers = item.count > 1 && !!item.members && item.members.length > 0;
    // Visible rows cap — the server already caps `members` at 20 (see
    // _group_miscategorised), but a 20-row wall inside a bottom sheet is
    // still too many to scan (owner device-testing finding). Show only the
    // 6 most recent (members arrives date-descending) and fold the rest
    // into ONE summary line below, computed against `item.count` (the true
    // total) rather than `item.members.length`, so it's correct whether the
    // gap is the 6-cap here or the server's own 20-cap.
    const visibleMembers = item.members ? item.members.slice(0, 6) : [];
    const notShownCount = item.count - visibleMembers.length;
    return (
      <div key={item.series_key} className="glass-card rounded-xl p-3">
        <div className="flex items-center gap-3">
          <span
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: `${colour}26` }}
          >
            <ArrowLeftRight size={15} style={{ color: colour }} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate flex items-center gap-1.5">
              <span className="truncate">{name}</span>
              {item.count > 1 && (
                <span className="flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
                  {item.count}×
                </span>
              )}
            </p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
              {item.count > 1
                ? `${item.count} payments since ${formatDate(item.first_date ?? item.date)}`
                : formatDate(item.date)}
            </p>
            {account && accountName && brand && (
              // items-center on the row + a flex-shrink-0 self-center wrapper
              // around the badge — same alignment hardening as the expanded
              // member rows below (owner screenshot: badges sat high).
              <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate flex items-center gap-1">
                <span className="flex-shrink-0 self-center inline-flex">
                  <BankBadge
                    logoSrc={brand.logoSrc}
                    initials={brand.initials}
                    altText={brand.label}
                    brandBg={brand.background}
                    size={16}
                    initialsSize="6px"
                  />
                </span>
                <span className="truncate">{accountName}</span>
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <span className={`text-sm font-semibold font-mono tabular-nums whitespace-nowrap ${isCredit ? "text-emerald-500" : "text-slate-900 dark:text-slate-100"}`}>
              {isCredit ? "+" : MINUS}
              {hasRange ? (
                <>
                  {formatCurrency(item.amount_min as number, item.currency)}
                  {" – "}
                  {formatCurrency(item.amount_max as number, item.currency)}
                </>
              ) : (
                formatCurrency(item.amount, item.currency)
              )}
            </span>
            <span
              className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{ backgroundColor: `${colour}26`, color: colour }}
            >
              <CategoryIcon size={10} className="flex-shrink-0" style={{ color: colour }} />
              {category}
            </span>
          </div>
        </div>

        {/* Evidence line — sits full-width (not squeezed beside the
            amount column like the name/date/account sub-lines
            above) because the copy is a full sentence, not a
            short label; at the column's width it truncated hard
            enough to lose the account name entirely, defeating
            the point. Indented (pl-12 = icon width + gap) to
            align under the text above it, so it still reads as
            "directly under the account sub-line" visually.
            line-clamp-2 (not truncate) — the account-match copy
            is long enough that a single-line clamp cut it off
            mid-sentence ("...matches the one…"), which read as
            broken. Two lines gives every fixture variant room to
            finish the sentence (same pattern as SpendVerdictView's
            notable-card cause line). */}
        {reasonText && (
          <p className="pl-12 mt-1 text-[11px] text-slate-400 dark:text-slate-500 line-clamp-2">
            {reasonText}
          </p>
        )}

        {/* "See the payments" disclosure — count > 1 rows only,
            collapsed by default. Mirrors SpendVerdictView's
            notable-card "See the N payments" phrasing (same
            wording, ChevronRight), but expands INLINE (this is a
            disclosure, not a navigation link) rather than
            routing away — the owner can't yet see what the "2x"/
            "4x" badge above actually groups. Absent when
            `item.members` didn't come back (older payload). */}
        {hasMembers && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => toggleMembers(item.series_key)}
              aria-expanded={membersOpen}
              className="inline-flex items-center gap-0.5 min-h-[44px] text-[12px] font-semibold text-indigo-600 dark:text-indigo-400"
            >
              See the {item.count} payments
              <ChevronRight
                size={14}
                className={`flex-shrink-0 transition-transform ${membersOpen ? "rotate-90" : ""}`}
                aria-hidden="true"
              />
            </button>
            {membersOpen && (
              <div className="mt-1 space-y-1.5">
                {visibleMembers.map((m) => {
                  const mAccount = accounts.find(a => a.id === m.account_id);
                  const mAccountName = mAccount?.name;
                  const mBrand = mAccount ? accountBrand(mAccount) : null;
                  return (
                    <div key={m.id} className="flex items-center justify-between gap-2">
                      {/* items-center on the span (not just the row) keeps
                          the badge vertically centred against the date/
                          account text even when the span's own truncate/
                          flex-1 sizing would otherwise let the badge sit
                          against the top of the line box (owner screenshot:
                          badges sat high). Badge wrapped in its own
                          flex-shrink-0 self-center span — belt-and-braces
                          against the badge compressing or losing its own
                          cross-axis centring inside a truncating flex row,
                          the one combination items-center on the parent
                          alone doesn't fully pin down. */}
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate flex-1 min-w-0 flex items-center gap-1">
                        {formatDate(m.date)}
                        {mAccount && mAccountName && mBrand && (
                          <>
                            {" · "}
                            <span className="flex-shrink-0 self-center inline-flex">
                              <BankBadge
                                logoSrc={mBrand.logoSrc}
                                initials={mBrand.initials}
                                altText={mBrand.label}
                                brandBg={mBrand.background}
                                size={16}
                                initialsSize="6px"
                              />
                            </span>
                            <span className="truncate">{mAccountName}</span>
                          </>
                        )}
                      </span>
                      <span className="text-[11px] font-semibold font-mono tabular-nums text-slate-700 dark:text-slate-300 flex-shrink-0">
                        {isCredit ? "+" : MINUS}
                        {formatCurrency(m.amount, item.currency)}
                      </span>
                    </div>
                  );
                })}
                {notShownCount > 0 && (
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 italic pt-0.5">
                    {notShownCount} earlier payment{notShownCount === 1 ? "" : "s"} not shown
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={() => onRecategorise(toTransaction(item))}
            disabled={dismissing}
            className="flex-1 py-2 rounded-xl text-sm font-semibold text-white active:scale-95 transition-transform disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #4f46e5, #7c3aed)" }}
          >
            Recategorise
          </button>
          <button
            onClick={() => handleDismiss(item)}
            disabled={dismissing}
            className="flex-1 py-2 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 active:scale-95 transition-transform disabled:opacity-50"
          >
            {dismissing ? "Dismissing…" : "Dismiss"}
          </button>
        </div>
      </div>
    );
  }

  if (!mounted) return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-[65] fade-in" onClick={onClose} />

      {/* Sheet — bottom sheet on mobile, centered modal on desktop */}
      <div
        className="fixed left-1/2 -translate-x-1/2 w-full max-w-[500px] glass-sheet z-[70] overflow-y-auto
                    bottom-0 rounded-t-3xl slide-up max-h-[88dvh]
                    lg:bottom-auto lg:top-1/2 lg:-translate-y-1/2 lg:rounded-3xl lg:max-h-[85dvh] lg:shadow-2xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        {/* Handle — mobile only */}
        <div className="flex justify-center pt-3 pb-1 lg:hidden">
          <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-2 pb-4 lg:pt-5">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 truncate flex-1 mr-4">
            Review these transfers
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors flex-shrink-0"
          >
            <X size={16} color="#64748b" />
          </button>
        </div>

        {/* Penny explainer */}
        <div className="mx-5 mb-4 glass-card rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <span
              className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white rounded-full px-2.5 py-1"
              style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" }}
            >
              <PennyMark size={11} />
              Penny
            </span>
          </div>
          <p className="text-[14px] text-slate-700 dark:text-slate-200 leading-relaxed">
            Money moving between your own accounts isn&apos;t spending, it should be a{" "}
            <strong className="font-semibold text-slate-900 dark:text-slate-100">Transfer</strong>{" "}
            (or <strong className="font-semibold text-slate-900 dark:text-slate-100">Savings</strong>{" "}
            if it&apos;s going to a savings account, <strong className="font-semibold text-slate-900 dark:text-slate-100">Debt</strong>{" "}
            if it&apos;s a card payment). These look like your own transfers but landed in a spending
            category, which overstates your spending. Recategorise them, or dismiss if they&apos;re
            genuinely spending.
          </p>
        </div>

        {/* List — flat when there's nothing to split (periodStart absent,
            or every item falls in the same group), grouped into "This
            period"/"Earlier periods" only when the split actually explains
            something (see showSplit above). */}
        <div className="px-5 pb-20 lg:pb-6">
          {/* Cross-account transfer-pair suggestions — a fresher, more
              actionable signal than the miscategorised groups below (a
              possible pair still has both legs unresolved), so it renders
              first. Quiet, absent entirely when there's nothing to suggest;
              never blocked on the miscategorised list's own `loading`
              state — it fetches and resolves independently. */}
          {pairs.length > 0 && (
            <div className="space-y-2 mb-4">
              <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                Possibly the same transfer
              </p>
              <div className="space-y-2">{pairs.map(renderPair)}</div>
            </div>
          )}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner size={28} />
            </div>
          ) : items.length === 0 ? (
            pairs.length === 0 && (
              <div className="glass-card rounded-2xl p-8 text-center">
                <p className="text-2xl mb-2">🎉</p>
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">All reviewed</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                  Nothing left to check for now.
                </p>
              </div>
            )
          ) : showSplit ? (
            <div className="space-y-4">
              <div className="space-y-2">
                {/* Quiet uppercase section header — same idiom as
                    SpendVerdictView's majority-section header. */}
                <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                  This period
                </p>
                <div className="space-y-2">{thisPeriodItems.map(renderItem)}</div>
              </div>
              <div className="space-y-2">
                <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                  Earlier periods
                </p>
                <div className="space-y-2">{earlierItems.map(renderItem)}</div>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map(renderItem)}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}
