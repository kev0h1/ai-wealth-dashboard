"use client";

// Variant C — horizontal bank chips filtering a single list.
//
// A third shape, distinct from both the accordion (A) and the search-plus-
// shortlist (B): one scrollable row of institution chips above one list.
// The chip for the suggested account's bank is pre-selected, so the common
// case still lands on a short, single-tap list without the user touching
// search or an accordion at all; tapping a different chip pivots the list
// to that bank in one motion, and "All" is always there for a full browse.
// No accordion state, no query field, just one filter dimension.

import { useState } from "react";
import { BankBadge, accountBrand } from "@/components/AccountMiniCard";
import { RadioDot } from "@/components/PlanOneOffSheet";
import type { Account } from "@/lib/api";
import { moneyStr, type PickerAccount } from "./fixtures";

function AccountRow({ account, value, onChange }: { account: Account; value: string; onChange: (id: string) => void }) {
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
        <span className="block text-xs text-slate-400 dark:text-slate-500 truncate money">{moneyStr(account.balance)}</span>
      </span>
      <RadioDot selected={value === account.id} />
    </button>
  );
}

export default function VariantC({
  accounts,
  suggestedId,
  value,
  onChange,
}: {
  accounts: PickerAccount[];
  suggestedId: string | null;
  value: string;
  onChange: (id: string) => void;
}) {
  const providers = Array.from(new Set(accounts.map((a) => a.provider)));
  const suggestedProvider = suggestedId ? accounts.find((a) => a.id === suggestedId)?.provider ?? null : null;
  const [activeProvider, setActiveProvider] = useState<string>(suggestedProvider ?? "All");

  const filtered = activeProvider === "All" ? accounts : accounts.filter((a) => a.provider === activeProvider);

  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
        Which account?
      </label>

      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 mb-2 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          onClick={() => setActiveProvider("All")}
          aria-pressed={activeProvider === "All"}
          className={`shrink-0 min-h-[36px] px-3 rounded-full text-[12.5px] font-semibold transition-colors ${
            activeProvider === "All"
              ? "bg-indigo-500 text-white"
              : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 active:bg-slate-200 dark:active:bg-slate-600"
          }`}
        >
          All · {accounts.length}
        </button>
        {providers.map((provider) => {
          const count = accounts.filter((a) => a.provider === provider).length;
          const sample = accounts.find((a) => a.provider === provider)!;
          const brand = accountBrand(sample);
          const active = activeProvider === provider;
          return (
            <button
              key={provider}
              type="button"
              onClick={() => setActiveProvider(provider)}
              aria-pressed={active}
              className={`shrink-0 min-h-[36px] flex items-center gap-1.5 pl-1 pr-3 rounded-full text-[12.5px] font-semibold transition-colors ${
                active
                  ? "bg-indigo-500 text-white"
                  : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 active:bg-slate-200 dark:active:bg-slate-600"
              }`}
            >
              <BankBadge logoSrc={brand.logoSrc} initials={brand.initials} altText={brand.label} brandBg={brand.background} size={22} />
              {provider} · {count}
            </button>
          );
        })}
      </div>

      <div role="radiogroup" aria-label="Which account?" className="rounded-xl border border-slate-200/70 dark:border-white/[0.08] divide-y divide-slate-100 dark:divide-white/[0.06] overflow-hidden">
        {filtered.map((account) => (
          <AccountRow key={account.id} account={account} value={value} onChange={onChange} />
        ))}
      </div>

      <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
        Only one active allocation can fill from the same payment.
      </p>
    </div>
  );
}
