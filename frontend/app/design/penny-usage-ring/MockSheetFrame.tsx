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
// real files (header: icon size 28px, close button 36px-visual/44px-tap,
// subordinate link row, `border-b` divider at the same inset; composer:
// 44px input pill + 44px gradient send circle + the disclaimer line)
// specifically so a chosen ring/meter treatment can be ported straight back
// into those two files without re-deriving any of this by eye. ONE
// deliberate departure from that 1:1 copy: the real header avatar chip is
// `rounded-xl` (a rounded square), but every avatar in this preview is
// drawn as a perfect circle instead (Kevin's 2026-09-06 correction, after
// the close-up screenshot showed a circular ring around a square avatar
// reading as an unsymmetrical squircle). If A2 ships, PennySheet.tsx's
// avatar chip needs the matching `rounded-full` change, not just the ring.
//
// Three modes, selected by `variant`:
// - "avatarRing"    Variant A2 (revised 2026-09-06 after Kevin's phone
//                    review of the first pass — see the header-geometry
//                    comment on AvatarRingButton below for what was wrong
//                    and how this fixes it): a ring drawn concentric with
//                    the header avatar. Tapping the avatar crossfades the
//                    header TITLE itself between "Ask Penny" and the usage
//                    line — no separate caption row is added anywhere. At
//                    Cap, the composer borrows Variant C's disabled
//                    placeholder behaviour and adds a "Get more messages"
//                    link on the same disclaimer row (no new row), which
//                    opens the MoreMessagesSheet mock as an overlay on top
//                    of this frame.
// - "composerMeter"  Variant C: no ring anywhere in this frame; a hairline
//                    progress bar + right-aligned count sit above the
//                    composer input instead. At `cap` the input's
//                    placeholder changes and both the input and send button
//                    disable.
// - "plain"          Variant B's second half: header only, no ring, no
//                    meter, no composer at all — proves "the sheet header
//                    stays unchanged" when the ring moves to the nav button
//                    instead (rendered by MockBottomNav.tsx, not this file).

import { useEffect, useState } from "react";
import { ChevronRight, Send, X } from "lucide-react";
import PennyMark from "@/components/PennyMark";
import { BRAND_GRADIENT } from "@/lib/brand";
import MoreMessagesSheet from "./MoreMessagesSheet";
import { usageFraction, usageIsAmber, USAGE_RESET_DATE, type UsageData, type UsageState } from "./fixtures";

// Real header geometry (components/PennySheet.tsx): the avatar chip is
// 28px. Rendered here as a circle, not production's `rounded-xl` square
// (see this file's header comment for why). Everything below is DERIVED
// from that one 28px number plus the brief's own ring spec (radius =
// avatar radius + 3px, 2px stroke), so the ring and the avatar can only
// ever share one centre. See AvatarRingButton's own comment for why
// derivation, not eyeballed placement, is what actually fixes the
// concentricity bug.
const AVATAR_SIZE = 28;
const RING_STROKE = 2;
const RING_RADIUS = AVATAR_SIZE / 2 + 3; // 17
const RING_BOX = (RING_RADIUS + RING_STROKE / 2) * 2; // 36 — smallest square that fits the ring's outer edge
const AVATAR_OFFSET = (RING_BOX - AVATAR_SIZE) / 2; // 4 — same on all four sides, by construction

/** Fixes the two problems in Kevin's phone review of the first Variant A:
 * (1) "not concentric with the avatar" — the old version drew the ring as a
 *     `UsageRing` positioned `absolute inset-0` over a 36px flex-centred
 *     button while the avatar sat in that same button as an ordinary flex
 *     child; both SHOULD have resolved to the same centre, but that made
 *     concentricity an accident of two independent layout algorithms
 *     agreeing, not a guarantee. Here the avatar is embedded via
 *     `<foreignObject>` as an actual CHILD of the same `<svg>` the ring
 *     circles are drawn in, positioned by the same `AVATAR_OFFSET` number
 *     the ring's own radius is derived from — one coordinate system, one
 *     source of truth, so there is no longer a second layout pass that
 *     could disagree with the first.
 * (2) "round line caps... read as a squircle" — `strokeLinecap="round"` is
 *     gone; both circles use the default `butt` cap explicitly, so the
 *     stroke ends flush at its mathematical start/end point instead of
 *     bulging a half-stroke-width past it.
 * (3) A second, separate contributor to the same "squircle" complaint,
 *     found from the first 4x close-up screenshot (2026-09-06): a truly
 *     circular ring drawn around a `rounded-xl` (rounded-square) avatar
 *     reads as unsymmetrical even though the two shapes share a
 *     mathematical centre, because a circle's edge sits a fixed distance
 *     from that centre while a square's does not (corner further out than
 *     midpoint-of-side). Fixed by rendering the avatar itself as a perfect
 *     circle (`borderRadius: "9999px"` below, matching the plain avatar's
 *     `rounded-full` in Header), so the gap between avatar edge and ring
 *     (2px: ring inner edge at radius 16, avatar edge at radius 14) is
 *     identical all the way round rather than only at four points.
 */
