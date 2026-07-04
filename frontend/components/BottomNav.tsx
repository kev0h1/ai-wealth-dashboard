"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, PieChart, Settings, Target, Lightbulb } from "lucide-react";

const tabs = [
  { href: "/", label: "Home", Icon: Home },
  { href: "/spend", label: "Spend", Icon: PieChart },
  { href: "/budget", label: "Budget", Icon: Target },
  { href: "/insights", label: "Insights", Icon: Lightbulb },
  { href: "/settings", label: "Settings", Icon: Settings },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 bg-white dark:bg-slate-900 z-50"
      style={{
        boxShadow: "0 -1px 0 rgba(0,0,0,0.08)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <div className="flex items-center justify-around h-16 max-w-[430px] mx-auto">
        {tabs.map(({ href, label, Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className="relative flex flex-col items-center justify-center gap-1 flex-1 h-full transition-colors"
              style={{ textDecoration: "none" }}
            >
              {active && (
                <span
                  className="nav-pill-in absolute inset-x-1.5 top-1.5 bottom-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-900/30"
                  aria-hidden="true"
                />
              )}
              <Icon
                size={22}
                strokeWidth={active ? 2.5 : 1.8}
                color={active ? "#4f46e5" : "#94a3b8"}
                className="relative"
              />
              <span
                className={`relative text-[11px] font-medium leading-none`}
                style={{ color: active ? "#4f46e5" : "#94a3b8" }}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
