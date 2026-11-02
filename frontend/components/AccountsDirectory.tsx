"use client";

import { ChevronDown, ChevronRight, Search, Star, X } from "lucide-react";
import { BankIcon } from "@/components/AccountMiniCard";
import { accountKindLabel, type AccountKind } from "@/lib/accountKind";
import type { AccountAvailabilityReading } from "@/lib/accountAvailability";
import type { EstateRow } from "@/lib/accountsEstate";
import type { SyncingInfo } from "@/components/SyncNote";
import type { Account } from "@wealth/shared";

type DirectoryGroup = AccountKind;

const GROUPS: DirectoryGroup[] = ["Current", "Savings", "Credit", "Debt", "Investment", "Offline"];
const GROUP_LABELS: Record<DirectoryGroup, string> = {
  Current: "Current",
  Savings: "Savings",
  Credit: "Credit cards",
  Debt: "Loans and mortgages",
  Investment: "Investments",
  Offline: "Offline",
};

const MINUS = "−";

export interface AccountsDirectoryProps {
  rows: EstateRow[];
  hidden: boolean;
  query: string;
  onQuery: (query: string) => void;
  pinnedOnly: boolean;
  onPinnedOnly: (pinnedOnly: boolean) => void;
  showDormant: boolean;
  onShowDormant: (showDormant: boolean) => void;
  collapsed: Record<string, boolean>;
  onToggleGroup: (key: string) => void;
  onOpen: (row: EstateRow, trigger: HTMLElement) => void;
  syncFor?: (row: EstateRow) => SyncingInfo | undefined;
  availabilityFor?: (row: EstateRow) => AccountAvailabilityReading | undefined;
}

/** Pure filtering for the controlled directory. The page deliberately owns
 * filter state so it survives opening and closing account detail. */
export function directoryRows(
  rows: EstateRow[],
  { query, pinnedOnly, showDormant }: Pick<AccountsDirectoryProps, "query" | "pinnedOnly" | "showDormant">,
): EstateRow[] {
  const needle = query.trim().toLocaleLowerCase("en-GB");
  return rows.filter((row) => {
    if (pinnedOnly && !row.pinned) return false;
    if (!showDormant && row.dormant) return false;
    if (!needle) return true;
    return [row.name, row.provider, accountKindLabel(row.kind), row.kind]
      .join(" ")
      .toLocaleLowerCase("en-GB")
      .includes(needle);
  });
}

/** Manual accounts are offline regardless of their provider text. No account
 * category is ever inferred from its name or a balance-only reason. */
export function directoryGroup(row: EstateRow): DirectoryGroup {
  return row.source === "bank" && Boolean((row.raw as Account).manual) ? "Offline" : row.kind;
}

function balanceText(value: number, hidden: boolean): string | null {
  if (!Number.isFinite(value)) return null;
  if (hidden) return `${value < 0 ? MINUS : ""}£••••`;
  return `${value < 0 ? MINUS : ""}£${Math.round(Math.abs(value)).toLocaleString("en-GB")}`;
}

function rowStatus(row: EstateRow, sync?: SyncingInfo, availability?: AccountAvailabilityReading): string | null {
  const raw = row.raw as Partial<Account>;
  if (row.status === "expired" || row.attention) return "Expired";
  if (raw.paused) return "Paused";
  if (raw.balance_only) return "Balance only";
  if (row.source === "bank" && raw.include_in_safe_to_spend === false) return "Not counted";
  if (sync) return sync.failed ? "Update failed" : sync.stalled ? "Update delayed" : sync.kind === "new-bank" ? "Balance pending" : "Updating";
  if (availability?.kind === "ready" && availability.warning) return availability.warning === "payments" ? "Payments look short" : "Short after plans";
  if (row.dormant) return "Dormant";
  if (row.pinned) return "Pinned";
  return null;
}

function Row({
  row,
  hidden,
  onOpen,
  sync,
  availability,
}: {
  row: EstateRow;
  hidden: boolean;
  onOpen: AccountsDirectoryProps["onOpen"];
  sync?: SyncingInfo;
  availability?: AccountAvailabilityReading;
}) {
  const pending = sync?.kind === "new-bank";
  const amount = pending ? null : balanceText(row.balance, hidden);
  const status = rowStatus(row, sync, availability);
  const negative = Number.isFinite(row.balance) && row.balance < 0;
  const risk = negative && !sync && (row.kind === "Current" || row.kind === "Savings");
  const ariaBalance = pending || amount === null ? "balance unavailable" : hidden ? (negative ? "negative balance hidden" : "balance hidden") : amount;

  return (
    <button
      type="button"
      data-tutorial-id={row.source === "bank" && (row.raw as Account).manual ? "tutorial-offline-rules" : undefined}
      data-account-id={row.id}
      data-account-row-id={row.id}
      onClick={(event) => onOpen(row, event.currentTarget)}
      aria-label={`${row.name}, ${row.provider}, ${accountKindLabel(row.kind)}, ${ariaBalance}${status ? `, ${status}` : ""}`}
      className="grid w-full grid-cols-[36px_minmax(0,1fr)_auto_16px] items-center gap-2 border-t border-slate-100 px-1 py-2.5 text-left transition-colors hover:bg-slate-50 active:bg-slate-100 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:border-slate-800 dark:hover:bg-white/5 dark:active:bg-white/10"
    >
      <BankIcon identity={row.raw} size={32} altText="" />
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1">
          {row.pinned ? <Star size={12} aria-hidden="true" className="shrink-0 fill-indigo-400/20 text-indigo-600 dark:text-indigo-300" /> : null}
          <span className="truncate text-[15px] font-semibold text-slate-900 dark:text-slate-100">{row.name}</span>
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] leading-4 text-slate-500 dark:text-slate-400">
          <span className="truncate">{row.provider} · {accountKindLabel(row.kind)}</span>
          {status ? <span className="shrink-0 text-slate-500 dark:text-slate-400">· {status}</span> : null}
        </span>
      </span>
      <span className={`justify-self-end whitespace-nowrap ${amount === null ? "text-sm" : "money text-[16px]"} font-semibold tabular-nums ${risk ? "text-rose-700 dark:text-rose-300" : "text-slate-900 dark:text-slate-100"}`}>
        {pending || amount === null ? "Pending" : amount}
      </span>
      <ChevronRight size={16} aria-hidden="true" className="text-slate-400 dark:text-slate-500" />
    </button>
  );
}