function AvatarRingButton({
  state,
  data,
  revealed,
  onToggle,
}: {
  state: UsageState;
  data: UsageData;
  revealed: boolean;
  onToggle: () => void;
}) {
  const hasRing = data.limit != null;
  const pct = usageFraction(data);
  const amber = usageIsAmber(data);
  const circumference = 2 * Math.PI * RING_RADIUS;
  const dashOffset = circumference * (1 - pct);
  const gradientId = `avatar-ring-a2-${state}`;
  const cx = RING_BOX / 2;
  const cy = RING_BOX / 2;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={revealed}
      aria-label="Toggle Penny message allowance"
      className="relative flex-shrink-0 flex items-center justify-center rounded-full active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      // 44px tap target via padding, without growing the row: the button's
      // own box is 44x44 (padding, not margin, is what creates the target)
      // but a matching negative margin pulls the FLOW footprint back down
      // to the ring's own 36px visual size — same optical-correction idiom
      // this file's close button already uses one row up (`-m-2.5` there).
      style={{ width: RING_BOX + 8, height: RING_BOX + 8, margin: -4, padding: 4 }}
    >
      <svg width={RING_BOX} height={RING_BOX} viewBox={`0 0 ${RING_BOX} ${RING_BOX}`} aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#4f46e5" />
            <stop offset="100%" stopColor="#7c3aed" />
          </linearGradient>
        </defs>
        {hasRing && (
          <>
            {/* Track — 12% alpha slate hairline. */}
            <circle cx={cx} cy={cy} r={RING_RADIUS} fill="none" stroke="rgba(148,163,184,0.12)" strokeWidth={RING_STROKE} />
            {/* Progress — starts at 12 o'clock (native SVG start is 3
                o'clock; rotating -90deg about the shared centre moves it),
                fills clockwise as dashoffset shrinks. Amber from 80% used
                through full Cap; gradient below that. Never red — running
                low on chat messages isn't a genuine financial risk
                (DESIGN.md's Red Is Risk Rule). */}
            <circle
              cx={cx}
              cy={cy}
              r={RING_RADIUS}
              fill="none"
              stroke={amber ? "#f59e0b" : `url(#${gradientId})`}
              strokeWidth={RING_STROKE}
              strokeLinecap="butt"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          </>
        )}
        {/* Avatar — a CHILD of this same <svg>, positioned at AVATAR_OFFSET
            on both axes (derived from the same RING_BOX the circles above
            share), not a sibling element laid out by a second, independent
            algorithm. This is what makes concentricity structural rather
            than coincidental — see this component's own doc comment. */}
        <foreignObject x={AVATAR_OFFSET} y={AVATAR_OFFSET} width={AVATAR_SIZE} height={AVATAR_SIZE}>
          <div
            {...{ xmlns: "http://www.w3.org/1999/xhtml" }}
            style={{
              width: AVATAR_SIZE,
              height: AVATAR_SIZE,
              background: BRAND_GRADIENT,
              borderRadius: "9999px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <PennyMark size={13} className="text-white" />
          </div>
        </foreignObject>
      </svg>
    </button>
  );
}

/** Crossfades between two strings in place — both occupy the same grid
 * cell (`gridArea: "1 / 1"`), so the container's own intrinsic size is the
 * union of the two, and swapping which one is visible via opacity never
 * changes that size. This is the "same height and width allocation" the
 * brief asked for, done by overlay rather than a hand-picked min-width. */
function CrossfadeTitle({ base, alt, revealed }: { base: string; alt: string; revealed: boolean }) {
  const shared = "text-[16px] font-bold text-slate-900 dark:text-slate-100 truncate transition-opacity duration-200";
  return (
    <span className="inline-grid" style={{ display: "grid" }}>
      <span style={{ gridArea: "1 / 1" }} className={`${shared} ${revealed ? "opacity-0" : "opacity-100"}`} aria-hidden={revealed}>
        {base}
      </span>
      <span style={{ gridArea: "1 / 1" }} className={`${shared} ${revealed ? "opacity-100" : "opacity-0"}`} aria-hidden={!revealed}>
        {alt}
      </span>
    </span>
  );
}

function usageLine(data: UsageData): string {
  if (data.limit == null) return "No monthly limit";
  return `${data.used} of ${data.limit} messages`;
}

function Header({
  variant,
  state,
  data,
  tapped,
}: {
  variant: "avatarRing" | "composerMeter" | "plain";
  state: UsageState;
  data: UsageData;
  /** Initial crossfade state, from the preview's own `?tapped=1` — lets a
   * screenshot capture the swapped title without a real tap. */
  tapped: boolean;
}) {
  const [revealed, setRevealed] = useState(tapped);
  const showRing = variant === "avatarRing";

  // Auto-revert ~2.5s after the title swaps to the usage line, whether that
  // swap came from a real tap or from `?tapped=1` on load. Re-tapping while
  // already revealed just hides it again immediately (the effect's cleanup
  // clears the pending timer before scheduling a fresh one).
  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => setRevealed(false), 2500);
    return () => clearTimeout(t);
  }, [revealed]);

  const plainAvatar = (
    <span
      className="rounded-full flex items-center justify-center flex-shrink-0"
      style={{ background: BRAND_GRADIENT, width: AVATAR_SIZE, height: AVATAR_SIZE }}
    >
      <PennyMark size={13} className="text-white" />
    </span>
  );

  return (
    <div className="flex-shrink-0 pt-3">
      <div className="flex items-center justify-between gap-2 px-5">
        <div className="flex items-center gap-2 min-w-0">
          {showRing ? (
            <AvatarRingButton state={state} data={data} revealed={revealed} onToggle={() => setRevealed((v) => !v)} />
          ) : (
            plainAvatar
          )}
          <h2 className="min-w-0">
            {showRing ? (
              <CrossfadeTitle base="Ask Penny" alt={usageLine(data)} revealed={revealed} />
            ) : (
              <span className="text-[16px] font-bold text-slate-900 dark:text-slate-100 truncate">Ask Penny</span>
            )}
          </h2>
        </div>
        <button
          type="button"
          aria-label="Close"
          className="w-9 h-9 min-w-[44px] min-h-[44px] -m-2.5 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 active:scale-90 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <X size={15} className="text-slate-500 dark:text-slate-400" />
        </button>
      </div>

      {/* No caption row — Kevin's phone review, 2026-09-06: the previous
          A "adds a whole new row to a compact header". The usage line now
          only ever appears inside the title itself (CrossfadeTitle above). */}

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

function Composer({
  variant,
  state,
  data,
  onOpenSheet,
}: {
  variant: "avatarRing" | "composerMeter" | "plain";
  state: UsageState;
  data: UsageData;
  onOpenSheet: () => void;
}) {
  const atCap = (variant === "composerMeter" || variant === "avatarRing") && state === "cap";
  const placeholder = atCap ? `Penny is resting until ${USAGE_RESET_DATE}` : "Ask Penny: Can I spend £45 this weekend?";
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
      {/* Disclaimer + (Cap-only, A2-only) "Get more messages" link on the
          SAME row — Kevin's phone review flagged the previous caption row
          for adding a whole extra row to a compact header, so this link
          deliberately does not repeat that mistake down at the composer.
          The link's 44px tap target is padding + a compensating negative
          margin (same idiom as AvatarRingButton above), so the row's
          visual height stays the disclaimer text's own line height. */}
      <div className="flex items-center justify-between gap-2 mt-1.5">
        <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400 min-w-0">
          General information, not regulated financial advice.
        </p>
        {variant === "avatarRing" && atCap && (
          <button
            type="button"
            onClick={onOpenSheet}
            className="flex-shrink-0 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 underline decoration-dotted underline-offset-2 whitespace-nowrap flex items-center justify-center"
            style={{ minHeight: 44, minWidth: 44, padding: "14px 4px", margin: "-14px -4px -14px 0" }}
          >
            Get more messages
          </button>
        )}
      </div>
    </div>
  );
}

