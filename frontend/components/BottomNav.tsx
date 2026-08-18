"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Home, PieChart, CalendarClock, Lightbulb } from "lucide-react";
import { api, CompanionItem } from "@/lib/api";
import PennyMark from "@/components/PennyMark";
import { isPaydayWindowActive, PAYDAY_DOT_CACHE_KEY } from "@/lib/paydayWindow";

// The two pages that already fetch safeToSpend + today for their own
// purposes (Home's brief, the Penny screen itself) write-through the exact
// same boolean via writePaydayDotCache (see HomePage.tsx/PennyPage.tsx) the
// moment their own data resolves. usePaydayWindowActive skips its OWN
// self-fetch on these two routes — firing it there would just duplicate a
// request the page is making anyway, worst on /penny (the screen the dot
// points at). Every other route still self-fetches on a genuinely cold
// cache, same as before.
const PAGES_THAT_SELF_REPORT_PAYDAY = ["/", "/penny"];

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

// Penny's living dot — active exactly when the shared payday window rule
// (lib/paydayWindow.ts) says so: last 5 days before period end, or a live
// payday_plan item already exists. Mirrors the two hooks above (same 5-min
// localStorage cache pattern, computed locally per-tab) rather than reaching
// for a new shared context/global system. `skipSelfFetch` (Home/Penny only —
// see PAGES_THAT_SELF_REPORT_PAYDAY) skips the request entirely on a cold
// cache, trusting the page's own imminent write-through instead.
function usePaydayWindowActive(skipSelfFetch: boolean): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    try {
      const cached = localStorage.getItem(PAYDAY_DOT_CACHE_KEY);
      if (cached) {
        const { v, at } = JSON.parse(cached);
        setActive(v);
        if (Date.now() - at < 5 * 60_000) return;
      }
    } catch {}
    if (skipSelfFetch) return;
    Promise.all([
      api.safeToSpend().catch(() => null),
      api.getToday().catch(() => ({ status: "ok" as const, items: [] as CompanionItem[] })),
    ])
      .then(([sts, today]) => {
        const hasLivePlan = (today?.items ?? []).some((i) => i.type === "payday_plan");
        const v = isPaydayWindowActive({
          hasLivePlan,
          daysUntilPayday: sts?.status === "ok" ? sts.days_until_payday : null,
        });
        setActive(v);
        try { localStorage.setItem(PAYDAY_DOT_CACHE_KEY, JSON.stringify({ v, at: Date.now() })); } catch {}
      })
      .catch(() => {});
  }, [skipSelfFetch]);
  return active;
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
  const router = useRouter();
  const newInsights = useNewInsightCount();
  const atRisk = useAtRiskCount();
  const paydayActive = usePaydayWindowActive(PAGES_THAT_SELF_REPORT_PAYDAY.includes(pathname ?? ""));

  const activeTab = TABS.find((t) => t.href === pathname);
  const pennyActive = pathname === "/penny";

  return (
    <>
      {/* Nav scrim — sits behind the rail (z-40 vs the rail's z-50) so
          scrolling content fades into the canvas colour before it reaches
          the floating rail/Penny, instead of visibly colliding with them.
          Non-interactive: purely a backdrop fade. */}
      <div
        aria-hidden="true"
        className="nav-scrim lg:hidden fixed inset-x-0 bottom-0 z-40 h-[116px] pointer-events-none"
      />

      {/* Floating cockpit rail (Nav A) — ported from the approved
          app/design/_nav/NavPrototype.tsx (mode="full") preview. Settings
          left the bar (relocated to a top-right gear on Home); the raised
          center Penny button navigates to the full Penny destination screen
          (/penny) — brief, Payday Plan, Mirror entry, and the inline
          "Can I…?" thread all live there now; this is no longer a sheet
          launcher. */}
      <nav
        aria-label="Primary"
        className="lg:hidden fixed inset-x-0 z-50 flex justify-center"
        // Where the OS reports a real gesture-bar inset, that inset is
        // already clearance — a flat "+16px" on top of it double-pads the
        // bottom. max() picks whichever is larger: the raw inset itself
        // (rail sits directly above it) or a modest 10px float on devices
        // with no inset. CSS max() is baseline-supported (all evergreen
        // mobile browsers this app targets), so no calc() fallback needed.
        style={{ bottom: "max(env(safe-area-inset-bottom, 0px), 10px)" }}
      >
        <div className="relative w-[calc(100%-28px)] max-w-[402px]">
          {/* Raised Penny button — the ONLY place the indigo→violet gradient
              appears in this nav. Overlaps the rail's top edge. A real nav
              destination now (router.push), not a sheet trigger. Active state
              (on /penny) gets a soft indigo halo ring — same colour/alpha as
              the rail's own sliding pill indicator, so it reads as part of
              the same active-state language. The living dot mirrors the
              amber Planning dot's treatment/position, lit whenever the
              payday window (lib/paydayWindow.ts) is active. */}
          <button
            type="button"
            onClick={() => router.push("/penny")}
            aria-label="Penny"
            aria-current={pennyActive ? "page" : undefined}
            className="absolute left-1/2 -translate-x-1/2 -top-7 z-10 w-14 h-14 rounded-2xl flex items-center justify-center active:scale-95 transition-transform motion-reduce:transition-none"
            style={{
              background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
              boxShadow: pennyActive
                ? "0 4px 14px rgba(79,70,229,0.35), 0 0 0 6px rgba(79,70,229,0.18)"
                : "0 4px 14px rgba(79,70,229,0.35)",
            }}
          >
            <span className="relative flex items-center justify-center">
              <PennyMark size={22} className="text-white" />
              {paydayActive && (
                <span
                  aria-hidden="true"
                  className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full"
                  style={{ background: "#f59e0b", boxShadow: "0 0 0 1.5px rgba(79,70,229,1)" }}
                />
              )}
            </span>
          </button>

          {/* Matte rail surface */}
          <div className="glass-rail relative rounded-[22px]">
            <div className="relative grid grid-cols-5 h-[64px] px-1.5">
              {/* Sliding active indicator — soft indigo pill, transform-based.
                  Hidden off-rail (no matching tab) rather than defaulting to
                  slot 0, so non-tab routes don't falsely highlight Home.
                  Inset 6px from both rail edges (matches the container's
                  px-1.5) so the pill never sits flush against the rounded
                  rail edge when the first/last tab (Home/Insights) is
                  active — width/step are computed against that padded
                  content box, not the full rail. */}
              <span
                aria-hidden="true"
                className="absolute top-1.5 bottom-1.5 rounded-2xl transition-transform duration-200 motion-reduce:transition-none"
                style={{
                  width: "calc((100% - 12px) / 5)",
                  left: "6px",
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
    </>
  );
}
