"use client";

// TEMPORARY PREVIEW — delete after design review.
//
// A visual-only stand-in for components/BottomNav.tsx (not imported, and
// not edited — another agent is working in components/ concurrently, and
// the real BottomNav's Penny button navigates to /penny, which is exactly
// the behaviour this preview is testing an alternative to). Same rail
// anatomy: floating glass-rail, 4 tabs with a sliding active pill, and a
// raised centre Penny button carrying the indigo→violet gradient, the
// ONE place that gradient appears in this preview's chrome. Tapping it
// opens the sheet instead of navigating anywhere.

import { Home, PieChart, CalendarClock, Lightbulb } from "lucide-react";
import PennyMark from "@/components/PennyMark";

const TABS = [
  { id: "home", label: "Home", Icon: Home, slot: 0 },
  { id: "spend", label: "Spend", Icon: PieChart, slot: 1 },
  { id: "planning", label: "Planning", Icon: CalendarClock, slot: 3, active: true },
  { id: "insights", label: "Insights", Icon: Lightbulb, slot: 4 },
];

export default function MockBottomNav({ onPennyTap, pennyOpen }: { onPennyTap: () => void; pennyOpen: boolean }) {
  return (
    <>
      <div
        aria-hidden="true"
        className="nav-scrim lg:hidden fixed inset-x-0 bottom-0 z-40 h-[116px] pointer-events-none"
      />
      <nav
        aria-label="Primary (preview backdrop, not a real destination)"
        className="lg:hidden fixed inset-x-0 z-50 flex justify-center"
        style={{ bottom: "max(env(safe-area-inset-bottom, 0px), 10px)" }}
      >
        <div className="relative w-[calc(100%-28px)] max-w-[402px]">
          <button
            type="button"
            onClick={onPennyTap}
            aria-label="Ask Penny"
            aria-expanded={pennyOpen}
            className="absolute left-1/2 -translate-x-1/2 -top-7 z-10 w-14 h-14 rounded-2xl flex items-center justify-center active:scale-95 transition-transform motion-reduce:transition-none"
            style={{
              background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
              boxShadow: pennyOpen
                ? "0 4px 14px rgba(79,70,229,0.35), 0 0 0 6px rgba(79,70,229,0.18)"
                : "0 4px 14px rgba(79,70,229,0.35)",
            }}
          >
            <PennyMark size={22} className="text-white" />
          </button>

          <div className="glass-rail relative rounded-[22px]">
            <div className="relative grid grid-cols-5 h-[64px] px-1.5">
              <span
                aria-hidden="true"
                className="absolute top-1.5 bottom-1.5 rounded-2xl"
                style={{
                  width: "calc((100% - 12px) / 5)",
                  left: "6px",
                  transform: `translateX(${(TABS.find((t) => t.active)?.slot ?? -2) * 100}%)`,
                  background: "rgba(79, 70, 229, 0.18)",
                }}
              />
              {TABS.map((tab) => (
                <div
                  key={tab.id}
                  style={{ gridColumnStart: tab.slot + 1 }}
                  className="relative z-10 flex flex-col items-center justify-center gap-0.5"
                >
                  <tab.Icon
                    size={22}
                    strokeWidth={tab.active ? 2.5 : 1.8}
                    className={tab.active ? "text-indigo-600 dark:text-indigo-400" : "text-slate-500 dark:text-slate-400"}
                  />
                  <span
                    className={`text-[11px] leading-none font-medium ${
                      tab.active ? "text-indigo-600 dark:text-indigo-400" : "text-slate-500 dark:text-slate-400"
                    }`}
                  >
                    {tab.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </nav>
    </>
  );
}
