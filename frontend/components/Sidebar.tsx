"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Home, PieChart, Settings, CalendarClock, Lightbulb } from "lucide-react";

const TABS = [
  { href: "/", label: "Home", Icon: Home },
  { href: "/spend", label: "Spend", Icon: PieChart },
  { href: "/planning", label: "Planning", Icon: CalendarClock },
  { href: "/insights", label: "Insights", Icon: Lightbulb },
  { href: "/settings", label: "Settings", Icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex fixed top-0 left-0 h-full w-64 flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 z-40">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-6 border-b border-slate-100 dark:border-slate-800">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden">
          <Image src="/icons/icon-192.png" alt="Sorted" width={36} height={36} className="w-full h-full object-cover" />
        </div>
        <div>
          <p className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-tight">Sorted</p>
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

    </aside>
  );
}