export default function AccountsDirectory({
  rows,
  hidden,
  query,
  onQuery,
  pinnedOnly,
  onPinnedOnly,
  showDormant,
  onShowDormant,
  collapsed,
  onToggleGroup,
  onOpen,
  syncFor,
  availabilityFor,
}: AccountsDirectoryProps) {
  const shown = directoryRows(rows, { query, pinnedOnly, showDormant });

  return (
    <section data-tutorial-id="tutorial-account-directory" aria-label="Account directory" className="mt-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="flex h-11 min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-slate-600 focus-within:ring-2 focus-within:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <Search size={17} aria-hidden="true" className="shrink-0" />
          <span className="sr-only">Find an account</span>
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            type="search"
            name="account-search"
            autoComplete="off"
            spellCheck={false}
            placeholder="Find an account…"
            className="min-w-0 flex-1 bg-transparent text-[16px] text-slate-900 outline-none placeholder:text-slate-600 dark:text-slate-100 dark:placeholder:text-slate-400"
          />
          {query ? (
            <button type="button" aria-label="Clear search" onClick={event => { onQuery(""); event.currentTarget.parentElement?.querySelector("input")?.focus(); }} className="-mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400">
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
        </label>
        <div className="flex flex-wrap gap-1" aria-label="Account filters">
          <button type="button" onClick={() => onPinnedOnly(false)} aria-pressed={!pinnedOnly} className="min-h-11 rounded-full border border-slate-300 px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-100 active:opacity-70 dark:hover:bg-slate-800 aria-pressed:border-indigo-300 aria-pressed:bg-indigo-50 aria-pressed:text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:text-slate-200 dark:aria-pressed:border-indigo-500 dark:aria-pressed:bg-indigo-950 dark:aria-pressed:text-indigo-200">All</button>
          <button type="button" onClick={() => onPinnedOnly(true)} aria-pressed={pinnedOnly} className="min-h-11 rounded-full border border-slate-300 px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-100 active:opacity-70 dark:hover:bg-slate-800 aria-pressed:border-indigo-300 aria-pressed:bg-indigo-50 aria-pressed:text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:text-slate-200 dark:aria-pressed:border-indigo-500 dark:aria-pressed:bg-indigo-950 dark:aria-pressed:text-indigo-200">Pinned</button>
          <button type="button" onClick={() => onShowDormant(!showDormant)} aria-pressed={showDormant} className="min-h-11 rounded-full border border-slate-300 px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-100 active:opacity-70 dark:hover:bg-slate-800 aria-pressed:border-indigo-300 aria-pressed:bg-indigo-50 aria-pressed:text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:text-slate-200 dark:aria-pressed:border-indigo-500 dark:aria-pressed:bg-indigo-950 dark:aria-pressed:text-indigo-200">Dormant</button>
        </div>
      </div>

      <p role="status" className="mt-3 text-xs text-slate-600 dark:text-slate-400">{shown.length} {shown.length === 1 ? "account" : "accounts"} · Pinned accounts stay in their normal group.</p>
      {shown.length === 0 ? (
        <p className="py-8 text-[14px] text-slate-600 dark:text-slate-300">No accounts match these filters.</p>
      ) : (
        <div className="mt-4">
          {GROUPS.map((group) => {
            const entries = shown.filter((row) => directoryGroup(row) === group);
            if (entries.length === 0) return null;
            const key = `accounts-${group.toLowerCase()}`;
            const closed = Boolean(collapsed[key]);
            return (
              <section key={group} className="border-t border-slate-200 dark:border-slate-700">
                <h2><button type="button" onClick={() => onToggleGroup(key)} aria-expanded={!closed} aria-controls={`${key}-rows`} className="grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto_18px] items-center gap-2 text-left hover:bg-slate-50 active:opacity-70 dark:hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500">
                  <span className="text-[15px] font-bold text-slate-900 dark:text-slate-100">{GROUP_LABELS[group]}</span>
                  <span className="text-[12px] text-slate-500 dark:text-slate-400">{entries.length} {entries.length === 1 ? "account" : "accounts"}</span>
                  <ChevronDown size={17} aria-hidden="true" className={`text-slate-500 transition-transform motion-reduce:transition-none dark:text-slate-400 ${closed ? "-rotate-90" : ""}`} />
                </button></h2>
                {!closed ? <div id={`${key}-rows`}>{entries.map((row) => <Row key={row.id} row={row} hidden={hidden} onOpen={onOpen} sync={syncFor?.(row)} availability={availabilityFor?.(row)} />)}</div> : null}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
