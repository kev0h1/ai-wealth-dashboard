"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { TUTORIAL_FLOWS, useTutorialInternal } from "./TutorialContext";

function seenKey(flowId: string) {
  return `sorted_tour_seen_${flowId}`;
}

/**
 * Auto-offer for a screen's own short tour, the first time the user lands
 * on that screen's route. Mounted globally (app/layout.tsx) alongside
 * TutorialOverlay. `first-run` is never offered this way — it auto-starts
 * itself from the onboarding-pending flag in TutorialContext.
 */
export default function TutorialOffer() {
  const pathname = usePathname();
  const { isActive, isReady, startFlow } = useTutorialInternal();
  const [dismissedTick, setDismissedTick] = useState(0);
  const [visible, setVisible] = useState(false);

  const flow = TUTORIAL_FLOWS.find((f) => f.id !== "first-run" && f.route === pathname) ?? null;
  const flowId = flow?.id ?? null;
  const flowReadyKey = flow?.readyKey;
  const ready = isReady(flowReadyKey);

  useEffect(() => {
    if (!flowId) { setVisible(false); return; }
    if (isActive) { setVisible(false); return; }
    if (!ready) { setVisible(false); return; }
    let seen = false;
    try { seen = localStorage.getItem(seenKey(flowId)) === "1"; } catch {}
    setVisible(!seen);
    // dismissedTick forces a re-check right after the user dismisses/starts,
    // so the card doesn't reappear a moment later from a stale read.
  }, [flowId, isActive, ready, dismissedTick]);

  if (!flow || !visible) return null;

  function dismiss() {
    try { localStorage.setItem(seenKey(flow!.id), "1"); } catch {}
    setVisible(false);
    setDismissedTick((t) => t + 1);
  }

  function show() {
    try { localStorage.setItem(seenKey(flow!.id), "1"); } catch {}
    startFlow(flow!.id);
    setVisible(false);
  }

  return (
    <div
      className="lg:hidden fixed inset-x-0 z-[45] flex justify-center px-4 pointer-events-none"
      style={{ bottom: "calc(max(env(safe-area-inset-bottom, 0px), 10px) + 100px)" }}
    >
      <div className="glass-card rounded-2xl shadow-lg w-full max-w-[402px] p-4 flex items-start gap-3 pointer-events-auto">
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-slate-900 dark:text-white leading-snug">
            {flow.label}
          </p>
          <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400 leading-relaxed">
            {flow.blurb}
          </p>
          <button
            type="button"
            onClick={show}
            className="mt-2.5 h-11 px-4 inline-flex items-center justify-center rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold active:scale-95 transition-transform"
          >
            Show me
          </button>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss tour offer"
          className="flex-shrink-0 -mt-1 -mr-1 w-11 h-11 flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 active:scale-95 transition-transform duration-150"
        >
          <span className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-900/[0.05] dark:bg-white/[0.06] border border-slate-900/[0.06] dark:border-white/10 [@media(hover:hover)]:hover:bg-slate-900/[0.09] dark:[@media(hover:hover)]:hover:bg-white/[0.11] transition-colors duration-150">
            <X size={14} aria-hidden="true" className="text-slate-500 dark:text-slate-300" />
          </span>
        </button>
      </div>
    </div>
  );
}
