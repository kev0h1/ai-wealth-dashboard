"use client";

// Single-select "choose one own account" radiogroup — search-first with a
// smart shortlist (Variant B, owner pick from /design/account-picker,
// 2026-08-29 review: the flat list "becomes very cluttered" once real
// banks + Monzo/Chase pots are connected, ~14-15 rows for the owner).
//
// Shared by every call site that asks "which account?" over the user's own
// accounts with single-tap RadioDot semantics: AllocationFields.tsx's
// AccountRadioPicker (SetAsideSheet.tsx create, AllocationSheet.tsx edit),
// PlanOneOffSheet.tsx and PlannedEditSheet.tsx's "which account will it
// leave from?" field (byte-identical pickers before this extraction, both
// adding an optional leading "not sure yet" row via `allowUnset`).
//
// Below 6 accounts the shortlist already contains the whole list, so the
// search field and "Show all" affordance are pointless chrome and are
// hidden entirely — "the shortlist IS the list" (owner instruction).
// Above that, a compact 5-row shortlist (savings-kind accounts first, then
// whatever recency signal is cheaply available — none of today's call
// sites carry one yet, so the fallback is balance descending) leads, with
// search matching the FULL account set regardless of shortlist/expanded
// state so nothing is ever unreachable.

import { useMemo, useState } from "react";
import { Search, CircleDashed } from "lucide-react";
import { accountBrand, BankBadge, RadioDot } from "@/components/AccountMiniCard";
import { currencySymbol } from "@/lib/currency";
import { fmt } from "@/lib/format";
import type { Account } from "@/lib/api";

const SHORTLIST_SIZE = 5;
const DECLUTTER_THRESHOLD = 5;

function isSavingsKind(a: Account): boolean {
  return (a.subtype || "").toLowerCase().includes("saving");
}

/** Savings-kind accounts first, then by whatever recency signal is cheaply
 *  available (none today), falling back to balance descending. No backend
 *  calls — everything here comes from the `accounts` already in hand. */
function rankAccounts(accounts: Account[]): Account[] {
  return [...accounts].sort((a, b) => {
    const aSavings = isSavingsKind(a) ? 0 : 1;
    const bSavings = isSavingsKind(b) ? 0 : 1;
    if (aSavings !== bSavings) return aSavings - bSavings;
    return (b.balance ?? 0) - (a.balance ?? 0);
  });
}

function balanceCaption(account: Account): React.ReactNode {
  const amount = fmt(account.balance, currencySymbol(account.currency));
  return (
    <>
      {account.provider} · <span className="money">{amount}</span>
    </>
  );
}

function AccountRow({
  account,
  value,
  onChange,
}: {
  account: Account;
  value: string;
  onChange: (id: string) => void;
}) {
  const brand = accountBrand(account);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={value === account.id}
      onClick={() => onChange(account.id)}
      className="w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5 text-left active:opacity-70 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset"
    >
      <BankBadge logoSrc={brand.logoSrc} initials={brand.initials} altText={brand.label} brandBg={brand.background} />
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{account.name}</span>
        <span className="block text-xs text-slate-400 dark:text-slate-500 truncate">{balanceCaption(account)}</span>
      </span>
      <RadioDot selected={value === account.id} />
    </button>
  );
}

function UnsetRow({ label, selected, onSelect }: { label: string; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className="w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5 text-left active:opacity-70 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset"
    >
      <span className="w-9 h-9 rounded-xl flex items-center justify-center bg-slate-100 dark:bg-white/[0.06] ring-1 ring-black/[0.06] dark:ring-white/[0.12] flex-shrink-0">
        <CircleDashed size={16} className="text-slate-400 dark:text-slate-500" />
      </span>
      <span className="flex-1 min-w-0 text-sm font-medium text-slate-700 dark:text-slate-200">{label}</span>
      <RadioDot selected={selected} />
    </button>
  );
}

