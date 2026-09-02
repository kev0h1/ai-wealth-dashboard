"use client";

import { useEffect, useState, useRef, useLayoutEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronLeft, ChevronRight, X,
  Sparkles, Wallet, Building2, Compass, Layers, Plus, Upload, TrendingUp, PiggyBank,
  ArrowLeftRight, PieChart, ListChecks, Tag, Settings, CalendarClock, Receipt, Target,
  Coins, Lightbulb,
} from "lucide-react";
import { useTutorialInternal } from "./TutorialContext";

const ICONS: Record<string, React.ComponentType<{ size?: number; color?: string; className?: string }>> = {
  Sparkles, Wallet, Building2, Compass, Layers, Plus, Upload, TrendingUp, PiggyBank,
  ArrowLeftRight, PieChart, ListChecks, Tag, Settings, CalendarClock, Receipt, Target,
  Coins, Lightbulb,
};

interface Rect { top: number; left: number; width: number; height: number }

const PADDING = 8;
const READY_TIMEOUT_MS = 6000;
const ACQUIRE_RETRIES = 20;
const ACQUIRE_INTERVAL_MS = 200;
// Exclusive head start (in attempts) given to the primary target before the
// fallback is raced alongside it — preserves the primary's advantage when
// it's merely slow to paint, without doubling the worst-case wall clock.
const PRIMARY_HEAD_START_ATTEMPTS = 5; // 5 * 200ms = 1s
const REACQUIRE_GRACE_MS = 500;
const BOTTOM_CLEARANCE = 88; // clears the floating bottom nav
const CARD_GAP = 12;
const ARROW = 14;
const DEFAULT_CARD_HEIGHT = 220; // first-paint guess only; ResizeObserver corrects it

function rectsIntersect(a: { top: number; left: number; width: number; height: number }, b: typeof a) {
  return a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
}

function wait(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function waitTwoFrames(): Promise<void> {
  return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res())));
}

