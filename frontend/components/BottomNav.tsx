"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Home, PieChart, CalendarClock, Target } from "lucide-react";
import { api } from "@/lib/api";
import PennyMark from "@/components/PennyMark";
import { PAYDAY_DOT_CACHE_KEY } from "@/lib/paydayWindow";
import { usePennySheet, type PennyAskContext } from "@/components/PennySheetProvider";

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

// Penny's living dot — active exactly when the shared payday window rule
// (lib/paydayWindow.ts) says so: last 5 days before period end, or a live
// payday_plan item already exists.
//
// This hook never fetches for itself, on ANY route. Home and Penny already
// fetch safeToSpend + getToday for their own purposes (the brief, the
// screen itself) and write the result through via writePaydayDotCache the
// moment it resolves (see HomePage.tsx/PennyPage.tsx) — this hook just
// reads that localStorage cache on mount, at whatever age it finds it, and
// stops there. It used to also fire its own copy of the same two requests
// on every OTHER route once that cache had gone stale (past its 5-minute
// freshness window) — a genuinely cold or 5-minutes-old cache on
// Spend/Upcoming/Planning/Settings/etc. silently cost a `safeToSpend` +
// `getToday` round trip on every one of THOSE pages' own loads, paid on top
// of whatever those pages were already fetching for themselves. Removed:
// the dot is not worth a network request of its own anywhere. A cache
// that's stale or missing here just means the dot stays off (or shows its
// last known value) until the user's next Home or Penny visit writes a
// fresh one — it self-corrects within one navigation either way.
function usePaydayWindowActive(): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    try {
      const cached = localStorage.getItem(PAYDAY_DOT_CACHE_KEY);
      if (cached) {
        const { v } = JSON.parse(cached);
        setActive(v);
      }
    } catch {}
  }, []);
  return active;
}

// Maps the current route to the sheet's `screen` context (PennySheetProvider.tsx)
// so the conversation knows roughly what the user was looking at when they
// opened it from the nav, without any page having to call `open()` itself.
// "tax" is never produced here — that value is for TaxPennyEntry.tsx's own
// entry point, a different door into the same sheet.
// Exported (2026-08-25) so Sidebar.tsx's desktop Penny trigger can derive
// the same screen context from the same pathname, rather than duplicating
// this switch — one source of truth for "which route means which screen"
// shared by both the mobile rail and the desktop rail.
export function screenForPathname(pathname: string | null): PennyAskContext["screen"] {
  switch (pathname) {
    case "/": return "home";
    case "/spend": return "spend";
    // /spend/shape is a drill-in page (like /transactions) with no
    // BottomNav instance of its own — this case only matters to Sidebar.tsx's
    // desktop Penny trigger, which derives its screen context from the
    // current pathname regardless of whether BottomNav itself is mounted.
    case "/spend/shape": return "spend";
    case "/upcoming": return "upcoming";
    case "/planning": return "planning";
    // /insights is retired to a client redirect (-> /spend/shape or /tax)
    // that never renders this BottomNav, so this case is now unreachable in
    // practice — removed rather than kept inert, unlike "/grow" below,
    // because nothing still needs "insights" as a producible screen value
    // from a real route (see pennyScreenConfig.tsx's own comment on why the
    // "insights" screen KEY still exists for the design twin).
    // "grow" stays a producible value here even though Grow folded into
    // Planning 2026-09-04 (see PennySheetProvider.tsx's `PennyAskContext`
    // comment) — /grow is now a client redirect that never renders this
    // BottomNav, so this case is inert in practice, kept only so the
    // switch's return type keeps agreeing with the union.
    case "/grow": return "grow";
    // Was "/debt-plan" (DebtPlanPage.tsx rendered this BottomNav itself)
    // until that page was retired 2026-08-30 — CardsPage.tsx (/cards) is
    // its successor and renders this BottomNav too, so the "debt" screen
    // context (lib/pennyScreenConfig.tsx's `debt` entry) now keys off it
    // instead.
    case "/cards": return "debt";
    // Added 2026-08-26, once PennySheetProvider.tsx's `PennyAskContext["screen"]`
    // union gained "accounts" — lib/pennyScreenConfig.tsx already had a real
    // `accounts` config entry (chips, header links) waiting on exactly this.
    case "/accounts": return "accounts";
    // "tax" is never produced here — that value is for TaxPennyEntry.tsx's
    // own entry point, a different door into the same sheet. /tax and
    // /receipts (retired from under /insights 2026-09-05, now their own
    // top-level routes) don't render BottomNav themselves, so they fall to
    // "other" like any other sub-route without its own nav instance.
    default: return "other";
  }
}

