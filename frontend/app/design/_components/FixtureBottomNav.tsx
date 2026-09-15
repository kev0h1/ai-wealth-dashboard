import Link from "next/link";
import { CalendarClock, Home, PieChart, Target } from "lucide-react";
import PennyMark from "@/components/PennyMark";
import { BRAND_GRADIENT } from "@/lib/brand";

const TABS = [
  { href: "/", label: "Home", Icon: Home, slot: 0 },
  { href: "/spend?view=period", label: "Spend", Icon: PieChart, slot: 1 },
  { href: "/upcoming", label: "Upcoming", Icon: CalendarClock, slot: 3 },
  { href: "/planning", label: "Planning", Icon: Target, slot: 4 },
];

/**
 * Static, fixture-safe counterpart to BottomNav for auth-exempt previews.
 * The production component reads cached status and can call the API, so it
 * must not be mounted on /design. Accounts is not a primary tab, therefore
 * no rail item is highlighted, matching the production route.
 */
export default function FixtureBottomNav() {
  return (
    <>
      <div
        aria-hidden="true"
        className="nav-scrim pointer-events-none fixed inset-x-0 bottom-[var(--design-controls-clearance,0px)] z-40 h-[116px] lg:hidden"
      />
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-[calc(max(env(safe-area-inset-bottom,0px),10px)+var(--design-controls-clearance,0px))] z-50 flex justify-center lg:hidden"
      >
        <div className="relative w-[calc(100%-28px)] max-w-[402px]">
          <Link
            href="/penny"
            aria-label="Penny"
            className="absolute -top-7 left-1/2 z-10 flex size-14 -translate-x-1/2 touch-manipulation items-center justify-center rounded-2xl [-webkit-tap-highlight-color:transparent] transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 motion-reduce:transition-none dark:focus-visible:ring-offset-slate-900"
            style={{ background: BRAND_GRADIENT, boxShadow: "0 4px 14px rgba(79,70,229,0.35)" }}
          >
            <PennyMark size={22} className="text-white" />
          </Link>

          <div className="glass-rail relative rounded-[22px]">
            <div className="relative grid h-16 grid-cols-5 px-1.5">
              {TABS.map((tab) => (
                <Link
                  key={tab.label}
                  href={tab.href}
                  style={{ gridColumnStart: tab.slot + 1 }}
                  className="relative z-10 flex min-h-11 touch-manipulation flex-col items-center justify-center gap-0.5 rounded-2xl [-webkit-tap-highlight-color:transparent] transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 motion-reduce:transition-none"
                >
                  <tab.Icon size={22} strokeWidth={1.8} className="text-slate-500 dark:text-slate-400" aria-hidden="true" />
                  <span className="text-[11px] font-medium leading-none text-slate-500 dark:text-slate-400">{tab.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </nav>
    </>
  );
}
