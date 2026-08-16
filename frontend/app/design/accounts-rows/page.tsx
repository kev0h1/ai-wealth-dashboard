"use client";

// Design preview — Variant A: dense ledger-row accounts list, upgraded to a
// fully navigable estate (find bar, lens chips, pinned band, collapsible
// sticky-header groups, inactive bucket). Standalone, auth-exempt
// (/design/* — see components/AuthProvider.tsx), static mock data only.
// Not wired into the live app; see app/design/accounts-preview for the
// index of all three variants.

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, RefreshCw, Search, Star } from "lucide-react";
import { BankBadge, accountBrand } from "@/components/AccountMiniCard";
import {
  mockAccounts,
  netWorth,
  pinnedAccounts,
  liveGroupedAccounts,
  inactiveAccounts,
  type MockAccount,
} from "../_mockAccounts";

function PreviewNav() {
  return (
    <div className="glass-tile rounded-xl p-1 flex items-center gap-1 mb-4 text-[11px]">
      <span className="flex-1 min-w-0 text-center py-1.5 rounded-lg text-slate-500 font-medium truncate">Rows</span>
      <Link href="/design/accounts-tiles" className="flex-1 min-w-0 text-center py-1.5 rounded-lg text-indigo-400 font-semibold active:bg-white/10 transition-colors truncate">
        Tiles
      </Link>
      <Link href="/design/account-detail" className="flex-1 min-w-0 text-center py-1.5 rounded-lg text-indigo-400 font-semibold active:bg-white/10 transition-colors truncate">
        Detail
      </Link>
      <Link href="/design/accounts-preview" className="flex-1 min-w-0 text-center py-1.5 rounded-lg text-slate-400 font-medium active:bg-white/10 transition-colors truncate">
        Index
      </Link>
    </div>
  );
}

function moneyStr(n: number): string {
  return `£${Math.abs(Math.round(n)).toLocaleString("en-GB")}`;
}

// ── Lenses ───────────────────────────────────────────────────────────────

const LENSES = ["All", "Current", "Credit", "Savings", "Investments", "Owed"] as const;
type Lens = (typeof LENSES)[number];

function lensMatches(account: MockAccount, lens: Lens): boolean {
  switch (lens) {
    case "All":
      return true;
    case "Current":
      return account.type === "Current";
    case "Savings":
      return account.type === "Savings";
    case "Credit":
      return account.type === "Credit";
    case "Investments":
      return account.type.includes("Investment");
    case "Owed":
      return account.type === "Credit" && account.balance < 0;
  }
}

// ── Inline sparkline (investment rows) ──────────────────────────────────
// 52x20, low-opacity indigo stroke — a whisper of trend, not a chart.

