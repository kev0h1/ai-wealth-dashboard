"use client";

// TEMPORARY PREVIEW — delete after design review.
//
// A static stand-in for the Penny sheet's own header/thread/composer shell
// (components/PennySheet.tsx + the `inSheet` markup in
// components/PennyConversation.tsx), copied rather than imported: importing
// the real PennySheet would drag in PennySheetProvider's context, the
// portal-to-document.body plumbing, and a live PennyConversation instance
// that fires an authenticated suggestions fetch on mount — none of which
// this route needs or can satisfy (no auth here, /design/* is exempt).
// Markup, class names and pixel geometry below are copied 1:1 from the two
// real files (header: icon size 28px/rounded-xl, close button
// 36px-visual/44px-tap, subordinate link row, `border-b` divider at the
// same inset; composer: 44px input pill + 44px gradient send circle +
// the disclaimer line) specifically so a chosen ring/meter treatment can be
// ported straight back into those two files without re-deriving any of
// this by eye.
//
// Three modes, selected by `variant`:
// - "avatarRing"    Variant A: a UsageRing drawn around the header avatar,
//                    the avatar itself a real <button> that toggles a
//                    caption line under the title (default revealed, so the
//                    caption is visible without any interaction — content
//                    visible by default, DESIGN.md; the button/hover/focus
//                    affordance is still real, just not required to see the
//                    caption in this static preview).
// - "composerMeter"  Variant C: no ring anywhere in this frame; a hairline
//                    progress bar + right-aligned count sit above the
//                    composer input instead. At `cap` the input's
//                    placeholder changes and both the input and send button
//                    disable.
// - "plain"          Variant B's second half: header only, no ring, no
//                    meter, no composer at all — proves "the sheet header
//                    stays unchanged" when the ring moves to the nav button
//                    instead (rendered by MockBottomNav.tsx, not this file).

import { useState } from "react";
import { ChevronRight, Send, X } from "lucide-react";
import PennyMark from "@/components/PennyMark";
import { BRAND_GRADIENT } from "@/lib/brand";
import UsageRing from "./UsageRing";
import { usageFraction, usageIsAmber, type UsageData, type UsageState } from "./fixtures";

function UsageCaption({ state, data }: { state: UsageState; data: UsageData }) {
  if (state === "cap") {
    return <>Monthly Penny messages used. Top up or wait until 1 Oct.</>;
  }
  if (state === "unlimited") {
    return <>No monthly limit on the {data.tier} tier.</>;
  }
  return (
    <>
      <span className="money">{data.used}</span> of <span className="money">{data.limit}</span> messages this month
    </>
  );
}

function ThreadStub() {
  return (
    <div className="flex-1 min-h-0 px-5 py-4 space-y-3">
      <div className="ml-auto max-w-[75%] rounded-2xl rounded-br-md bg-indigo-600 text-white px-3.5 py-2 text-[13px] leading-snug">
        Can I spend £40 this weekend?
      </div>
      <div className="max-w-[85%] text-[13px] leading-relaxed text-slate-700 dark:text-slate-200 px-1">
        Yes, that leaves your Safe-to-Spend on track for this pay period.
      </div>
    </div>
  );
}

