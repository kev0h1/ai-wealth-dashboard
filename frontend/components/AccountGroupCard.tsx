"use client";

// G282: one account-group card (sticky header with the group name, count and
// subtotal, then the rows), extracted from AccountsPage so the design preview
// renders the production card. Markup unchanged. See AccountsPage for why the
// section carries no overflow-hidden (sticky header).

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export interface AccountGroupCardProps {
  label: string;
  count: number;
  subtotal: number;
  hidden: boolean;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export default function AccountGroupCard({ label, count, subtotal, hidden, collapsed, onToggle, children }: AccountGroupCardProps) {
  return (
    <section
      className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none"
      aria-label={`${label} accounts`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className={`sticky top-0 z-10 flex min-h-16 w-full items-center justify-between gap-3 bg-white px-4 text-left transition-colors hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:bg-slate-800 dark:hover:bg-slate-700/60 dark:active:bg-slate-700 ${collapsed ? "rounded-2xl" : "rounded-t-2xl"}`}
      >
        <span>
          <span role="heading" aria-level={2} className="block text-[15px] font-bold text-slate-900 dark:text-slate-100">{label}</span>
          <span className="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">{count} {count === 1 ? "account" : "accounts"}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="money text-[14px] font-semibold text-slate-800 dark:text-slate-200">
            {hidden
              ? "£••••"
              : `${subtotal < 0 ? "-" : ""}£${Math.abs(Math.round(subtotal)).toLocaleString("en-GB")}`}
          </span>
          <ChevronDown
            size={16}
            className={`text-slate-400 dark:text-slate-500 transition-transform duration-200 motion-reduce:transition-none ${collapsed ? "" : "rotate-180"}`}
            aria-hidden="true"
          />
        </span>
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none motion-reduce:duration-0 ${
          collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
        }`}
      >
        <div
          className={`overflow-hidden rounded-b-2xl transition-opacity duration-200 motion-reduce:transition-none motion-reduce:duration-0 ${
            collapsed ? "opacity-0" : "opacity-100"
          }`}
        >
          <div className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-700 dark:border-slate-700">
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}