function sparklinePoints(series: number[], w: number, h: number): string {
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  return series
    .map((v, i) => {
      const x = (i / (series.length - 1)) * w;
      const y = h - 2 - ((v - min) / range) * (h - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function MiniSparkline({ series }: { series: number[] }) {
  return (
    <svg width={52} height={20} viewBox="0 0 52 20" aria-hidden="true" className="block shrink-0">
      <polyline
        points={sparklinePoints(series, 52, 20)}
        fill="none"
        stroke="rgba(129,140,248,0.55)"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Utilisation bar (credit rows) ────────────────────────────────────────
// Illustrative — real card limits aren't stored yet (see the note atop the
// Credit cards group). Calm rose fill on a faint track; deepens toward
// rose at high utilisation, but no alarm theatre (Red Is Risk still holds).

function UtilisationBar({ balance, limit }: { balance: number; limit: number }) {
  const pct = Math.min(100, Math.round((Math.abs(balance) / limit) * 100));
  const heavy = pct >= 80;
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <div className="h-1 flex-1 min-w-0 rounded-full bg-white/10 overflow-hidden">
        <div
          className={`h-full rounded-full ${heavy ? "bg-rose-400/90" : "bg-rose-400/55"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 text-[10px] text-slate-500 num">
        {pct}% of £{limit.toLocaleString("en-GB")}
      </span>
    </div>
  );
}

// ── Row ──────────────────────────────────────────────────────────────────

function AccountLedgerRow({ account }: { account: MockAccount }) {
  const brand = accountBrand(account);
  const isCredit = account.type === "Credit";
  const isInvestment = account.type.includes("Investment");
  const muted = !!account.dormant;

  return (
    <button
      type="button"
      className="w-full min-h-[60px] flex items-center gap-3 px-4 py-2.5 active:bg-white/5 transition-colors text-left"
    >
      <BankBadge logoSrc={brand.logoSrc} initials={brand.initials} altText={brand.label} brandBg={brand.background} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 min-w-0">
          {account.pinned && (
            <Star size={11} className="fill-current text-amber-400 flex-shrink-0" aria-hidden="true" />
          )}
          <span className={`min-w-0 truncate text-[15px] font-semibold ${muted ? "text-slate-500" : "text-slate-100"}`}>
            {account.name}
          </span>
        </div>
        <div className={`flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12.5px] mt-0.5 ${muted ? "text-slate-600" : "text-slate-400"}`}>
          <span className="truncate">
            {account.provider} · {account.type}
          </span>
          {isCredit && account.terms && (
            <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-700/60 text-slate-400">
              {account.terms}
            </span>
          )}
        </div>
        {isCredit && account.limit != null && (
          <UtilisationBar balance={account.balance} limit={account.limit} />
        )}
        {account.disconnected && (
          <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400">
            <RefreshCw size={11} aria-hidden="true" />
            Reconnect
          </span>
        )}
      </div>

      <div className="shrink-0 flex flex-col items-end gap-1">
        {isInvestment && account.series && <MiniSparkline series={account.series} />}
        <p className={`text-[16px] font-semibold num ${isCredit ? "text-rose-400" : muted ? "text-slate-500" : "text-slate-100"}`}>
          {moneyStr(account.balance)}
        </p>
        {isCredit && <p className="text-[10px] text-slate-500 mt-0.5">owed</p>}
      </div>
    </button>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function AccountsRowsPreview() {
  const [query, setQuery] = useState("");
  const [lens, setLens] = useState<Lens>("All");
  // "Credit cards" starts collapsed — it's the biggest group (7 accounts).
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({
    "Credit cards": true,
  });
  const [inactiveOpen, setInactiveOpen] = useState(false);

  const total = netWorth(mockAccounts);
  const pinned = pinnedAccounts(mockAccounts);
  const groups = liveGroupedAccounts(mockAccounts);
  const inactive = inactiveAccounts(mockAccounts);

  const trimmedQuery = query.trim();
  const isSearching = trimmedQuery.length > 0;

  const searchResults = useMemo(() => {
    if (!isSearching) return [];
    const q = trimmedQuery.toLowerCase();
    return mockAccounts.filter(
      (a) => a.name.toLowerCase().includes(q) || a.provider.toLowerCase().includes(q)
    );
  }, [trimmedQuery, isSearching]);

  const lensedGroups = useMemo(() => {
    if (lens === "All") return groups;
    return groups
      .map((g) => {
        const filtered = g.accounts.filter((a) => lensMatches(a, lens));
        return { ...g, accounts: filtered, subtotal: filtered.reduce((s, a) => s + a.balance, 0) };
      })
      .filter((g) => g.accounts.length > 0);
  }, [groups, lens]);

  const showPinnedBand = !isSearching && lens === "All" && pinned.length > 0;

  function toggleGroup(label: string) {
    setCollapsedGroups((c) => ({ ...c, [label]: !c[label] }));
  }

  return (
    <div className="dark mx-auto w-full max-w-[430px] min-h-screen overflow-x-hidden bg-[#0f172a] px-4 pt-6 pb-10">
      <PreviewNav />

      {/* Net worth header — neutral ink regardless of sign (Red Is Risk:
          this is an aggregate summary, not a credit-account balance) */}
      <div className="mb-4">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Net worth</span>
        <p className="text-3xl font-bold num mt-1 text-slate-100">
          {total < 0 ? "-" : ""}
          {moneyStr(total)}
        </p>
      </div>

      {/* Find bar */}
      <div className="relative mb-3">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" aria-hidden="true" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find an account…"
          aria-label="Find an account"
          className="w-full min-h-[44px] rounded-xl glass-tile pl-9 pr-3 text-[14px] text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {/* Lens chips — hidden while searching (a flat filtered list already
          answers "which accounts", a lens would just add a second filter
          the user didn't ask for) */}
      {!isSearching && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 mb-4 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {LENSES.map((l) => {
            const active = lens === l;
            return (
              <button
                key={l}
                type="button"
                onClick={() => setLens(l)}
                aria-pressed={active}
                className={`shrink-0 min-h-[44px] px-3.5 rounded-full text-[13px] font-semibold transition-colors ${
                  active ? "bg-indigo-500 text-white" : "glass-tile text-slate-400 active:bg-white/10"
                }`}
              >
                {l}
              </button>
            );
          })}
        </div>
      )}

      {isSearching ? (
        <div>
          <p className="px-1 mb-1.5 text-[12px] font-medium text-slate-500">
            {searchResults.length} result{searchResults.length === 1 ? "" : "s"}
          </p>
          {searchResults.length === 0 ? (
            <div className="glass-card rounded-2xl px-4 py-10 text-center text-[13px] text-slate-500">
              No accounts match
            </div>
          ) : (
            <div className="glass-card rounded-2xl overflow-hidden">
              {searchResults.map((account, i) => (
                <div key={account.id} className={i > 0 ? "border-t border-white/5" : ""}>
                  <AccountLedgerRow account={account} />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Pinned band */}
          {showPinnedBand && (
            <div className="mb-6">
              <div className="px-1 mb-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Pinned</span>
              </div>
              <div className="glass-card rounded-2xl overflow-hidden">
                {pinned.map((account, i) => (
                  <div key={account.id} className={i > 0 ? "border-t border-white/5" : ""}>
                    <AccountLedgerRow account={account} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Collapsible grouped sections */}
          {lensedGroups.length === 0 ? (
            <div className="glass-card rounded-2xl px-4 py-10 text-center text-[13px] text-slate-500 mb-6">
              No accounts in this view
            </div>
          ) : (
            lensedGroups.map((group) => {
              const isCollapsed = !!collapsedGroups[group.label];
              return (
                <div key={group.label} className="mb-6">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.label)}
                    aria-expanded={!isCollapsed}
                    className="sticky top-0 z-10 w-full flex items-center justify-between gap-2 px-1 py-2 mb-1 bg-[#0f172a]/95 backdrop-blur-sm"
                  >
                    <span className="flex items-baseline gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      {group.label}
                      <span className="text-slate-600 font-medium normal-case">· {group.accounts.length}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="text-[11px] font-medium text-slate-400 num">
                        {group.subtotal < 0 ? "-" : ""}
                        {moneyStr(group.subtotal)}
                      </span>
                      <ChevronDown
                        size={14}
                        className={`text-slate-500 transition-transform duration-200 motion-reduce:transition-none ${isCollapsed ? "" : "rotate-180"}`}
                        aria-hidden="true"
                      />
                    </span>
                  </button>

                  {group.label === "Credit cards" && !isCollapsed && (
                    <p className="px-1 mb-1.5 text-[11px] text-slate-500 italic">
                      Utilisation shown is illustrative — pending live limit data.
                    </p>
                  )}

                  <div
                    className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none motion-reduce:duration-0 ${
                      isCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
                    }`}
                  >
                    <div
                      className={`overflow-hidden transition-opacity duration-200 motion-reduce:transition-none motion-reduce:duration-0 ${
                        isCollapsed ? "opacity-0" : "opacity-100"
                      }`}
                    >
                      <div className="glass-card rounded-2xl overflow-hidden">
                        {group.accounts.map((account, i) => (
                          <div key={account.id} className={i > 0 ? "border-t border-white/5" : ""}>
                            <AccountLedgerRow account={account} />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {/* Inactive — dormant + disconnected, collapsed by default */}
          {inactive.length > 0 && (
            <div className="mb-2">
              <button
                type="button"
                onClick={() => setInactiveOpen((o) => !o)}
                aria-expanded={inactiveOpen}
                className="sticky top-0 z-10 w-full flex items-center justify-between gap-2 px-1 py-2 mb-1 bg-[#0f172a]/95 backdrop-blur-sm"
              >
                <span className="flex items-baseline gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Inactive
                  <span className="text-slate-600 font-medium normal-case">· {inactive.length}</span>
                </span>
                <ChevronDown
                  size={14}
                  className={`text-slate-500 transition-transform duration-200 motion-reduce:transition-none ${inactiveOpen ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </button>

              <div
                className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none motion-reduce:duration-0 ${
                  inactiveOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                }`}
              >
                <div
                  className={`overflow-hidden transition-opacity duration-200 motion-reduce:transition-none motion-reduce:duration-0 ${
                    inactiveOpen ? "opacity-100" : "opacity-0"
                  }`}
                >
                  <div className="glass-card rounded-2xl overflow-hidden">
                    {inactive.map((account, i) => (
                      <div key={account.id} className={i > 0 ? "border-t border-white/5" : ""}>
                        <AccountLedgerRow account={account} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
