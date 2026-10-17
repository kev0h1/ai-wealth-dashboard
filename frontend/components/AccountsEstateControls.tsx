"use client";

// G282: the Accounts find bar and lens chips, extracted from AccountsPage so the
// design preview renders the production controls. Same markup as before; the
// gap between them is the Accounts group gap (space-y-3 on the parent), see
// DESIGN.md "Page Rhythm".

import { Search } from "lucide-react";
import type { EstateLens } from "@/lib/accountsEstate";

const LENSES = ["All", "Current", "Savings", "Credit", "Investment", "Owed"] as const;

export default function AccountsEstateControls({ query, onQuery, lens, onLens }: { query: string; onQuery: (q: string) => void; lens: EstateLens; onLens: (l: EstateLens) => void }) {
  return (
    <>
    <div className="relative">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none" aria-hidden="true" />
      <input
        type="text"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Find an account…"
        aria-label="Find an account"
        className="w-full min-h-[44px] rounded-xl glass-tile pl-9 pr-3 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </div>


    <div className="flex items-center gap-1.5 overflow-x-auto -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {LENSES.map((l) => {
        const active = lens === l;
        return (
          <button
            key={l}
            type="button"
            onClick={() => onLens(l)}
            aria-pressed={active}
            className={`shrink-0 min-h-[44px] px-3.5 rounded-full text-[13px] font-semibold transition-colors ${
              active
                ? "bg-indigo-500 text-white"
                : "glass-tile text-slate-500 dark:text-slate-400 active:bg-slate-100 dark:active:bg-white/10"
            }`}
          >
            {l}
          </button>
        );
      })}
    </div>
    </>
  );
}