export default function MockSheetFrame({
  variant,
  state,
  data,
  headerOnly = false,
  tapped = false,
  initialSheetOpen = false,
}: {
  variant: "avatarRing" | "composerMeter" | "plain";
  state: UsageState;
  data: UsageData;
  headerOnly?: boolean;
  /** `?tapped=1` — renders the A2 header already crossfaded to the usage
   * line, for a screenshot that doesn't need a real click. No-op outside
   * `variant="avatarRing"`. */
  tapped?: boolean;
  /** `state === "cap"` or `?sheet=1` — opens the More Messages sheet as an
   * overlay on top of this mock by default. Still toggleable afterwards via
   * the composer's link / the sheet's own close control. No-op outside
   * `variant="avatarRing"`. */
  initialSheetOpen?: boolean;
}) {
  const [sheetOpen, setSheetOpen] = useState(initialSheetOpen);
  // Follows a `state`/query change to a fresh initial value (e.g. flipping
  // the toolbar from Low to Cap) rather than freezing whatever the sheet's
  // open/closed state happened to be under the previous state.
  useEffect(() => setSheetOpen(initialSheetOpen), [initialSheetOpen]);

  return (
    <div
      className="relative mx-auto w-full max-w-[420px] glass-sheet rounded-3xl shadow-xl ring-1 ring-black/[0.06] dark:ring-white/[0.12] flex flex-col overflow-hidden"
      style={headerOnly ? undefined : { minHeight: "min(26rem, 65dvh)" }}
    >
      <Header variant={variant} state={state} data={data} tapped={tapped} />
      {!headerOnly && (
        <>
          <ThreadStub />
          <Composer variant={variant} state={state} data={data} onOpenSheet={() => setSheetOpen(true)} />
        </>
      )}
      {variant === "avatarRing" && sheetOpen && (
        <div className="absolute inset-0 z-10 flex flex-col justify-end bg-slate-900/40 p-3">
          <MoreMessagesSheet onClose={() => setSheetOpen(false)} />
        </div>
      )}
    </div>
  );
}
