"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, PieChart, Settings, Target, TrendingDown, Lightbulb } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";

const BASE_TABS = [
  { href: "/", label: "Home", Icon: Home },
  { href: "/spend", label: "Spend", Icon: PieChart },
  { href: "/budget", label: "Budget", Icon: Target },
  { href: "/debt", label: "Debt", Icon: TrendingDown },
  { href: "/settings", label: "Settings", Icon: Settings },
];

const KEVIN_EMAIL = "kevin.maingi12@gmail.com";

export default function BottomNav() {
  const pathname = usePathname();
  const { user } = useAuth();

  const tabs = user?.email === KEVIN_EMAIL
    ? [
        BASE_TABS[0],
        BASE_TABS[1],
        BASE_TABS[2],
        BASE_TABS[3],
        { href: "/insights", label: "Insights", Icon: Lightbulb },
        BASE_TABS[4],
      ]
    : BASE_TABS;

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
                size={tabs.length > 5 ? 19 : 22}
                strokeWidth={active ? 2.5 : 1.8}
                color={active ? "#4f46e5" : "#94a3b8"}
                className="relative"
              />
              <span
                className={`relative ${tabs.length > 5 ? "text-[10px]" : "text-[11px]"} font-medium leading-none`}
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
