"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, PieChart, Settings, Target, TrendingDown, Wallet } from "lucide-react";

const TABS = [
  { href: "/", label: "Home", Icon: Home },
  { href: "/spend", label: "Spend", Icon: PieChart },
  { href: "/budget", label: "Budget", Icon: Target },
  { href: "/debt", label: "Debt", Icon: TrendingDown },
  { href: "/settings", label: "Settings", Icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex fixed top-0 left-0 h-full w-64 flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 z-40">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-6 border-b border-slate-100 dark:border-slate-800">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center flex-shrink-0">
          <Wallet size={18} color="#fff" strokeWidth={2} />
        </div>
        <div>
          <p className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-tight">Wealth</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 leading-tight">Dashboard</p>
        </div>
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {TABS.map(({ href, label, Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${
                active
                  ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400"
                  : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-300"
              }`}
            >
              <Icon
                size={18}
                strokeWidth={active ? 2.5 : 1.8}
                className="flex-shrink-0"
              />
              <span className={`text-sm font-medium ${active ? "font-semibold" : ""}`}>{label}</span>
              {active && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-500" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-slate-100 dark:border-slate-800">
        <p className="text-[10px] text-slate-300 dark:text-slate-600 text-center tracking-wide uppercase">AI Wealth Dashboard</p>
      </div>
    </aside>
  );
}
