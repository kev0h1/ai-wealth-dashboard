"use client";

// G233 offline account detail: header, avatar and transactions toolbar.
// Renders the PRODUCTION AccountDetailIdentity, AccountDetailKindLine,
// AccountTransactionsToolbar, BankBadge (via accountBrand) and TransactionRow
// through props. The page frame and balance line are inline in AccountsPage,
// so they are recreated here. Design skill: impeccable (small alignment fix).

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { accountBrand } from "@/components/AccountMiniCard";
import { AccountDetailIdentity, AccountDetailKindLine, AccountTransactionsToolbar } from "@/components/AccountDetailParts";
import TransactionRow from "@/components/TransactionRow";
import { accountKind, accountKindLabel } from "@/lib/accountKind";
import { OFFLINE_ACCOUNT, BANK_ACCOUNT, TRANSACTIONS } from "./fixtures";

const noop = () => {};

export default function OfflineAccountClient() {
  const params = useSearchParams();
  const mode = params.get("mode") === "dark" ? "dark" : "light";
  const which = params.get("account") === "bank" ? "bank" : "offline";
  const account = which === "bank" ? BANK_ACCOUNT : OFFLINE_ACCOUNT;
  const [query, setQuery] = useState("");
  const brand = accountBrand(account);
  const shown = TRANSACTIONS.filter((t) => !query || t.description.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.documentElement.style.colorScheme = mode;
  }, [mode]);

  const q = (n: Record<string, string>) => `?account=${n.account ?? which}&mode=${n.mode ?? mode}`;
  const chip = (on: boolean) => `inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl px-3 text-xs font-bold active:scale-95 ${on ? "bg-white text-slate-950" : "text-slate-300 hover:bg-white/10"}`;

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950">
      <nav aria-label="G233 preview controls" className="border-b border-white/10 bg-slate-950 px-2 py-1 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-1">
          <a href={q({ account: "offline" })} className={chip(which === "offline")}>Offline</a>
          <a href={q({ account: "bank" })} className={chip(which === "bank")}>Bank</a>
          <span className="mx-1 h-5 w-px bg-white/15" aria-hidden="true" />
          <a href={q({ mode: mode === "dark" ? "light" : "dark" })} className={chip(false)}>{mode === "dark" ? "Light" : "Dark"}</a>
        </div>
      </nav>
      <div className="lg:max-w-6xl lg:mx-auto pb-8">
        <div className="px-4 pt-4">
          <div className="mb-4 min-h-[44px] flex items-center text-sm font-medium text-slate-500 dark:text-slate-400">Accounts</div>
          <AccountDetailIdentity name={account.name} logoSrc={brand.logoSrc} initials={brand.initials} label={brand.label} background={brand.background} />
          <p className="text-[30px] leading-none font-bold money text-slate-900 dark:text-slate-100">
            £{account.balance.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <AccountDetailKindLine kindLabel={accountKindLabel(accountKind(account))} provider={account.provider} />
          <div className="mt-5 border-t border-slate-300/80 dark:border-slate-700" />
        </div>
        <div className="px-4 pt-4 space-y-2">
          <AccountTransactionsToolbar
            searchQuery={query}
            onSearchChange={setQuery}
            onClearSearch={() => setQuery("")}
            onAdd={which === "offline" ? noop : undefined}
          />
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
            <div className="divide-y divide-slate-50 dark:divide-slate-700">
              {shown.map((tx) => <TransactionRow key={tx.id} transaction={tx} onClick={noop} />)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
