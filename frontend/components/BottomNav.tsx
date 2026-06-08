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
      className="lg:hidden fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] z-50 safe-bottom"
      style={{ height: "calc(64px + env(safe-area-inset-bottom, 0px))" }}
    >
      <div className="flex items-center justify-around h-16">
        {tabs.map(({ href, label, Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className="flex flex-col items-center justify-center gap-1 flex-1 h-full transition-colors"
              style={{ textDecoration: "none" }}
            >
              <Icon
                size={tabs.length > 5 ? 19 : 22}
                strokeWidth={active ? 2.5 : 1.8}
                color={active ? "#4f46e5" : "#94a3b8"}
              />
              <span
                className={`${tabs.length > 5 ? "text-[10px]" : "text-[11px]"} font-medium leading-none`}
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
