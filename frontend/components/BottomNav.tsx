"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Home, PieChart, Settings, Target, Lightbulb } from "lucide-react";
import { api } from "@/lib/api";

// Ambient awareness: a quiet count of new insights on the tab icon.
// Cached 5 minutes so navigating between pages doesn't hammer the API.
// State badge (not seen-clearable): bills due in 7 days their account can't cover
function useAtRiskCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    try {
      const cached = localStorage.getItem("wd_spend_badge");
      if (cached) {
        const { n, at } = JSON.parse(cached);
        setCount(n);
        if (Date.now() - at < 5 * 60_000) return;
      }
    } catch {}
    api.atRiskCount()
      .then(({ count: n }) => {
        setCount(n);
        try { localStorage.setItem("wd_spend_badge", JSON.stringify({ n, at: Date.now() })); } catch {}
      })
      .catch(() => {});
  }, []);
  return count;
}

function useNewInsightCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    try {
      const cached = localStorage.getItem("wd_insight_badge");
      if (cached) {
        const { n, at } = JSON.parse(cached);
        setCount(n);
        if (Date.now() - at < 5 * 60_000) return;
      }
    } catch {}
    api.newInsightCount()
      .then(({ count: n }) => {
        setCount(n);
        try { localStorage.setItem("wd_insight_badge", JSON.stringify({ n, at: Date.now() })); } catch {}
      })
      .catch(() => {});
  }, []);
  return count;
}

const tabs = [
  { href: "/", label: "Home", Icon: Home },
  { href: "/spend", label: "Spend", Icon: PieChart },
  { href: "/budget", label: "Budget", Icon: Target },
  { href: "/insights", label: "Insights", Icon: Lightbulb },
  { href: "/settings", label: "Settings", Icon: Settings },
];

export default function BottomNav() {
  const pathname = usePathname();
  const newInsights = useNewInsightCount();
  const atRisk = useAtRiskCount();

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
              <span className="relative">
                <Icon
                  size={22}
                  strokeWidth={active ? 2.5 : 1.8}
                  color={active ? "#4f46e5" : "#94a3b8"}
                />
                {href === "/insights" && newInsights > 0 && (
                  <span className="absolute -top-1 -right-2 min-w-[15px] h-[15px] px-0.5 rounded-full bg-violet-500 text-white text-[9px] font-bold flex items-center justify-center">
                    {newInsights}
                  </span>
                )}
                {href === "/spend" && atRisk > 0 && (
                  <span className="absolute -top-1 -right-2 min-w-[15px] h-[15px] px-0.5 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
                    {atRisk}
                  </span>
                )}
              </span>
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
