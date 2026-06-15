"use client";

import { useEffect, useState, useRef } from "react";
import {
  ChevronLeft, ChevronRight, X,
  Sparkles, Building2, Upload, PieChart, List, Tag, Target, TrendingDown, Lightbulb,
} from "lucide-react";
import { useTutorial } from "./TutorialContext";

const ICONS: Record<string, React.ComponentType<{ size?: number; color?: string; className?: string }>> = {
  Sparkles, Building2, Upload, PieChart, List, Tag, Target, TrendingDown, Lightbulb,
};

interface Rect { top: number; left: number; width: number; height: number }

const PADDING = 8;

function findTarget(id: string, cb: (rect: Rect | null) => void) {
  const el = document.querySelector(`[data-tutorial-id="${id}"]`);
  if (!el) { cb(null); return; }
  el.scrollIntoView({ block: "center", behavior: "instant" });
  // Wait two animation frames so layout settles after the instant scroll
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      cb({
        top: r.top - PADDING,
        left: r.left - PADDING,
        width: r.width + PADDING * 2,
        height: r.height + PADDING * 2,
      });
    });
  });
}

export default function TutorialOverlay() {
  const { isActive, currentStep, total, step, next, prev, goTo, end } = useTutorial();
  const [rect, setRect] = useState<Rect | null>(null);
  const attemptsRef = useRef(0);

  useEffect(() => {
    if (!isActive) { setRect(null); return; }
    if (!step.target) { setRect(null); return; }

    attemptsRef.current = 0;
    setRect(null);

    function attempt() {
      findTarget(step.target!, (r) => {
        if (r) { setRect(r); return; }
        attemptsRef.current++;
        if (attemptsRef.current < 20) setTimeout(attempt, 200);
      });
    }
    // Give the page time to render after navigation
    setTimeout(attempt, 500);
  }, [isActive, currentStep, step.target]);

  if (!isActive) return null;

  const Icon = ICONS[step.iconName] ?? Sparkles;
  const isFirst = currentStep === 0;
  const isLast = currentStep === total - 1;
  // isCenteredTooltip: card sits in the middle of the screen (no arrow)
  // hasSpotlight: spotlight ring + dark panels still render around the element
  const isCenteredTooltip = step.tooltipSide === "center" || !rect;
  const hasSpotlight = !!rect;

  const vw = typeof window !== "undefined" ? window.innerWidth : 390;
  const vh = typeof window !== "undefined" ? window.innerHeight : 844;

  // Tooltip dimensions (approximate)
  const TW = Math.min(vw - 32, 360);
  const TH = 220;
  const ARROW = 14;

  let tooltipTop = 0;
  let tooltipLeft = (vw - TW) / 2;
  let arrowLeft = TW / 2 - 7;
  let arrowOnTop = false; // arrow points down toward spotlight (tooltip is above)

  if (rect && !isCenteredTooltip) {
    if (step.tooltipSide === "below") {
      tooltipTop = rect.top + rect.height + ARROW + 4;
      arrowOnTop = true; // tooltip is below, arrow on top points up toward element
    } else {
      // above
      tooltipTop = rect.top - TH - ARROW - 4;
      arrowOnTop = false; // tooltip is above, arrow on bottom points down toward element
    }
    // Horizontal: centre tooltip on spotlight
    tooltipLeft = rect.left + rect.width / 2 - TW / 2;
    tooltipLeft = Math.max(16, Math.min(tooltipLeft, vw - TW - 16));
    arrowLeft = (rect.left + rect.width / 2) - tooltipLeft - 7;
    arrowLeft = Math.max(16, Math.min(arrowLeft, TW - 30));
    // If tooltip overflows below or above, flip
    if (tooltipTop + TH > vh - 80) {
      tooltipTop = rect.top - TH - ARROW - 4;
      arrowOnTop = false;
    }
    if (tooltipTop < 60) {
      tooltipTop = rect.top + rect.height + ARROW + 4;
      arrowOnTop = true;
    }
  }

  return (
    <div className="fixed inset-0 z-[60]" style={{ pointerEvents: "auto" }}>
      {/* Dark overlay with spotlight cutout */}
      {hasSpotlight ? (
        <>
          {/* Four dark panels around the spotlight */}
          <div className="absolute inset-0 bg-black/60" style={{ clipPath: `polygon(0 0, 100% 0, 100% ${rect!.top}px, 0 ${rect!.top}px)` }} onClick={end} />
          <div className="absolute inset-0 bg-black/60" style={{ clipPath: `polygon(0 ${rect!.top + rect!.height}px, 100% ${rect!.top + rect!.height}px, 100% 100%, 0 100%)` }} onClick={end} />
          <div className="absolute inset-0 bg-black/60" style={{ clipPath: `polygon(0 ${rect!.top}px, ${rect!.left}px ${rect!.top}px, ${rect!.left}px ${rect!.top + rect!.height}px, 0 ${rect!.top + rect!.height}px)` }} onClick={end} />
          <div className="absolute inset-0 bg-black/60" style={{ clipPath: `polygon(${rect!.left + rect!.width}px ${rect!.top}px, 100% ${rect!.top}px, 100% ${rect!.top + rect!.height}px, ${rect!.left + rect!.width}px ${rect!.top + rect!.height}px)` }} onClick={end} />
          {/* Spotlight ring */}
          <div
            className="absolute rounded-2xl"
            style={{
              top: rect!.top, left: rect!.left,
              width: rect!.width, height: rect!.height,
              boxShadow: "0 0 0 3px rgba(255,255,255,0.5)",
              pointerEvents: "none",
            }}
          />
        </>
      ) : (
        <div className="absolute inset-0 bg-black/60" onClick={end} />
      )}

      {/* Tooltip card */}
      <div
        className="absolute bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden"
        style={
          isCenteredTooltip
            ? { top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: TW }
            : { top: tooltipTop, left: tooltipLeft, width: TW }
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

        {/* Close */}
        <button
          onClick={end}
          className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 z-10"
        >
          <X size={13} className="text-slate-500" />
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
                className="flex items-center gap-1 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[13px] font-medium active:scale-95 transition-transform"
              >
                <ChevronLeft size={15} /> Back
              </button>
            )}
            <button
              onClick={next}
              className="flex-1 flex items-center justify-center gap-1 py-2 rounded-xl text-white text-[13px] font-semibold active:scale-95 transition-transform"
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
