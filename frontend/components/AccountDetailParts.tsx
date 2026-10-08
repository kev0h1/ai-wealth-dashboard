import { Plus, Search, X } from "lucide-react";
import { BankBadge } from "@/components/AccountMiniCard";

/** The kind line under an account's balance. G233: an offline account has
 *  provider "Offline" and kind "Offline", which used to read "Offline · Offline".
 *  Show the type once ("Offline account"). */
export function accountDetailKindText(kindLabel: string, provider: string | undefined | null, consentExpiry?: string | null): string {
  const p = (provider ?? "").trim();
  const isOffline = kindLabel === "Offline" || p.toLowerCase() === "offline";
  const head = isOffline ? "Offline account" : p ? `${kindLabel} · ${p}` : kindLabel;
  return consentExpiry ? `${head} · ${consentExpiry}` : head;
}

export function AccountDetailIdentity({
  name, logoSrc, initials, label, background,
}: { name: string; logoSrc: string | null; initials: string; label: string; background?: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <BankBadge logoSrc={logoSrc} initials={initials} altText={label} brandBg={background} />
      <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100 min-w-0 truncate">{name}</h1>
    </div>
  );
}

export function AccountDetailKindLine({ kindLabel, provider, consentExpiry }: { kindLabel: string; provider?: string | null; consentExpiry?: string | null }) {
  return (
    <p className="mt-2 text-[13px] text-slate-500 dark:text-slate-400">
      {accountDetailKindText(kindLabel, provider, consentExpiry)}
    </p>
  );
}

/** Search field with, for an offline account, a compact outlined Add
 *  transaction button beside it. 12px between the two, 20px before the list
 *  (mb-5 collapses with the parent's space-y-2 gap). Icon-only below sm so it
 *  holds one row at 390px. */
export function AccountTransactionsToolbar({
  searchQuery, onSearchChange, onClearSearch, onAdd,
}: {
  searchQuery: string;
  onSearchChange: (v: string) => void;
  onClearSearch: () => void;
  onAdd?: () => void;
}) {
  return (
    <div className="mb-5 flex items-center gap-3" data-account-toolbar>
      <div className="relative flex-1 min-w-0">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none" />
        <input
          type="search"
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Search transactions…"
          className="w-full min-h-[44px] pl-9 pr-9 py-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={onClearSearch}
            aria-label="Clear search"
            className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          >
            <X size={14} />
          </button>
        )}
      </div>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          aria-label="Add transaction"
          data-add-transaction
          className="shrink-0 inline-flex items-center justify-center gap-1.5 min-h-[44px] min-w-[44px] min-[360px]:px-4 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 active:scale-95 transition-all text-sm font-semibold"
        >
          <Plus size={16} aria-hidden="true" />
          <span className="hidden min-[360px]:inline">Add</span>
        </button>
      )}
    </div>
  );
}
