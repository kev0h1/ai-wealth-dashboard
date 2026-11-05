"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import BottomNavRail from "@/components/navigation/BottomNavRail";
import { BOTTOM_NAV_TABS as TABS } from "@/lib/navigation/bottomNav";
import { usePreferences } from "@/components/PreferencesContext";
import { PAYDAY_DOT_CACHE_KEY } from "@/lib/paydayWindow";
import { usePennySheet, type PennyAskContext } from "@/components/PennySheetProvider";
import { isNavExemptPath } from "@/lib/navExemptRoutes";

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
// Exported (2026-08-25) so Sidebar.tsx's desktop Penny trigger can derive
// the same screen context from the same pathname, rather than duplicating
// this switch — one source of truth for "which route means which screen"
// shared by both the mobile rail and the desktop rail.
export function screenForPathname(pathname: string | null): PennyAskContext["screen"] {
  switch (pathname) {
    case "/": return "home";
    case "/spend": return "spend";
    // /spend/shape is a drill-in page (like /transactions). It used to have
    // no BottomNav instance of its own, which is exactly the gap G79 closed
    // (see lib/navExemptRoutes.ts): BottomNav is now mounted once, globally,
    // in app/layout.tsx, so this mapping also drives the mobile rail on
    // this route, not just Sidebar.tsx's desktop Penny trigger.
    case "/spend/shape": return "spend";
    case "/upcoming": return "upcoming";
    case "/planning": return "planning";
    case "/tax": return "tax";
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
    // its successor, so the "debt" screen context (lib/pennyScreenConfig.tsx's
    // `debt` entry) now keys off it instead. Since G79, CardsPage.tsx no
    // longer renders BottomNav itself either; it gets the rail from
    // app/layout.tsx's single global mount like every other non-exempt route.
    case "/cards": return "debt";
    // Added 2026-08-26, once PennySheetProvider.tsx's `PennyAskContext["screen"]`
    // union gained "accounts" — lib/pennyScreenConfig.tsx already had a real
    // `accounts` config entry (chips, header links) waiting on exactly this.
    case "/accounts": return "accounts";
    // /receipts (retired from under /insights 2026-09-05) has no dedicated
    // Penny context, so it falls to "other" like any unrecognised sub-route.
    default: return "other";
  }
}

export default function BottomNav() {
  const { pennyAppearance, pennyAppearanceResolved } = usePreferences();
  const pathname = usePathname();
  const { open: openPennySheet, close: closePennySheet, isOpen: pennySheetOpen } = usePennySheet();
  const atRisk = useAtRiskCount();
  const paydayActive = usePaydayWindowActive();

  const activeTab = TABS.find((t) => t.id === "spend" ? pathname === "/spend" : t.href === pathname);
  // Active either on the /penny hub route itself, or while the
  // floating chat window (PennySheetProvider.tsx) is open — the button
  // is what the window visually "came out of" (PennySheet.tsx's header
  // comment), so it should read as pressed/active for as long as that's
  // true, not just while the user is on the hub page underneath it.
  const pennyActive = pathname === "/penny" || pennySheetOpen;

  // G79: BottomNav is now mounted once, globally, in app/layout.tsx (a
  // sibling of components/Sidebar.tsx) rather than per-page — every route
  // gets it by default. The ONLY way a route can be without it is by
  // matching lib/navExemptRoutes.ts, the single named, reasoned exemption
  // list (also read by scripts/check-nav-coverage.mjs so a silent,
  // undocumented exemption fails session-finish). Do not add a second,
  // ad hoc `pathname === ...` early return here — every exemption belongs
  // in that one file, not scattered through this component.
  if (isNavExemptPath(pathname)) return null;

  return <BottomNavRail
    appearance={pennyAppearance}
    resolved={pennyAppearanceResolved}
    activeTab={activeTab?.id}
    pennyActive={pennyActive}
    pennyOpen={pennySheetOpen}
    pennyCurrent={pathname === "/penny"}
    paydayActive={paydayActive}
    atRiskCount={atRisk}
    onPennyClick={() => (pennySheetOpen ? closePennySheet() : openPennySheet({ screen: screenForPathname(pathname) }))}
  />;
}
