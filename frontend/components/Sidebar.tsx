"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, PieChart, Settings, CalendarClock, Target } from "lucide-react";
import PennyMark from "@/components/PennyMark";
import { BRAND_GRADIENT } from "@/lib/brand";
import { usePennySheet } from "@/components/PennySheetProvider";
import { screenForPathname } from "@/components/BottomNav";

const TABS = [
  { href: "/", matchPath: "/", label: "Home", Icon: Home },
  { href: "/spend?view=period", matchPath: "/spend", label: "Spend", Icon: PieChart },
  { href: "/upcoming", matchPath: "/upcoming", label: "Upcoming", Icon: CalendarClock },
  { href: "/planning", matchPath: "/planning", label: "Planning", Icon: Target },
  { href: "/settings", matchPath: "/settings", label: "Settings", Icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  // Desktop's own door into the Penny sheet — BottomNav.tsx (the mobile
  // rail with the raised gradient button that opens it there) is
  // `lg:hidden`, so without this, in-page callers that still fire
  // usePennySheet().open() on wide viewports (PennyPromptBar on Planning
  // and the /penny hub, TaxPennyEntry, ScenarioPage) had a panel with
  // nothing to visually anchor to or trigger from. `screenForPathname` is
  // the exact function BottomNav.tsx uses to turn the current route into
  // the sheet's screen context (lib/pennyScreenConfig.tsx) — reused here,
  // not reimplemented, so mobile and desktop agree on what "screen" means
  // for the same URL.
  const { open, close, isOpen } = usePennySheet();

  return (
    <aside className="hidden lg:flex fixed top-0 left-0 h-full w-64 flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 z-40">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-6 border-b border-slate-100 dark:border-slate-800">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden">
          {/* Plain <img>, not next/image: the mobile Capacitor build is a
              static export without images.unoptimized set, so next/image
              would emit a /_next/image?url=... optimizer URL that 404s in
              the exported bundle. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="Sorted" width={36} height={36} className="w-full h-full object-cover" />
        </div>
        <div>
          <p className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-tight">Sorted</p>
        </div>
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {TABS.map(({ href, matchPath, label, Icon }) => {
          const active = pathname === (matchPath ?? href);
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

      {/* Penny trigger — deliberately its own bordered footer block below
          the plain nav list above, not a sixth TABS entry, so it reads as
          "the assistant lives here" rather than another page link. Carries
          Penny's gradient mark (DESIGN.md's Penny Gradient Rule: the
          indigo→violet gradient is reserved for surfaces that are actually
          a door to advice, which this is). Toggles the same sheet
          BottomNav.tsx's raised button does (`usePennySheet`), with the
          same `aria-pressed` toggle semantics; anchors the desktop popover
          (PennySheet.tsx's `lg:right-6 lg:bottom-6` corner, `lg:origin-
          bottom-right` pop-in) the way that button anchors the mobile one.
          Deliberately plain otherwise — desktop is secondary in this
          product: no halo/glow, no living payday dot, just the row. */}
      <div className="px-3 py-3 border-t border-slate-100 dark:border-slate-800">
        <button
          type="button"
          onClick={() => (isOpen ? close() : open({ screen: screenForPathname(pathname) }))}
          aria-pressed={isOpen}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${
            isOpen
              ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400"
              : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-300"
          }`}
        >
          <span
            className="w-[18px] h-[18px] rounded-md flex items-center justify-center flex-shrink-0"
            style={{ background: BRAND_GRADIENT }}
          >
            <PennyMark size={11} className="text-white" />
          </span>
          <span className={`text-sm font-medium ${isOpen ? "font-semibold" : ""}`}>Ask Penny</span>
        </button>
      </div>
    </aside>
  );
}
