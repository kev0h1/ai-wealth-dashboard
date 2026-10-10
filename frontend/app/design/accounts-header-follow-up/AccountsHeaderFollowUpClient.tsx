"use client";

// G250 follow-up to G236 variant A. Renders the PRODUCTION AccountsHeader,
// AccountLedgerRow and AccountsAddFab through their real props; only the Find
// field and the group frames are hand-authored here (the page's own markup is
// not a standalone component).
//
// Options, all tightening the header-to-search gap to the Home rhythm (G221,
// 20px between sections):
//   a  the "Balances hidden · Show" chip moves to the title row's right
//   b  Cash / Cards / Investments reading beside Net worth, chip stays below
//   c  last-synced time with a refresh control top right (KPIs carry
//      last_updated and the page already has a sync call, so it is real data)
//
// /design/accounts-header-follow-up?option=a|b|c&mode=light|dark&accounts=6|20&state=shown|hidden[&chrome=off][&open=0|1]

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Search } from "lucide-react";
import AccountsHeader from "@/components/AccountsHeader";
import AccountLedgerRow from "@/components/AccountLedgerRow";
import AccountsAddFab, { ADD_FAB_LIST_CLEARANCE } from "@/components/AccountsAddFab";
import FixtureBottomNav from "../_components/FixtureBottomNav";
import { breakdownFor, estateFor } from "./fixtures";
import { useRef } from "react";

type Option = "a" | "b" | "c";

const OPTION_NOTES: Record<Option, { title: string; line: string }> = {
  a: { title: "A  Chip to the top right", line: "Balances hidden · Show sits beside the title. Shown state leaves the right empty again, so this option only helps while hidden." },
  b: { title: "B  Breakdown beside Net worth", line: "Cash, Cards and Investments from the same rows, masked with the figure. The chip stays under the caption." },
  c: { title: "C  Last synced and refresh", line: "Updated time with a 44px refresh control top right. Uses KPIs last_updated and the page's existing sync call." },
};

export default function AccountsHeaderFollowUpClient() {
  const params = useSearchParams();
  const option: Option = (["a", "b", "c"] as const).find((o) => o === params.get("option")) ?? "a";
  const mode = params.get("mode") === "dark" ? "dark" : "light";
  const count = params.get("accounts") === "20" ? 20 : 6;
  const hidden = params.get("state") === "hidden";
  const chrome = params.get("chrome") !== "off";
  const open = params.get("open") === "1";

  const menuRef = useRef<HTMLDivElement | null>(null);
  const estate = estateFor(count);
  const href = (n: Record<string, string>) => {
    const q = new URLSearchParams({ option, mode, accounts: String(count), state: hidden ? "hidden" : "shown", ...n });
    return `?${q.toString()}`;
  };
  const pill = "inline-flex min-h-11 items-center rounded-full border px-3 text-xs";
  const on = "border-indigo-500 bg-indigo-600 text-white";
  const off = "border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-300";

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <main className={`min-h-dvh ${mode === "dark" ? "bg-[#0f172a]" : "bg-[#f0f2f7]"}`}>
        {chrome && (
          <div className="px-4 pt-3">
            <div className="flex flex-wrap gap-1.5">
              {(["a", "b", "c"] as const).map((o) => (
                <Link key={o} href={href({ option: o })} className={`${pill} ${o === option ? on : off}`}>{OPTION_NOTES[o].title}</Link>
              ))}
              <Link href={href({ accounts: count === 6 ? "20" : "6" })} className={`${pill} ${off}`}>{count === 6 ? "20 accounts" : "6 accounts"}</Link>
              <Link href={href({ state: hidden ? "shown" : "hidden" })} className={`${pill} ${off}`}>{hidden ? "Show balances" : "Hide balances"}</Link>
              <Link href={href({ mode: mode === "dark" ? "light" : "dark" })} className={`${pill} ${off}`}>{mode === "dark" ? "Light" : "Dark"}</Link>
            </div>
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{OPTION_NOTES[option].line}</p>
          </div>
        )}

        <div className={ADD_FAB_LIST_CLEARANCE} style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
          {/* The page's header wrapper, with the pb-6 swapped for the Home 20px section gap. */}
          <div className="px-4 pt-4 pb-5">
            <AccountsHeader
              netWorth={{ value: estate.netWorth, accountCount: estate.rows.length }}
              hidden={hidden}
              showChip={hidden}
              onShow={() => {}}
              tight
              chipPlacement={option === "a" ? "top" : "below"}
              breakdown={option === "b" ? breakdownFor(estate) : undefined}
              lastSynced={option === "c" ? "Updated 8 min ago" : undefined}
              onRefresh={option === "c" ? () => {} : undefined}
            />
          </div>

          <div className="space-y-5 px-4">
            <label className="glass-card flex min-h-11 items-center gap-2 rounded-2xl px-3 text-sm text-slate-600 dark:text-slate-400">
              <Search size={15} aria-hidden="true" />
              <span>Find an account</span>
            </label>
            {estate.groups.map((g) => (
              <section key={g.kind} aria-label={g.label}>
                <div className="mb-2 flex items-baseline justify-between px-1 text-xs text-slate-600 dark:text-slate-400">
                  <h2 className="font-semibold text-slate-800 dark:text-slate-200">{g.label}</h2>
                  <span className="money tabular-nums">{hidden ? "£••••" : `${g.subtotal < 0 ? "−" : ""}£${Math.abs(g.subtotal).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`}</span>
                </div>
                <div className="glass-card overflow-hidden rounded-2xl">
                  {g.rows.map((row, i) => (
                    <div key={row.id} className={i > 0 ? "border-t border-slate-100 dark:border-white/5" : ""}>
                      <AccountLedgerRow row={row} hideAmount={hidden} />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>

        <AccountsAddFab
          open={open}
          onToggle={() => {}}
          onClose={() => {}}
          menuRef={menuRef}
          suppressed={false}
          menuItems={<div className="px-4 py-3 text-sm text-slate-700 dark:text-slate-200">Add Bank</div>}
        />
        <FixtureBottomNav />
      </main>
    </div>
  );
}