export default function TutorialOverlay() {
  const router = useRouter();
  const pathname = usePathname();
  const { isActive, flow, step, currentStep, total, next, prev, goTo, end, runAction, isReadyNow } = useTutorialInternal();
  const [rect, setRect] = useState<Rect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(DEFAULT_CARD_HEIGHT);

  // ── Acquisition + tracking ────────────────────────────────────────────
  // One orchestration run per (flow, step). Re-runs when the pathname
  // changes too, since a pending route push needs to see the updated value.
  useEffect(() => {
    if (!isActive || !flow || !step) {
      setRect(null);
      return;
    }

    let cancelled = false;
    let pollId: number | null = null;

    // Tries a single data-tutorial-id for the existing retry budget.
    async function acquireById(id: string): Promise<Element | null> {
      for (let attempt = 0; attempt < ACQUIRE_RETRIES; attempt++) {
        if (cancelled) return null;
        const el = document.querySelector(`[data-tutorial-id="${id}"]`);
        if (el) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return el;
        }
        await wait(ACQUIRE_INTERVAL_MS);
      }
      return null;
    }

    function probe(id: string): Element | null {
      const el = document.querySelector(`[data-tutorial-id="${id}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return el;
      }
      return null;
    }

    // Initial acquisition only: the primary target gets an exclusive head
    // start (PRIMARY_HEAD_START_ATTEMPTS), so a merely-slow-to-paint primary
    // still wins outright. After that, target and fallbackTarget are raced
    // within the same attempt/interval — whichever resolves first — for the
    // remainder of the existing ACQUIRE_RETRIES budget. Total wall clock
    // stays at one budget (~4s), not the primary's budget plus the
    // fallback's. Whichever id resolves is returned alongside the element so
    // the caller can track/re-acquire against that SAME id for the rest of
    // the step, rather than re-running this race on every reacquisition.
    async function acquire(): Promise<{ el: Element; id: string } | null> {
      const targetId = step!.target;
      if (!targetId) return null;
      const fallbackId = step!.fallbackTarget;

      for (let attempt = 0; attempt < ACQUIRE_RETRIES; attempt++) {
        if (cancelled) return null;
        const el = probe(targetId);
        if (el) return { el, id: targetId };
        if (attempt >= PRIMARY_HEAD_START_ATTEMPTS && fallbackId) {
          const fbEl = probe(fallbackId);
          if (fbEl) return { el: fbEl, id: fallbackId };
        }
        await wait(ACQUIRE_INTERVAL_MS);
      }
      return null;
    }

    function toRect(el: Element): Rect {
      const r = el.getBoundingClientRect();
      return {
        top: r.top - PADDING,
        left: r.left - PADDING,
        width: r.width + PADDING * 2,
        height: r.height + PADDING * 2,
      };
    }

    // `id` is the SAME data-tutorial-id that first resolved (target or
    // fallbackTarget) — tracked and re-acquired against for the rest of the
    // step, rather than re-running the target-then-fallback race each time.
    async function pollLoop(initialEl: Element, id: string, hasScrolledRef: { current: boolean }) {
      if (!hasScrolledRef.current) {
        hasScrolledRef.current = true;
        initialEl.scrollIntoView({ block: "center", behavior: "instant" });
      }

      let prevRect: Rect | null = null;
      let missingSince: number | null = null;

      const frame = () => {
        if (cancelled) return;
        const el = document.querySelector(`[data-tutorial-id="${id}"]`);
        const r = el ? el.getBoundingClientRect() : null;
        const missing = !el || !r || r.width === 0 || r.height === 0;

        if (missing) {
          if (missingSince === null) missingSince = Date.now();
          if (Date.now() - missingSince > REACQUIRE_GRACE_MS) {
            setRect(null);
            prevRect = null;
            void reacquireAndPoll(id, hasScrolledRef);
            return;
          }
          pollId = requestAnimationFrame(frame);
          return;
        }

        missingSince = null;
        const nr: Rect = toRect(el!);
        const changed =
          !prevRect ||
          Math.abs(prevRect.top - nr.top) > 0.5 ||
          Math.abs(prevRect.left - nr.left) > 0.5 ||
          Math.abs(prevRect.width - nr.width) > 0.5 ||
          Math.abs(prevRect.height - nr.height) > 0.5;
        if (changed) {
          prevRect = nr;
          setRect(nr);
        }
        pollId = requestAnimationFrame(frame);
      };
      pollId = requestAnimationFrame(frame);
    }

    async function reacquireAndPoll(id: string, hasScrolledRef: { current: boolean }) {
      const el = await acquireById(id);
      if (cancelled) return;
      if (!el) {
        // Gave up — permanent fallback to the centred card, no ring.
        setRect(null);
        return;
      }
      await pollLoop(el, id, hasScrolledRef);
    }

    async function run() {
      // 1. Route sync — if this step wants a different route, push and bail;
      // the effect re-fires once `pathname` changes (it's a dependency).
      // Falls back to the flow's own route so replaying a flow (e.g. from
      // Settings' "How Sorted works" list) while sitting on another page
      // navigates there first, instead of running the whole flow in place
      // with every target failing to acquire.
      const targetRoute = step!.route ?? flow!.route;
      if (targetRoute && pathname !== targetRoute) {
        router.push(targetRoute);
        return;
      }

      // 2. Wait for the ready flag (flow default, or a per-step override),
      // with a timeout fallback so a missing/late readyKey never wedges the
      // tour forever. Nothing is measured/spotlit while this is pending —
      // the render below already renders centred whenever `rect` is null.
      const readyKey = step!.readyKey ?? flow!.readyKey;
      const deadline = Date.now() + READY_TIMEOUT_MS;
      while (!cancelled && !isReadyNow(readyKey) && Date.now() < deadline) {
        await wait(100);
      }
      if (cancelled) return;

      // 3. Await the step's action (if any), then let layout settle.
      if (step!.action) {
        await runAction(step!.action);
      }
      if (cancelled) return;
      await waitTwoFrames();
      await wait(150);
      if (cancelled) return;

      // Steps with no target never get a ring — nothing further to do.
      if (!step!.target) {
        setRect(null);
        return;
      }

      // 4. Acquire the element — target first, then fallbackTarget.
      const acquired = await acquire();
      if (cancelled) return;
      if (!acquired) {
        setRect(null); // permanent fallback — centred card, no ring
        return;
      }

      // 5/6. Scroll once, then poll every frame for as long as the step stays active.
      const hasScrolledRef = { current: false };
      await pollLoop(acquired.el, acquired.id, hasScrolledRef);
    }

    void run();

    return () => {
      cancelled = true;
      if (pollId !== null) cancelAnimationFrame(pollId);
      setRect(null);
    };
    // step is looked up by [flow?.id, currentStep] identity; step.target etc.
    // don't need to be listed since they're derived from those two.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, flow?.id, currentStep, pathname]);

  // ── Card height measurement (replaces the old fixed 220px constant) ────
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (h) setCardHeight(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [flow?.id, currentStep]);

  if (!isActive || !flow || !step) return null;

  const Icon = ICONS[step.iconName] ?? Sparkles;
  const isFirst = currentStep === 0;
  const isLast = currentStep === total - 1;
  const hasSpotlight = !!rect;

  const vw = typeof window !== "undefined" ? window.innerWidth : 390;
  const vh = typeof window !== "undefined" ? window.innerHeight : 844;
  const TW = Math.min(vw - 32, 360);

  let usedSide: "above" | "below" | "center" = "center";
  let tooltipTop = 0;
  let tooltipLeft = (vw - TW) / 2;
  let arrowLeft = TW / 2 - 7;
  let arrowOnTop = false; // arrow points up toward the spotlight (tooltip is below)

  if (rect && step.tooltipSide !== "center") {
    const belowTop = rect.top + rect.height + CARD_GAP;
    const aboveTop = rect.top - cardHeight - CARD_GAP;
    const fitsBelow = belowTop + cardHeight <= vh - BOTTOM_CLEARANCE;
    const fitsAbove = aboveTop >= CARD_GAP;

    if (step.tooltipSide === "below" && fitsBelow) {
      tooltipTop = belowTop;
      usedSide = "below";
      arrowOnTop = true;
    } else if (step.tooltipSide === "above" && fitsAbove) {
      tooltipTop = aboveTop;
      usedSide = "above";
      arrowOnTop = false;
    } else if (step.tooltipSide === "below" && fitsAbove) {
      // Preferred side didn't fit — flip to the opposite side rather than
      // giving up on anchoring altogether.
      tooltipTop = aboveTop;
      usedSide = "above";
      arrowOnTop = false;
    } else if (step.tooltipSide === "above" && fitsBelow) {
      tooltipTop = belowTop;
      usedSide = "below";
      arrowOnTop = true;
    }

    if (usedSide !== "center") {
      tooltipLeft = rect.left + rect.width / 2 - TW / 2;
      tooltipLeft = Math.max(16, Math.min(tooltipLeft, vw - TW - 16));
      arrowLeft = rect.left + rect.width / 2 - tooltipLeft - 7;
      arrowLeft = Math.max(16, Math.min(arrowLeft, TW - 30));

      // Safety net: if the measured card would still overlap the ring
      // (e.g. the height guess was stale on first paint), fall back to
      // centred rather than covering the thing it's supposed to point at.
      const cardRectBox = { top: tooltipTop, left: tooltipLeft, width: TW, height: cardHeight };
      if (rectsIntersect(cardRectBox, rect)) {
        usedSide = "center";
      }
    }
  }

  const isCenteredTooltip = usedSide === "center";

  return (
    <div className="fixed inset-0 z-[60]" data-tutorial-overlay style={{ pointerEvents: "none" }}>
      {/* Dark overlay with rounded spotlight cutout (visual only — never captures clicks) */}
      {hasSpotlight ? (
        <>
          <svg
            className="absolute inset-0 w-full h-full"
            style={{ pointerEvents: "none" }}
          >
            <defs>
              <mask id="tutorial-spotlight-mask">
                <rect width="100%" height="100%" fill="white" />
                <rect
                  x={rect!.left} y={rect!.top}
                  width={rect!.width} height={rect!.height}
                  rx="14" ry="14"
                  fill="black"
                />
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="rgba(0,0,0,0.6)" mask="url(#tutorial-spotlight-mask)" />
            {/* Rounded spotlight ring */}
            <rect
              x={rect!.left} y={rect!.top}
              width={rect!.width} height={rect!.height}
              rx="14" ry="14"
              fill="none"
              stroke="rgba(255,255,255,0.5)"
              strokeWidth="3"
              style={{ pointerEvents: "none" }}
            />
          </svg>
          {/* Invisible dismiss curtains — tile the viewport MINUS the spotlighted
              rect, so the target element receives clicks directly (nothing with
              pointer-events:auto sits over it). Clicking any dimmed area still ends the tour. */}
          <div
            onClick={end}
            style={{ position: "absolute", top: 0, left: 0, right: 0, height: Math.max(0, rect!.top), pointerEvents: "auto" }}
          />
          <div
            onClick={end}
            style={{ position: "absolute", top: rect!.top + rect!.height, left: 0, right: 0, bottom: 0, pointerEvents: "auto" }}
          />
          <div
            onClick={end}
            style={{ position: "absolute", top: rect!.top, left: 0, width: Math.max(0, rect!.left), height: rect!.height, pointerEvents: "auto" }}
          />
          <div
            onClick={end}
            style={{ position: "absolute", top: rect!.top, left: rect!.left + rect!.width, right: 0, height: rect!.height, pointerEvents: "auto" }}
          />
        </>
      ) : (
        <div className="absolute inset-0 bg-black/60" onClick={end} style={{ pointerEvents: "auto" }} />
      )}

      {/* Tooltip card */}
      <div
        ref={cardRef}
        className="absolute bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden"
        style={
          isCenteredTooltip
            ? { top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: TW, pointerEvents: "auto" }
            : { top: tooltipTop, left: tooltipLeft, width: TW, pointerEvents: "auto" }
        }
      >
        {/* Arrow — only shown when tooltip is anchored to the spotlight */}
        {!isCenteredTooltip && rect && (
          <div
            style={{
              position: "absolute",
              [arrowOnTop ? "top" : "bottom"]: -ARROW + 2,
              left: arrowLeft,
              width: 0, height: 0,
              borderLeft: "7px solid transparent",
              borderRight: "7px solid transparent",
              [arrowOnTop ? "borderBottom" : "borderTop"]: `${ARROW}px solid white`,
            }}
          />
        )}

        {/* Close — 44px hit area (same pattern as TutorialOffer's dismiss
            button) wrapping the same 28px visual chip, centred where the
            chip alone used to sit. */}
        <button
          onClick={end}
          aria-label="Close tour"
          className="absolute top-1 right-1 w-11 h-11 flex items-center justify-center rounded-full z-10"
        >
          <span className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
            <X size={13} className="text-slate-500" />
          </span>
        </button>

        <div className="p-5">
          {/* Icon + step */}
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: step.bg }}>
              <Icon size={20} color={step.color} />
            </div>
            <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: step.color }}>
              Step {currentStep + 1} of {total}
            </span>
          </div>

          <h3 className="text-[15px] font-bold text-slate-900 dark:text-slate-100 mb-1.5 leading-snug">
            {step.title}
          </h3>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed">
            {step.description}
          </p>

          {step.tip && (
            <div className="mt-2.5 px-3 py-2 rounded-xl text-[12px] font-medium leading-relaxed" style={{ backgroundColor: step.bg, color: step.color }}>
              💡 {step.tip}
            </div>
          )}

          {/* Progress dots */}
          <div className="flex items-center gap-1.5 mt-4 mb-3">
            {Array.from({ length: total }).map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                className="rounded-full transition-all duration-200"
                style={{
                  width: i === currentStep ? 18 : 6,
                  height: 6,
                  backgroundColor: i === currentStep ? step.color : "#e2e8f0",
                }}
              />
            ))}
          </div>

          {/* Nav */}
          <div className="flex gap-2">
            {!isFirst && (
              <button
                onClick={prev}
                className="flex items-center gap-1 px-3.5 py-2 min-h-[44px] rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[13px] font-medium active:scale-95 transition-transform"
              >
                <ChevronLeft size={15} /> Back
              </button>
            )}
            <button
              onClick={next}
              className="flex-1 flex items-center justify-center gap-1 py-2 min-h-[44px] rounded-xl text-white text-[13px] font-semibold active:scale-95 transition-transform"
              style={{ backgroundColor: step.color }}
            >
              {isLast ? "Done!" : (<>Next <ChevronRight size={15} /></>)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
