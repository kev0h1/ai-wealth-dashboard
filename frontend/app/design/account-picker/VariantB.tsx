"use client";

// Variant B — search-first, with a smart shortlist.
//
// Most of the time the user isn't browsing the estate, they know roughly
// which pot they mean. Lead with a compact search field and a 4-5 row
// shortlist (savings pots first, recency-weighted) so the default view is
// never longer than what a phone screen shows without scrolling; "Show all
// N accounts" is one tap away and is where search also searches once
// opened, so it never becomes a dead end for the account that didn't make
// the shortlist.

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { BankBadge, accountBrand } from "@/components/AccountMiniCard";
import { RadioDot } from "@/components/PlanOneOffSheet";
import type { Account } from "@/lib/api";
import { moneyStr, recencyLabel, recencyShortlist, type PickerAccount } from "./fixtures";

function AccountRow({
  account,
  value,
  onChange,
  caption,
}: {
  account: Account;
  value: string;
  onChange: (id: string) => void;
  caption?: string;
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
        <span className="block text-xs text-slate-400 dark:text-slate-500 truncate">
          {caption ?? `${account.provider} · ${moneyStr(account.balance)}`}
        </span>
      </span>
      <RadioDot selected={value === account.id} />
    </button>
  );
}

export default function VariantB({
  accounts,
  value,
  onChange,
}: {
  accounts: PickerAccount[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(accounts.length <= 5);

  const shortlist = useMemo(() => recencyShortlist(accounts, 5), [accounts]);
  const shortlistIds = useMemo(() => new Set(shortlist.map((a) => a.id)), [shortlist]);
  const rest = useMemo(() => accounts.filter((a) => !shortlistIds.has(a.id)), [accounts, shortlistIds]);

  const trimmed = query.trim().toLowerCase();
  const isSearching = trimmed.length > 0;
  const searchResults = useMemo(() => {
    if (!isSearching) return [];
    return accounts.filter(
      (a) => a.name.toLowerCase().includes(trimmed) || a.provider.toLowerCase().includes(trimmed)
    );
  }, [accounts, trimmed, isSearching]);

  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
        Which account?
      </label>

      <div className="relative mb-2">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none" aria-hidden="true" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search accounts and pots…"
          aria-label="Search accounts and pots"
          className="w-full min-h-[44px] rounded-xl bg-slate-50 dark:bg-slate-700 pl-9 pr-3 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {isSearching ? (
        <div role="radiogroup" aria-label="Which account?" className="rounded-xl border border-slate-200/70 dark:border-white/[0.08] divide-y divide-slate-100 dark:divide-white/[0.06] overflow-hidden">
          {searchResults.length === 0 ? (
            <p className="px-3 py-4 text-[13px] text-slate-400 dark:text-slate-500">No accounts match "{query.trim()}"</p>
          ) : (
            searchResults.map((account) => <AccountRow key={account.id} account={account} value={value} onChange={onChange} />)
          )}
        </div>
      ) : (
        <div role="radiogroup" aria-label="Which account?" className="rounded-xl border border-slate-200/70 dark:border-white/[0.08] divide-y divide-slate-100 dark:divide-white/[0.06] overflow-hidden">
          {shortlist.map((account) => (
            <AccountRow key={account.id} account={account} value={value} onChange={onChange} caption={recencyLabel(account.lastUsedDaysAgo)} />
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

      <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
        Only one active allocation can fill from the same payment.
      </p>
    </div>
  );
}