export interface AccountRadioPickerProps {
  accounts: Account[];
  value: string;
  onChange: (accountId: string) => void;
  /** Field label, above the search box / list. */
  label?: string;
  /** Overrides the radiogroup's aria-label; defaults to `label`. */
  ariaLabel?: string;
  /** Adds a leading "not sure yet" pseudo-row mapping to value === "" —
   *  PlanOneOffSheet/PlannedEditSheet's optional account field. Omitted
   *  (the AllocationFields.tsx envelope picker) means every account is a
   *  required, real choice. */
  allowUnset?: boolean;
  unsetLabel?: string;
  /** Quiet caption under the list. Omit for no caption. */
  helperText?: React.ReactNode;
}

export function AccountRadioPicker({
  accounts,
  value,
  onChange,
  label = "Which account?",
  ariaLabel,
  allowUnset = false,
  unsetLabel = "Not sure yet",
  helperText,
}: AccountRadioPickerProps) {
  const [query, setQuery] = useState("");

  // Below the declutter threshold the shortlist already is the full list —
  // search and "Show all" are pointless chrome and stay hidden.
  const fewAccounts = accounts.length <= DECLUTTER_THRESHOLD;

  const ranked = useMemo(() => rankAccounts(accounts), [accounts]);
  const shortlist = useMemo(() => ranked.slice(0, SHORTLIST_SIZE), [ranked]);
  const rest = useMemo(() => ranked.slice(SHORTLIST_SIZE), [ranked]);

  const [showAll, setShowAll] = useState(false);

  const trimmed = query.trim().toLowerCase();
  const isSearching = !fewAccounts && trimmed.length > 0;
  const searchResults = useMemo(() => {
    if (!isSearching) return [];
    return accounts.filter(
      (a) => a.name.toLowerCase().includes(trimmed) || a.provider.toLowerCase().includes(trimmed)
    );
  }, [accounts, trimmed, isSearching]);

  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
        {label}
      </label>

      {!fewAccounts && (
        <div className="relative mb-2">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search accounts and pots…"
            aria-label={`Search ${(ariaLabel ?? label).toLowerCase()}`}
            className="w-full min-h-[44px] rounded-xl bg-slate-50 dark:bg-slate-700 pl-9 pr-3 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      )}

      {isSearching ? (
        <div
          role="radiogroup"
          aria-label={ariaLabel ?? label}
          className="rounded-xl border border-slate-200/70 dark:border-white/[0.08] divide-y divide-slate-100 dark:divide-white/[0.06] overflow-hidden"
        >
          {allowUnset && <UnsetRow label={unsetLabel} selected={value === ""} onSelect={() => onChange("")} />}
          {searchResults.length === 0 ? (
            <p className="px-3 py-4 text-[13px] text-slate-400 dark:text-slate-500">No accounts match &ldquo;{query.trim()}&rdquo;</p>
          ) : (
            searchResults.map((account) => (
              <AccountRow key={account.id} account={account} value={value} onChange={onChange} />
            ))
          )}
        </div>
      ) : (
        <div
          role="radiogroup"
          aria-label={ariaLabel ?? label}
          className="rounded-xl border border-slate-200/70 dark:border-white/[0.08] divide-y divide-slate-100 dark:divide-white/[0.06] overflow-hidden"
        >
          {allowUnset && <UnsetRow label={unsetLabel} selected={value === ""} onSelect={() => onChange("")} />}

          {shortlist.map((account) => (
            <AccountRow key={account.id} account={account} value={value} onChange={onChange} />
          ))}

          {rest.length > 0 && (
            <div
              className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none motion-reduce:duration-0 ${
                showAll ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
              }`}
            >
              <div className="overflow-hidden divide-y divide-slate-100 dark:divide-white/[0.06]">
                {rest.map((account) => (
                  <AccountRow key={account.id} account={account} value={value} onChange={onChange} />
                ))}
              </div>
            </div>
          )}

          {rest.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAll((s) => !s)}
              className="w-full min-h-[44px] flex items-center px-3 text-[13px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset"
            >
              {showAll ? "Show fewer" : `Show all ${accounts.length} accounts ›`}
            </button>
          )}
        </div>
      )}

      {helperText && <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">{helperText}</p>}
    </div>
  );
}
