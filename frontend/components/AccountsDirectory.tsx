"use client";

// G391 correction: retain the current search and restore the original estate
// controls, bounded groups, pinned band and per-row Available readings.
import { ChevronDown, Search, X } from "lucide-react";
import { filterEstate, type Estate, type EstateLens, type EstateRow } from "@/lib/accountsEstate";
import AccountLedgerRow, { type AccountLedgerRowProps } from "@/components/AccountLedgerRow";
import AccountGroupCard from "@/components/AccountGroupCard";
import AccountsEstateControls from "@/components/AccountsEstateControls";

export interface AccountsDirectoryProps {
  estate: Estate;
  manualRows: EstateRow[];
  hidden: boolean;
  query: string;
  onQuery: (query: string) => void;
  lens: EstateLens;
  onLens: (lens: EstateLens) => void;
  showDormant: boolean;
  onShowDormant: (open: boolean) => void;
  collapsed: Record<string, boolean>;
  onToggleGroup: (key: string, currentlyCollapsed: boolean) => void;
  onOpen: NonNullable<AccountLedgerRowProps["onClick"]>;
  syncFor?: (row: EstateRow) => AccountLedgerRowProps["sync"];
  availabilityFor?: (row: EstateRow) => AccountLedgerRowProps["availability"];
  termsFor?: (row: EstateRow) => Pick<AccountLedgerRowProps, "termsPill" | "onTermsClick" | "onAddRates">;
}

export default function AccountsDirectory({ estate, manualRows, hidden, query, onQuery, lens, onLens, showDormant, onShowDormant, collapsed, onToggleGroup, onOpen, syncFor, availabilityFor, termsFor }: AccountsDirectoryProps) {
  const estateIsFiltering = query.trim().length > 0 || lens !== "All";
  const estateFilteredRows = filterEstate([...estate.rows, ...manualRows], { query, lens });
  const inactiveRows = estate.inactive;
  return (
    <section data-tutorial-id="tutorial-account-directory" aria-label="Account directory" className="mt-6 space-y-3">
      <AccountsEstateControls query={query} onQuery={onQuery} lens={lens} onLens={onLens} search={
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
      } />
    {estateIsFiltering ? (
      <div>
        <p className="px-1 mb-2 text-xs font-medium text-slate-400 dark:text-slate-500">
          {estateFilteredRows.length} result{estateFilteredRows.length === 1 ? "" : "s"}
        </p>
        {estateFilteredRows.length === 0 ? (
          <div className="glass-card rounded-2xl px-4 py-10 text-center text-sm text-slate-400 dark:text-slate-500">
            No accounts match
          </div>
        ) : (
          <div className="glass-card rounded-2xl overflow-hidden">
            {estateFilteredRows.map((row, i) => (
              <div key={row.id} className={i > 0 ? "border-t border-slate-100 dark:border-white/5" : ""}>
                <AccountLedgerRow
                  row={row}
                  focusKey={`results:${row.id}`}
                  onClick={onOpen}
                  sync={syncFor?.(row)}
                  {...termsFor?.(row)}
                  hideAmount={hidden}
                  availability={availabilityFor?.(row)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    ) : (
      <>

        {estate.pinned.length > 0 && (
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none" aria-label="Pinned accounts">
            <p className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Pinned</p>
            <div className="mt-1 divide-y divide-slate-100 dark:divide-slate-700">
              {estate.pinned.map((row) => (
                <AccountLedgerRow key={row.id} row={row} focusKey={`pinned:${row.id}`} onClick={onOpen} sync={syncFor?.(row)} {...termsFor?.(row)} hideAmount={hidden} availability={availabilityFor?.(row)} />
              ))}
            </div>
          </section>
        )}


        {estate.groups.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500 dark:shadow-none">
            No accounts in this view
          </div>
        ) : (
          estate.groups.map((group) => {
            const isCollapsed = collapsed[group.label] ?? (group.kind === "Credit" && group.count > 4);
            return (
              <AccountGroupCard key={group.label} label={group.label} count={group.count} subtotal={group.rows.some(row => syncFor?.(row)?.kind === "new-bank") ? Number.NaN : group.subtotal} hidden={hidden} collapsed={isCollapsed} onToggle={() => onToggleGroup(group.label, isCollapsed)}>
                {group.rows.map((row) => (
                  <AccountLedgerRow key={row.id} row={row} focusKey={`group:${group.label}:${row.id}`} onClick={onOpen} sync={syncFor?.(row)} {...termsFor?.(row)} hideAmount={hidden} availability={availabilityFor?.(row)} />
                ))}
              </AccountGroupCard>
            );
          })
        )}


        {inactiveRows.length > 0 && (
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none" aria-label="Inactive accounts">
            <button
              type="button"
              onClick={() => onShowDormant(!showDormant)}
              aria-expanded={showDormant}
              className={`sticky top-0 z-10 flex min-h-16 w-full items-center justify-between gap-3 bg-white px-4 text-left transition-colors hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:bg-slate-800 dark:hover:bg-slate-700/60 dark:active:bg-slate-700 ${showDormant ? "rounded-t-2xl" : "rounded-2xl"}`}
            >
              <span>
                <span role="heading" aria-level={2} className="block text-[15px] font-bold text-slate-900 dark:text-slate-100">Inactive</span>
                <span className="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">{inactiveRows.length} {inactiveRows.length === 1 ? "account" : "accounts"}</span>
              </span>
              <ChevronDown
                size={16}
                className={`text-slate-400 dark:text-slate-500 transition-transform duration-200 motion-reduce:transition-none ${showDormant ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </button>
            <div
              inert={!showDormant}
              className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none motion-reduce:duration-0 ${
                showDormant ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
              }`}
            >
              <div
                className={`overflow-hidden rounded-b-2xl transition-opacity duration-200 motion-reduce:transition-none motion-reduce:duration-0 ${
                  showDormant ? "opacity-100" : "opacity-0"
                }`}
              >
                <div className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-700 dark:border-slate-700">
                  {inactiveRows.map((row) => (
                    <AccountLedgerRow key={row.id} row={row} focusKey={`inactive:${row.id}`} onClick={onOpen} sync={syncFor?.(row)} hideAmount={hidden} availability={availabilityFor?.(row)} />
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}
      </>
    )}
    </section>
  );
}
