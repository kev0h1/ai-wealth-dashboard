"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Home, PieChart, CalendarClock, Lightbulb, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import CanISection from "@/components/CanISection";

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

// 4 real tabs. Slot indices leave slot 2 (of 5) empty as the spacer the
// raised Penny button floats over — mirrors app/design/_nav/NavPrototype.tsx.
type TabId = "home" | "spend" | "planning" | "insights";
const TABS: { id: TabId; href: string; label: string; Icon: typeof Home; slot: number }[] = [
  { id: "home", href: "/", label: "Home", Icon: Home, slot: 0 },
  { id: "spend", href: "/spend", label: "Spend", Icon: PieChart, slot: 1 },
  { id: "planning", href: "/planning", label: "Planning", Icon: CalendarClock, slot: 3 },
  { id: "insights", href: "/insights", label: "Insights", Icon: Lightbulb, slot: 4 },
];

export default function BottomNav() {
  const pathname = usePathname();
  const newInsights = useNewInsightCount();
  const atRisk = useAtRiskCount();
  const [pennyOpen, setPennyOpen] = useState(false);

  const activeTab = TABS.find((t) => t.href === pathname);

  return (
    <>
      {/* Nav scrim — sits behind the rail (z-40 vs the rail's z-50) so
          scrolling content fades into the canvas colour before it reaches
          the floating rail/Penny, instead of visibly colliding with them.
          Non-interactive: purely a backdrop fade. */}
      <div
        aria-hidden="true"
        className="nav-scrim lg:hidden fixed inset-x-0 bottom-0 z-40 h-[140px] pointer-events-none"
      />

      {/* Floating cockpit rail (Nav A) — ported from the approved
          app/design/_nav/NavPrototype.tsx (mode="full") preview. Settings
          left the bar (relocated to a top-right gear on Home); the raised
          center Penny button opens the same "Can I…?" sheet used on
          Planning, everywhere, via CanISection's headless/controlled mode. */}
      <nav
        aria-label="Primary"
        className="lg:hidden fixed inset-x-0 z-50 flex justify-center"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
      >
        <div className="relative w-[calc(100%-28px)] max-w-[402px]">
          {/* Raised Penny button — the ONLY place the indigo→violet gradient
              appears in this nav. Overlaps the rail's top edge. Not a Link:
              opens the Can-I sheet in place rather than navigating. */}
          <button
            type="button"
            onClick={() => setPennyOpen(true)}
            aria-label="Ask Penny — Can I…?"
            className="absolute left-1/2 -translate-x-1/2 -top-7 z-10 w-14 h-14 rounded-2xl flex items-center justify-center active:scale-95 transition-transform motion-reduce:transition-none"
            style={{
              background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
              boxShadow: "0 4px 14px rgba(79,70,229,0.35)",
            }}
          >
            <Sparkles size={22} className="text-white" strokeWidth={2} />
          </button>

          {/* Matte rail surface */}
          <div className="glass-rail relative rounded-[22px]">
            <div className="relative grid grid-cols-5 h-[64px] px-1">
              {/* Sliding active indicator — soft indigo pill, transform-based.
                  Hidden off-rail (no matching tab) rather than defaulting to
                  slot 0, so non-tab routes don't falsely highlight Home. */}
              <span
                aria-hidden="true"
                className="absolute top-1.5 bottom-1.5 rounded-2xl transition-transform duration-200 motion-reduce:transition-none"
                style={{
                  width: "20%",
                  left: 0,
                  transform: `translateX(${(activeTab?.slot ?? -2) * 100}%)`,
                  transitionTimingFunction: "var(--ease-out)",
                  background: "rgba(79, 70, 229, 0.18)",
                }}
              />

              {TABS.map((tab) => {
                const isActive = tab.id === activeTab?.id;
                return (
                  <Link
                    key={tab.id}
                    href={tab.href}
                    aria-current={isActive ? "page" : undefined}
                    style={{ gridColumnStart: tab.slot + 1 }}
                    className="relative z-10 flex flex-col items-center justify-center gap-0.5 active:scale-95 transition-transform motion-reduce:transition-none"
                  >
                    <span className="relative flex items-center justify-center">
                      <tab.Icon
                        size={22}
                        strokeWidth={isActive ? 2.5 : 1.8}
                        className={isActive ? "text-indigo-600 dark:text-indigo-400" : "text-slate-500 dark:text-slate-400"}
                      />
                      {/* Living dots — calm ambient state, not counts. Amber on
                          Planning (bills at risk), violet on Insights (new
                          reads) so the only bright colour on the rail stays
                          Penny's indigo→violet + this restrained pair. */}
                      {tab.id === "planning" && atRisk > 0 && (
                        <span
                          aria-hidden="true"
                          className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full"
                          style={{ background: "#f59e0b" }}
                        />
                      )}
                      {tab.id === "insights" && newInsights > 0 && (
                        <span
                          aria-hidden="true"
                          className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-violet-500"
                        />
                      )}
                    </span>
                    <span
                      className={`text-[11px] leading-none font-medium ${
                        isActive ? "text-indigo-600 dark:text-indigo-400" : "text-slate-500 dark:text-slate-400"
                      }`}
                    >
                      {tab.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </nav>

      {/* Headless Can-I sheet — hidden launcher, driven entirely by the Penny
          button above via controlledOpen/onControlledClose. Reuses the exact
          same component (and its offer → CommitmentSheet round-trip) as the
          Planning page launcher; no freeHint here since there's no runway
          figure to restate globally. */}
      <CanISection hideLauncher controlledOpen={pennyOpen} onControlledClose={() => setPennyOpen(false)} />
    </>
  );
}