// 4 real tabs. Slot indices leave slot 2 (of 5) empty as the spacer the
// raised Penny button floats over — mirrors app/design/_nav/NavPrototype.tsx.
type TabId = "home" | "spend" | "upcoming" | "planning";
const TABS: { id: TabId; href: string; label: string; Icon: typeof Home; slot: number }[] = [
  { id: "home", href: "/", label: "Home", Icon: Home, slot: 0 },
  // A primary-nav tap is an explicit return to the transaction/category
  // breakdown, never a restoration of the optional Patterns view.
  { id: "spend", href: "/spend?view=period", label: "Spend", Icon: PieChart, slot: 1 },
  { id: "upcoming", href: "/upcoming", label: "Upcoming", Icon: CalendarClock, slot: 3 },
  { id: "planning", href: "/planning", label: "Planning", Icon: Target, slot: 4 },
];

export default function BottomNav() {
  const pathname = usePathname();
  const { open: openPennySheet, close: closePennySheet, isOpen: pennySheetOpen } = usePennySheet();
  const atRisk = useAtRiskCount();
  const paydayActive = usePaydayWindowActive();

  const activeTab = TABS.find((t) => t.id === "spend" ? pathname === "/spend" : t.href === pathname);
  // Halo state: lit either on the /penny hub route itself, or while the
  // floating chat window (PennySheetProvider.tsx) is open — the button
  // is what the window visually "came out of" (PennySheet.tsx's header
  // comment), so it should read as pressed/active for as long as that's
  // true, not just while the user is on the hub page underneath it.
  const pennyActive = pathname === "/penny" || pennySheetOpen;

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
          left the bar (relocated to a top-right gear on Home). The raised
          center Penny button WAS a plain `router.push("/penny")` navigation
          for a while (moving Penny's conversation to a full-page
          destination); it is a sheet launcher again, opening
          PennySheetProvider's bottom sheet over whatever screen the user is
          already on, per the 2026-08 decision that a full-page destination
          made the conversation feel like a chore to reach. `/penny` itself
          survives, now reached only from a link inside the sheet (brief,
          Payday Plan, Mirror entry, and the "cleared from Home" archive
          still live there — non-conversational content the sheet doesn't
          try to replace). If you're reading this because the button looks
          like it's navigating again: it isn't meant to, check
          PennySheetProvider.tsx first. */}
      <nav
        data-tutorial-id="tutorial-bottom-nav"
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
              appears in this nav. Overlaps the rail's top edge. Opens/closes
              the Penny window (usePennySheet, PennySheetProvider.tsx) —
              now a floating popover anchored to this button rather than an
              edge-to-edge sheet (PennySheet.tsx's header comment) — over
              whatever screen is underneath, rather than navigating; tapping
              it a second time while the window is open closes it (same
              button doubles as trigger and close control, 2026-08-25 owner
              redesign). The halo (`pennyActive`, below) lights on the
              /penny hub route OR while the window is open, since the
              button is what the window visually emerged from — a soft
              indigo halo ring, same colour/alpha as the rail's own sliding
              pill indicator, so it reads as part of the same active-state
              language. The living dot mirrors the amber
              Planning dot's treatment/position, lit whenever the payday
              window (lib/paydayWindow.ts) is active. It used to also be
              handed into `open()` as `paydayActive: true` so the sheet could
              inject a deterministic lead bubble on open — removed
              (2026-08-25, owner: that bubble duplicated the Safe-to-Spend
              hero already on Home, see PennyConversation.tsx's own comment
              at the thread's former lead-bubble slot for the full history).
              The dot's promise is now redeemed inside the sheet itself, via
              the payday chip in its chip row and the header's "Your plan
              and updates" link (PennySheet.tsx), not by data forwarded at
              open time — so `open()` here no longer takes a payday payload
              at all. */}
          <button
            type="button"
            // Toggle, not just launch — the owner's floating-window redesign
            // (PennySheet.tsx) makes the button double as the window's own
            // close control when it's already open, matching how a real
            // popover trigger behaves. `aria-current="page"` stays tied to
            // the actual route (not the window's open state, which is a
            // transient overlay, not a page) — `aria-pressed` is the correct
            // ARIA role for the toggle behaviour instead.
            onClick={() => (pennySheetOpen ? closePennySheet() : openPennySheet({ screen: screenForPathname(pathname) }))}
            aria-label="Penny"
            aria-current={pathname === "/penny" ? "page" : undefined}
            aria-pressed={pennySheetOpen}
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
                      {/* Bills-at-risk belongs to the near-term Upcoming
                          surface, not the long-term plan. */}
                      {tab.id === "upcoming" && atRisk > 0 && (
                        <span
                          aria-hidden="true"
                          className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full"
                          style={{ background: "#f59e0b" }}
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
