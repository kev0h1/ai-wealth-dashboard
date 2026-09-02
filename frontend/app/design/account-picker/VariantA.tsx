"use client";

// Variant A — grouped by institution, collapsed by default.
//
// The owner's 15 rows are really 6 institutions; the list only feels long
// because it's flattened. Group by bank; every group with more than one
// account is a genuinely collapsed header (badge + name + count) by
// default, so the Monzo group of 7 — exactly the case that made the flat
// list "very cluttered" — starts as a single row, not seven. A group with
// only one account renders as that account's own row directly, no header
// and no extra tap, since there is nothing to collapse. The single most
// likely target is pinned above the groups as an ungrouped "Suggested" row
// so the common case ("top up my emergency pot") stays one tap even at 15
// accounts, and at 3 accounts (mostly single-account groups) this collapses
// to almost the same flat list it would have been anyway.

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { BankBadge, accountBrand } from "@/components/AccountMiniCard";
import { RadioDot } from "@/components/PlanOneOffSheet";
import type { Account } from "@/lib/api";
import { groupByProvider, moneyStr, type PickerAccount } from "./fixtures";

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

export default function VariantA({
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
  const suggested = suggestedId ? accounts.find((a) => a.id === suggestedId) ?? null : null;
  // The suggested account is pinned above the groups, so it's excluded from
  // them below — otherwise it would appear twice on screen at once (most
  // visible in the "few" state, where its bank often has no other account
  // left to group it with).
  const groups = groupByProvider(suggested ? accounts.filter((a) => a.id !== suggested.id) : accounts);
  // Genuinely collapsed by default — every multi-account group starts
  // closed, full stop. Single-account groups don't have an "open" state at
  // all; see the render branch below.
  const [open, setOpen] = useState<Record<string, boolean>>({});

  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
        Which account?
      </label>

      <div role="radiogroup" aria-label="Which account?" className="space-y-2">
        {suggested && (
          <div className="rounded-xl border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50/60 dark:bg-indigo-500/[0.08] overflow-hidden">
            <p className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wide text-indigo-500 dark:text-indigo-300">
              Suggested
            </p>
            <AccountRow account={suggested} value={value} onChange={onChange} />
          </div>
        )}

        {groups.length > 0 && (
        <div className="rounded-xl border border-slate-200/70 dark:border-white/[0.08] divide-y divide-slate-100 dark:divide-white/[0.06] overflow-hidden">
          {groups.map((group) => {
            // A single-account "group" is just that account's row — nothing
            // to collapse, so no header and no extra tap.
            if (group.accounts.length === 1) {
              return (
                <AccountRow key={group.provider} account={group.accounts[0]} value={value} onChange={onChange} />
              );
            }

            const isOpen = !!open[group.provider];
            const brand = accountBrand(group.accounts[0]);
            const groupHasSelection = group.accounts.some((a) => a.id === value);
            return (
              <div key={group.provider}>
                <button
                  type="button"
                  onClick={() => setOpen((o) => ({ ...o, [group.provider]: !o[group.provider] }))}
                  aria-expanded={isOpen}
                  className="w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5 text-left active:bg-slate-50 dark:active:bg-white/[0.03] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset"
                >
                  <BankBadge logoSrc={brand.logoSrc} initials={brand.initials} altText={brand.label} brandBg={brand.background} />
                  <span className="flex-1 min-w-0 flex items-baseline gap-1.5">
                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{group.provider}</span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">· {group.accounts.length}</span>
                    {groupHasSelection && !isOpen && (
                      <span className="text-[10px] font-semibold text-indigo-500 dark:text-indigo-300">selected</span>
                    )}
                  </span>
                  <ChevronDown
                    size={14}
                    className={`text-slate-400 dark:text-slate-500 transition-transform duration-200 motion-reduce:transition-none flex-shrink-0 ${isOpen ? "rotate-180" : ""}`}
                    aria-hidden="true"
                  />
                </button>

                <div
                  className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none motion-reduce:duration-0 ${
                    isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                  }`}
                >
                  <div className="overflow-hidden">
                    <div className="divide-y divide-slate-100 dark:divide-white/[0.06] border-t border-slate-100 dark:border-white/[0.06] bg-slate-50/50 dark:bg-white/[0.02]">
                      {group.accounts.map((account) => (
                        <AccountRow key={account.id} account={account} value={value} onChange={onChange} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>

      <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
        Only one active allocation can fill from the same payment.
      </p>
    </div>
  );
}
