"use client";

// Design preview — redesigned account-detail view as a mini statement:
// balance-forward header, no dead/empty zones, Transactions + Categories
// tabs. Standalone, auth-exempt (/design/* — see components/AuthProvider.tsx),
// static mock data only. See app/design/accounts-preview for the index.

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, RefreshCw, Trash2, Search } from "lucide-react";
import { BankBadge, accountBrand } from "@/components/AccountMiniCard";
import TransactionRow from "@/components/TransactionRow";
import SegmentedControl from "@/components/SegmentedControl";
import { getCategoryColour } from "@/lib/categories";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { detailAccount, detailCategories, detailTransactions } from "../_mockAccounts";

function PreviewNav() {
  return (
    <div className="glass-tile rounded-xl p-1 flex items-center gap-1 mb-4 text-[11px]">
      <Link href="/design/accounts-rows" className="flex-1 min-w-0 text-center py-1.5 rounded-lg text-indigo-400 font-semibold active:bg-white/10 transition-colors truncate">
        Rows
      </Link>
      <Link href="/design/accounts-tiles" className="flex-1 min-w-0 text-center py-1.5 rounded-lg text-indigo-400 font-semibold active:bg-white/10 transition-colors truncate">
        Tiles
      </Link>
      <span className="flex-1 min-w-0 text-center py-1.5 rounded-lg text-slate-500 font-medium truncate">Detail</span>
      <Link href="/design/accounts-preview" className="flex-1 min-w-0 text-center py-1.5 rounded-lg text-slate-400 font-medium active:bg-white/10 transition-colors truncate">
        Index
      </Link>
    </div>
  );
}

const fmt = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

// ── Replicated locally from components/SpendVerdictView.tsx (IconChip,
//    PaceBar are not exported there — project convention is to re-implement
//    small primitives rather than export new things from a live file). ──────

function paceGeometry(spent: number, usualByNow: number) {
  const total = Math.max(spent, usualByNow, 1) * 1.15;
  const tickPct = Math.min(100, (usualByNow / total) * 100);
  const slateFillPct = (Math.min(spent, usualByNow) / total) * 100;
  const amberFillPct = (Math.max(0, spent - usualByNow) / total) * 100;
  return { tickPct, slateFillPct, amberFillPct };
}

function PaceBar({ spent, usualByNow }: { spent: number; usualByNow: number }) {
  const { tickPct, slateFillPct, amberFillPct } = paceGeometry(spent, usualByNow);
  return (
    <div className="relative h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
      <div className="absolute inset-y-0 left-0 rounded-full bg-slate-400 dark:bg-slate-500" style={{ width: `${slateFillPct}%` }} />
      <div className="absolute inset-y-0 rounded-full bg-amber-500" style={{ left: `${slateFillPct}%`, width: `${amberFillPct}%` }} />
      <div className="absolute top-0 bottom-0 w-px bg-slate-500 dark:bg-slate-300" style={{ left: `${tickPct}%` }} />
    </div>
  );
}

function IconChip({ name, size = 36 }: { name: string; size?: number }) {
  const colour = getCategoryColour(name, {});
  const Icon = getCategoryIcon(name, {});
  return (
    <span className="rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${colour}26`, width: size, height: size }}>
      <Icon size={size >= 32 ? 16 : 13} style={{ color: colour }} />
    </span>
  );
}

// Illustrative "usual by now" figures — purely for demonstrating the PaceBar's
// full visual grammar (Bills and Debt both show a small amber overage sliver;
// Transfer stays under, no overage).
const USUAL_BY_NOW: Record<string, number> = {
  Bills: 4850,
  Transfer: 260,
  Debt: 190,
};

export default function AccountDetailPreview() {
  const [tab, setTab] = useState("Transactions");
  const [query, setQuery] = useState("");
  const brand = accountBrand(detailAccount);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return detailTransactions;
    return detailTransactions.filter((t) =>
      (t.merchant_name || t.description || "").toLowerCase().includes(q)
    );
  }, [query]);

  return (
    <div className="dark mx-auto w-full max-w-[430px] min-h-screen overflow-x-hidden bg-[#0f172a] px-4 pt-6 pb-10">
      <PreviewNav />

      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <Link href="/design/accounts-rows" className="flex items-center gap-1 text-slate-300 text-sm font-medium active:opacity-70 transition-opacity shrink-0">
          <ChevronLeft size={16} aria-hidden="true" />
          Accounts
        </Link>
        <div className="flex items-center gap-1.5 shrink-0">
          <button type="button" className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-white/[0.06] text-slate-300 active:bg-white/10 transition-colors min-h-[44px]">
            <RefreshCw size={11} aria-hidden="true" />
            Reconnect
          </button>
          <button type="button" className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-rose-500/10 text-rose-400 active:bg-rose-500/20 transition-colors min-h-[44px]">
            <Trash2 size={11} aria-hidden="true" />
            Remove
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-3">
        <BankBadge logoSrc={brand.logoSrc} initials={brand.initials} altText={brand.label} brandBg={brand.background} />
        <span className="text-base font-semibold text-slate-100">{detailAccount.name}</span>
      </div>

      <p className="text-4xl font-bold num text-slate-100">£160.41</p>
      <p className="mt-1 text-[13px] text-slate-400">Current · HSBC</p>
      <p className="mt-0.5 text-[11px] text-slate-500">Updated today</p>

      <div className="mt-4 border-t border-white/8" />
      <p className="mt-3 text-[12px] text-slate-400">This period · £5,520 out · £130 in</p>

      <div className="mt-4">
        <SegmentedControl options={["Transactions", "Categories"]} value={tab} onChange={setTab} ariaLabel="Account detail view" />
      </div>

      {tab === "Transactions" ? (
        <div className="mt-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search transactions…"
              className="w-full pl-9 pr-9 py-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
            />
          </div>

          <div className="mt-3 glass-card-flat rounded-2xl divide-y divide-white/5 overflow-hidden">
            {filtered.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-400">No transactions match &ldquo;{query}&rdquo;.</p>
            ) : (
              filtered.map((txn) => <TransactionRow transaction={txn} key={txn.id} />)
            )}
          </div>

          <p className="mt-2 text-[11px] text-slate-500 px-1">
            Tapping a row opens it in the transactions hub — in the real build this reuses the global search + teaching sheet.
          </p>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-3">
          {detailCategories.map((cat) => (
            <div key={cat.name} className="glass-card-flat rounded-2xl p-4">
              <div className="flex items-center gap-2">
                <IconChip name={cat.name} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-100 truncate">{cat.name}</p>
                  <p className="text-[11px] text-slate-400">{cat.count} txns</p>
                </div>
              </div>
              <p className="mt-2 text-xl font-bold num text-slate-100">{fmt(cat.total)}</p>
              <div className="mt-2">
                <PaceBar spent={cat.total} usualByNow={USUAL_BY_NOW[cat.name] ?? cat.total} />
              </div>
              <Link
                href={`/transactions?category=${encodeURIComponent(cat.name)}`}
                className="mt-2 inline-block text-[13px] font-semibold text-indigo-400 active:opacity-70 transition-opacity min-h-[44px] leading-[44px]"
              >
                See the {cat.count} payments &rsaquo;
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