function Header({
  variant,
  state,
  data,
}: {
  variant: "avatarRing" | "composerMeter" | "plain";
  state: UsageState;
  data: UsageData;
}) {
  const [revealed, setRevealed] = useState(true);
  const showRing = variant === "avatarRing";
  const hasRing = showRing && data.limit != null;

  const avatar = (
    <span
      className="rounded-xl flex items-center justify-center flex-shrink-0"
      style={{ background: BRAND_GRADIENT, width: 28, height: 28 }}
    >
      <PennyMark size={13} className="text-white" />
    </span>
  );

  return (
    <div className="flex-shrink-0 pt-3">
      <div className="flex items-center justify-between gap-2 px-5">
        <div className="flex items-center gap-2 min-w-0">
          {showRing ? (
            <button
              type="button"
              onClick={() => setRevealed((v) => !v)}
              aria-pressed={revealed}
              aria-label="Toggle Penny message allowance"
              className="relative flex-shrink-0 flex items-center justify-center rounded-full active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              style={{ width: 36, height: 36 }}
            >
              {hasRing && (
                <UsageRing
                  id={`avatar-ring-${state}`}
                  size={36}
                  strokeWidth={2.5}
                  used={data.used}
                  limit={data.limit}
                  className="absolute inset-0"
                />
              )}
              {avatar}
            </button>
          ) : (
            avatar
          )}
          <h2 className="text-[16px] font-bold text-slate-900 dark:text-slate-100 truncate">Ask Penny</h2>
        </div>
        <button
          type="button"
          aria-label="Close"
          className="w-9 h-9 min-w-[44px] min-h-[44px] -m-2.5 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 active:scale-90 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <X size={15} className="text-slate-500 dark:text-slate-400" />
        </button>
      </div>

      {showRing && revealed && (
        <p className="mt-1.5 px-5 text-[12px] leading-snug text-slate-500 dark:text-slate-400">
          <UsageCaption state={state} data={data} />
        </p>
      )}

      <div className="mt-2 flex items-center gap-3 px-5">
        <span className="inline-flex items-center gap-0.5 min-w-0 min-h-[44px] text-[12px] font-medium text-slate-500 dark:text-slate-400">
          <span className="truncate">Your plan and updates</span>
          <ChevronRight size={12} aria-hidden="true" className="flex-shrink-0" />
        </span>
      </div>
      <div className="border-b border-slate-200/70 dark:border-slate-700 mt-1" />
    </div>
  );
}

function ComposerMeter({ state, data }: { state: UsageState; data: UsageData }) {
  if (data.limit == null) return null; // meter disappears entirely on an uncapped tier
  const pct = usageFraction(data);
  const amber = usageIsAmber(data);
  return (
    <div className="px-5 mb-1.5">
      <div className="flex items-baseline justify-end mb-1">
        <span className="text-[11px] leading-none text-slate-500 dark:text-slate-400">
          <span className="money">{data.used}</span> of <span className="money">{data.limit}</span>
        </span>
      </div>
      <div className="h-[2px] w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
        <div
          className="h-[2px] rounded-full"
          style={{
            width: `${Math.max(2, pct * 100)}%`,
            background: amber ? "#f59e0b" : BRAND_GRADIENT,
          }}
        />
      </div>
    </div>
  );
}

function Composer({ variant, state, data }: { variant: "avatarRing" | "composerMeter" | "plain"; state: UsageState; data: UsageData }) {
  const atCap = variant === "composerMeter" && state === "cap";
  const placeholder = atCap ? "Penny is resting until 1 Oct" : "Ask Penny: Can I spend £45 this weekend?";
  return (
    <div className="flex-shrink-0 px-5 pt-2 pb-6">
      {variant === "composerMeter" && <ComposerMeter state={state} data={data} />}
      <div className="flex items-center gap-2">
        <input
          type="text"
          disabled={atCap}
          placeholder={placeholder}
          aria-label="Ask Penny a spending question"
          maxLength={160}
          className="flex-1 min-h-[44px] text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 rounded-full px-4 py-2 outline-none border border-slate-200 dark:border-slate-600 focus:border-violet-300 disabled:opacity-60"
        />
        <button
          type="button"
          disabled={atCap}
          aria-label="Ask Penny"
          className="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center disabled:opacity-40 text-white active:scale-95 transition-transform"
          style={{ background: BRAND_GRADIENT }}
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
      <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400 mt-1.5">
        General information, not regulated financial advice.
      </p>
    </div>
  );
}

export default function MockSheetFrame({
  variant,
  state,
  data,
  headerOnly = false,
}: {
  variant: "avatarRing" | "composerMeter" | "plain";
  state: UsageState;
  data: UsageData;
  headerOnly?: boolean;
}) {
  return (
    <div
      className="mx-auto w-full max-w-[420px] glass-sheet rounded-3xl shadow-xl ring-1 ring-black/[0.06] dark:ring-white/[0.12] flex flex-col overflow-hidden"
      style={headerOnly ? undefined : { minHeight: "min(26rem, 65dvh)" }}
    >
      <Header variant={variant} state={state} data={data} />
      {!headerOnly && (
        <>
          <ThreadStub />
          <Composer variant={variant} state={state} data={data} />
        </>
      )}
    </div>
  );
}
