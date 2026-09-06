"use client";

// TEMPORARY PREVIEW — delete after design review.
//
// A static stand-in for components/BottomNav.tsx (not imported: the real
// component needs usePennySheet/PennySheetProvider context and live
// atRisk/payday hooks this route has no auth to satisfy). Rail anatomy,
// class names and geometry copied 1:1 from the real file: 4 real tabs
// (Home, Spend, Upcoming, Planning) with a sliding indigo pill, and the
// raised centre Penny button (56px, `w-14 h-14 rounded-2xl`, `-top-7`,
// indigo->violet gradient — the ONE place that gradient appears in this
// rail's own chrome).
//
// Variant B's ring sits AROUND this button rather than around the sheet
// header's avatar. The button itself is a rounded square, not a circle, so
// a literal circular ring drawn tight to its edges would clip the corners;
// this uses a halo diameter (80px) big enough to fully circumscribe the
// button's corners (half-diagonal of a 56px square is ~39.6px, so a ring
// radius of at least that clears every corner), reading as a soft halo
// behind the button rather than a collar hugging it — the same "halo
// behind a square-ish button" language the button's own resting
// `boxShadow` glow already uses (components/BottomNav.tsx's `pennyActive`
// halo), just traced as a literal ring instead of a blurred shadow.
import { CalendarClock, Home, PieChart, Target } from "lucide-react";
import PennyMark from "@/components/PennyMark";
import UsageRing from "./UsageRing";
import type { UsageData, UsageState } from "./fixtures";

const TABS = [
  { id: "home", label: "Home", Icon: Home, slot: 0 },
  { id: "spend", label: "Spend", Icon: PieChart, slot: 1 },
  { id: "upcoming", label: "Upcoming", Icon: CalendarClock, slot: 3, active: true },
  { id: "planning", label: "Planning", Icon: Target, slot: 4 },
];

export default function MockBottomNav({ state, data }: { state: UsageState; data: UsageData }) {
  const hasRing = data.limit != null;
  return (
    <div className="relative w-full max-w-[430px] mx-auto pt-12 pb-2">
      <div className="relative">
        {hasRing && (
          <UsageRing
            id={`nav-ring-${state}`}
            size={80}
            strokeWidth={2.5}
            used={data.used}
            limit={data.limit}
            className="absolute left-1/2 -translate-x-1/2 -top-[47px] z-10 pointer-events-none"
          />
        )}
        <button
          type="button"
          aria-label="Ask Penny"
          className="absolute left-1/2 -translate-x-1/2 -top-7 z-10 w-14 h-14 rounded-2xl flex items-center justify-center active:scale-95 transition-transform motion-reduce:transition-none"
          style={{
            background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
            boxShadow: "0 4px 14px rgba(79,70,229,0.35)",
          }}
        >
          <PennyMark size={22} className="text-white" />
        </button>

        {/* overflow-hidden here (not on the outer wrapper) is deliberate:
            the raised Penny button and its ring sit as siblings ABOVE this
            pill, positioned absolutely against the outer "relative" div one
            level up, so clipping only this inner rail keeps them free to
            poke up past its top edge while still guaranteeing an unbroken
            tab label can never spill past the rail's own right edge. */}
        <div className="glass-rail relative rounded-[22px] overflow-hidden">
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
    </div>
  );
}
