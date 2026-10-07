"use client";

// G228 PROPOSALS. Hand-authored for exploring: the Home card (A), the third
// remedy row inside a set-aside card (B), the Planning goal control and Home
// pointer (C). Production components are NOT changed in this round.

import { CalendarClock, ChevronRight, PiggyBank, Undo2 } from "lucide-react";
import { BRIEF_CARD, BriefIcon, DismissChip, KindLabel, SECONDARY_ACTION } from "@/components/HomeBrief";
import { COPY } from "./copy";
import { GOAL, gbp } from "./fixtures";

const QUIET = "inline-flex min-h-11 shrink-0 touch-manipulation items-center justify-center rounded-lg px-3 text-sm font-semibold text-slate-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-200 [@media(hover:hover)]:hover:bg-slate-100 dark:[@media(hover:hover)]:hover:bg-slate-700";
const BODY = "text-[12px] leading-5 text-slate-600 dark:text-slate-400";

export function DeferredLine({ onUndo }: { onUndo(): void }) {
  return (
    <div data-defer="deferred" className="px-1">
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{COPY.deferredLine}</p>
      <p className={`mt-0.5 ${BODY}`}>{COPY.deferredDetail}</p>
      <button type="button" onClick={onUndo} className={`${QUIET} -ml-3 gap-1.5`}><Undo2 size={14} aria-hidden="true" />{COPY.undo}</button>
    </div>
  );
}

/** Variant A: its own card, ranked below the set-aside card. */
export function DeferCardA({ capped, onOpen }: { capped: boolean; onOpen(): void }) {
  return (
    <div data-defer="a" className={`${BRIEF_CARD} !shadow-none p-4`}>
      <div className="flex items-start gap-3 pr-9">
        <BriefIcon><CalendarClock size={16} /></BriefIcon>
        <div className="min-w-0 flex-1">
          <KindLabel>{COPY.aKind}</KindLabel>
          <p className="mt-1 text-pretty text-[15px] font-bold leading-6 text-slate-900 dark:text-slate-100">{capped ? COPY.aCappedHeadline : COPY.aHeadline}</p>
        </div>
      </div>
      {!capped && (
        <div className="mt-3">
          <p className="money text-[18px] font-semibold leading-6 text-slate-900 dark:text-white">{gbp(GOAL.gap)}</p>
          <p className="text-[12px] text-slate-500 dark:text-slate-400">{COPY.aCaption}</p>
        </div>
      )}
      <div className="mt-2">
        <p className={BODY}>{capped ? COPY.aCappedBody : COPY.aBody}</p>
        {!capped && <p className={`mt-1 ${BODY}`}>{COPY.aReason} {COPY.aNote}</p>}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-2">
        <button type="button" onClick={onOpen} className={`${SECONDARY_ACTION} text-center leading-tight`}>{capped ? COPY.aCappedAction : COPY.aAction}</button>
      </div>
      <DismissChip label={COPY.aDismiss} onClick={() => {}} className="absolute top-2 right-2 z-10" />
    </div>
  );
}

/** Variant B: one card, remedy rows, each a sentence and at most one quiet action. */
export function RemedyCardB({ capped, covered, onOpen }: { capped: boolean; covered: boolean; onOpen(): void }) {
  return (
    <div data-defer="b" className={`${BRIEF_CARD} !shadow-none p-4`}>
      <div className="flex items-start gap-3 pr-9">
        <BriefIcon><PiggyBank size={16} /></BriefIcon>
        <div className="min-w-0 flex-1">
          <KindLabel>{COPY.bKind}</KindLabel>
          <p className="mt-1 text-pretty text-[15px] font-bold leading-6 text-slate-900 dark:text-slate-100">{COPY.bHeadline}</p>
        </div>
      </div>
      <div className="mt-3">
        <p className="money text-[18px] font-semibold leading-6 text-slate-900 dark:text-white">{gbp(GOAL.gap)}</p>
        <p className="text-[12px] text-slate-500 dark:text-slate-400">{COPY.bCaption}</p>
      </div>
      <ul className="mt-3 divide-y divide-slate-200 border-t border-slate-200 dark:divide-slate-700 dark:border-slate-700">
        <li className="py-2.5"><p className={BODY}>{covered ? COPY.bMoveFull : COPY.bMove}</p></li>
        <li className="flex items-center justify-between gap-2 py-1">
          <p className={`min-w-0 flex-1 ${BODY}`}>{COPY.bReduce}</p>
          <button type="button" onClick={() => {}} className={QUIET}>{COPY.bReduceAction}</button>
        </li>
        {!covered && (
          <li className="flex items-center justify-between gap-2 py-1">
            <p className={`min-w-0 flex-1 ${BODY}`}>{capped ? COPY.bCapped : COPY.bEase}</p>
            <button type="button" onClick={onOpen} className={QUIET}>{capped ? COPY.bCappedAction : COPY.bEaseAction}</button>
          </li>
        )}
      </ul>
      <DismissChip label={COPY.bDismiss} onClick={() => {}} className="absolute top-2 right-2 z-10" />
    </div>
  );
}

/** Variant C: the control under a Planning goal row. */
export function GoalEaseControl({ capped, onOpen }: { capped: boolean; onOpen(): void }) {
  return (
    <div data-defer="c" className="flex flex-wrap items-center justify-between gap-x-3 border-t border-slate-200/70 px-3.5 dark:border-white/10">
      {capped ? (
        <p className="py-2.5 text-xs leading-5 text-slate-600 dark:text-slate-400">{COPY.cCapped}</p>
      ) : (
        <>
          <p className="text-xs text-slate-600 dark:text-slate-400">{COPY.cPrompt}</p>
          <button type="button" onClick={onOpen} className={`${QUIET} -mr-3 underline underline-offset-4`}>{COPY.cAction}</button>
        </>
      )}
    </div>
  );
}

/** Variant C: Home only points at the goal, no card. */
export function HomePointerC({ onOpen }: { onOpen(): void }) {
  return (
    <button type="button" onClick={onOpen} data-defer="pointer" className="flex min-h-11 w-full items-center justify-between gap-2 px-1 text-left text-sm font-medium text-slate-700 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-200">
      <span>{COPY.pointer}</span>
      <ChevronRight size={15} className="shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
    </button>
  );
}
