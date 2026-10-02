"use client";

// The sheet shell itself — ported from the approved preview at
// app/design/penny-sheet/PennySheet.tsx (see that file's own header comment
// for the four hard problems it solved: an internally scrolling thread, a
// composer docked by normal flow rather than `position: fixed`, on-screen
// keyboard avoidance, and sheet-over-sheet with CommitmentSheet). This file
// ports those solutions but does NOT import from app/design/* (temporary,
// will be deleted) and does not own a grammar switcher — the bubbles-vs-cards
// decision that route existed to settle is already made; PennyConversation
// renders its own grammar unconditionally now.
//
// SHAPE (2026-08-25 owner rejection): this was originally an edge-to-edge
// bottom sheet — full-width, `rounded-t-3xl`, dark scrim, `.sheet-open` blur
// on the page behind it. The owner tested it on his phone and rejected the
// whole shape in his own words: "in my head a bubble window that would
// appear like it's coming out of penny and sits above it is better, I
// actually don't like this pop up window design at all." This is now a
// FLOATING CHAT WINDOW instead: a margined, `rounded-3xl` (all four corners)
// panel that pops in from the Penny nav button (BottomNav.tsx) with a
// scale+fade entrance, sits with a gap ABOVE the nav rail rather than
// touching the screen edges, and leaves the page behind fully visible — no
// scrim, no blur. The nav stays visible and unobscured underneath; that's
// the point of "sits above it" — the Penny button is what the window reads
// as having come out of. Everything else about this component's mount
// lifecycle (points 1-5 below) is unchanged by the shape redesign; only the
// backdrop/panel markup and the entrance animation changed. See the z-index
// note further down for what replaced the scrim.
//
// The one problem the preview didn't have to solve, because its state lived
// in a throwaway parent that only ever mounted the sheet while `open` was
// true: keeping the conversation's history alive across a close/reopen.
// Production's fix (see PennySheetProvider.tsx's header comment) is to
// render this component unconditionally, for the life of the session, and
// let `isOpen` control CSS visibility only. Four consequences follow, each
// handled below:
//
// 1. <PennyConversation> must NOT mount at the same time this shell does —
//    it fires an authenticated suggestions fetch (api.canISuggestions()) on
//    its own mount, and this shell mounts once at app boot for every
//    session. Deferred via `hasOpened` (see below): PennyConversation
//    only enters the tree on the FIRST real open, and — because that flag
//    is set synchronously in the render body rather than in an effect — it
//    mounts in the very same render pass `isOpen` first flips true, not one
//    tick later. That matters for `askContext.ask`: PennyConversation's own
//    one-shot "submit on open" effect can only fire once it exists, so a
//    caller that opens the sheet WITH a question (Planning/Tax) must not
//    lose a render to an empty panel first. Once mounted it stays mounted
//    for the rest of the session (the flag never resets), which is what
//    keeps the thread alive across every later close/reopen.
// 2. useLockBodyScroll must still start/stop with `isOpen`, not with this
//    component's own mount/unmount (which now only happens once, ever). It's
//    reused unmodified via <SheetEffectsGate />, a zero-output component
//    mounted only while `isOpen`, so the body-scroll lock activates and
//    tears down on the correct cadence without this shell itself
//    remounting. (useSheetOpen — #app-shell's `.sheet-open` blur — used to
//    live in this same gate too; dropped for this shape, see
//    <SheetEffectsGate />'s own doc comment for why.)
// 3. useSheetA11y's focus-trap/Escape/focus-restore also needs to start
//    and stop with `isOpen`, but WITHOUT unmounting the panel (that would
//    take PennyConversation down with it). Its effect is keyed on the DOM
//    node its ref callback receives, not on this component's lifecycle —
//    so instead of conditionally rendering the panel, only the `ref` prop
//    is conditional (`ref={isOpen ? panelRef : undefined}`). Toggling a
//    ref prop between a callback and undefined makes React call the old
//    callback with `null` (running the hook's cleanup) then, when it comes
//    back, call it again with the still-mounted node (running setup) —
//    same start/stop behaviour as a real mount/unmount, without one.
// 4. Sheet-over-sheet (CommitmentSheet, opened from inside PennyConversation
//    via the offer chip) must not depend on DOM order — see the z-index
//    note below, which is the actual stacking contract now. It also isn't
//    at risk from this shell's `pennyPopIn` transform (the scale+fade
//    entrance, replacing the old `slideUpSheet`) — applied only for the
//    200ms entrance itself (`animation-fill-mode: backwards`, see that
//    keyframe's own comment further down for why it's not `both`, i.e. not
//    retained after the entrance completes): a CSS transform on an
//    ancestor establishes a containing block for its `position: fixed`
//    DESCENDANTS, but CommitmentSheet does its own `createPortal(...,
//    document.body)` (components/CommitmentSheet.tsx), so it is never a
//    DOM descendant of this shell's wrapper even while the transform is
//    briefly live — containing blocks follow the DOM tree, not the React
//    tree. If you're reading this because a reviewer flagged that
//    transform: it's already accounted for, the portal is what makes it
//    safe.
// 5. PennySheetPanel owns keyboard geometry while open. G196 docks the composer from one
//    visual viewport; the window itself never resizes on tap.
//
// z-index: click-catcher z-[56], panel z-[58] — same tier numbers as the
// old scrim/panel, only the click-catcher's job changed: it used to BE the
// scrim (dark, `.fade-in`); now it's a transparent full-screen layer that
// exists only to close the window on an outside tap, with no visual
// styling of its own (see the "Glass Sheet" swap below for where the
// blur/dim actually went — nowhere, deliberately). Surveyed every
// `z-[5x]`/`z-[6x]` usage in the app before picking these (none at 55-59, so
// no collision):
//   z-40  safe-top-frost, Sidebar, BottomNav's own scrim (app/layout.tsx,
//         components/Sidebar.tsx, components/BottomNav.tsx)
//   z-50  BottomNav's rail itself; CustomSelect's in-page dropdown
//   z-[60] TutorialModal, TutorialOverlay (both mounted globally in
//         app/layout.tsx, same as this sheet), the old Insights page's share
//         sheet (deleted 2026-09-05 along with that page), and BudgetPage's
//         own (older, page-scoped) Penny chat FAB+panel — crowded enough
//         already that landing on it too would just trade one DOM-order
//         gamble for another
//   z-[65]/z-[70] the established sheet backdrop/panel tier — CommitmentSheet,
//         and ~15 other sheets across the app
//   z-[70] also ConfirmDialog, AccountsPage's modals, PlanningPage's tooltip
//   z-[80] SpendPage's toast alerts (highest tier in this list)
//   z-[999] components/BiometricLock.tsx's lock screen (A121) — deliberately
//         outside/above this whole tier system, not a gap left unreconciled:
//         see that file's own z-index comment for why a privacy lock has to
//         outrank literally everything else on screen, this sheet included.
// z-[56]/z-[58] sits with clear room above BottomNav (z-50, so the sheet
// reads as in front of the rail) and clear room below the crowded z-[60]
// tier and the established z-[65]/z-[70] sheet tier. Concretely: this
// sheet's own backdrop/panel (56/58) are both LOWER than CommitmentSheet's
// (65/70), so when CommitmentSheet opens from inside this sheet, it wins
// by actual z-index — a real ordering guarantee, not a DOM-order one.

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, ChevronRight } from "lucide-react";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useSheetA11y } from "@/lib/useSheetA11y";
import PennyMark from "@/components/PennyMark";
import PennyConversation from "@/components/PennyConversation";
import PennySheetPanel from "@/components/PennySheetPanel";
export { default as PennySheetPanel } from "@/components/PennySheetPanel";
import { BRAND_GRADIENT } from "@/lib/brand";
import { getPennyScreenConfig } from "@/lib/pennyScreenConfig";
import {
  usePennySheetState,
  usePennyUsage,
  refreshPennyUsage,
  useMoreMessagesSheet,
  openMoreMessagesSheet,
  closeMoreMessagesSheet,
} from "./PennySheetProvider";
import MoreMessagesSheet from "@/components/MoreMessagesSheet";
// `screenForPathname` — the same route -> screen mapping BottomNav.tsx's
// own nav uses, and Sidebar.tsx's desktop trigger already reuses from here
// too (one source of truth for "which route means which screen" — see that
// function's own comment in BottomNav.tsx). Importing it here does draw a
// cycle on paper (PennySheetProvider.tsx imports this file's default
// export; this file would import from BottomNav.tsx; BottomNav.tsx imports
// `usePennySheet`/`PennyAskContext` from PennySheetProvider.tsx) — but every
// cross-file reference in that cycle is either a type-only import (erased)
// or a hoisted function declaration that's only ever CALLED from inside
// another function's body (a component's render, an effect), never at
// module-evaluation time, so there's nothing for the cycle to deadlock on:
// by the time any of these functions actually runs, the whole module graph
// has already finished loading. Moving `screenForPathname` out of
// BottomNav.tsx instead would break Sidebar.tsx's own existing import of it
// from there — a file outside this change's ownership — so reusing it
// in place, rather than relocating it, is the smaller and safer change.
import { screenForPathname } from "./BottomNav";

/** Zero-output component whose only job is to start/stop useLockBodyScroll
 * on the same cadence a real mount/unmount would, by actually
 * mounting/unmounting itself with `isOpen` — see this file's header
 * comment, point 2. Kept separate from the panel so the panel (and the
 * PennyConversation instance it hosts) never unmounts alongside it.
 *
 * Deliberately does NOT call useSheetOpen() (which toggles `.sheet-open` on
 * #app-shell — see lib/useSheetOpen.ts — the class that drives the 8px
 * blur/dim in globals.css). That blur is the "Glass Sheet" treatment
 * (DESIGN.md §4): appropriate for a takeover sheet, wrong for a floating
 * window that's meant to leave the page behind fully visible (this file's
 * header comment). CommitmentSheet still calls useSheetOpen() itself
 * (components/CommitmentSheet.tsx) when it opens from inside this window,
 * so the world-blurs-behind-a-takeover-sheet contract is unaffected for
 * that stacked case — only this window's own open/close stopped
 * contributing to it.
 *
 * useLockBodyScroll IS still needed: #app-shell has no `overflow-y` of its
 * own (see app/globals.css — only `overflow-x: hidden`, `min-height:
 * 100dvh`), so the page's real vertical scroll container is the document
 * (`body`/`html`), not #app-shell. A floating window over page content
 * still needs the page underneath to stop scrolling while it's open, same
 * as every other sheet in the app. */
function SheetEffectsGate() {
  useLockBodyScroll();
  return null;
}

// ── PENNY USAGE RING (2026-09-06) — ported from the approved design preview
// (app/design/penny-usage-ring/MockSheetFrame.tsx, variant A2, revised
// 2026-09-06 after Kevin's phone review — see that file's own header
// comment for the two problems that revision fixed: concentricity and the
// squircle-reading avatar). Geometry constants are DERIVED, not eyeballed —
// the ring radius is the avatar radius plus a fixed 3px gap, so the ring and
// the avatar can only ever share one centre; see AvatarRingButton's own
// comment for why the avatar is drawn as a <foreignObject> CHILD of the
// same <svg> the ring circles live in, rather than a sibling positioned by
// a second, independent layout pass. ─────────────────────────────────────
const RING_AVATAR_SIZE = 28; // matches this header's existing avatar chip
const RING_STROKE = 2;
const RING_RADIUS = RING_AVATAR_SIZE / 2 + 3; // 17
const RING_BOX = (RING_RADIUS + RING_STROKE / 2) * 2; // 36
const RING_AVATAR_OFFSET = (RING_BOX - RING_AVATAR_SIZE) / 2; // 4

/** The header avatar, now also the message-allowance ring's tap target.
 * Tapping crossfades the header TITLE (not this button) to the usage line
 * — see CrossfadeTitle below — so this button's own only visual state is
 * `aria-pressed`. No ring at all when `limit` is null (an uncapped tier):
 * see the design preview's UsageRing doctrine for why an uncapped tier
 * draws nothing rather than an empty or full circle. Never red at any fill
 * level (DESIGN.md's Red Is Risk Rule) — amber from 80% used through Cap,
 * the Penny gradient below that. */
function AvatarRingButton({
  used,
  limit,
  revealed,
  onTap,
}: {
  used: number;
  limit: number | null;
  revealed: boolean;
  onTap: () => void;
}) {
  const hasRing = limit != null;
  const pct = limit != null && limit > 0 ? Math.max(0, Math.min(1, used / limit)) : 0;
  const amber = pct >= 0.8;
  const circumference = 2 * Math.PI * RING_RADIUS;
  const dashOffset = circumference * (1 - pct);
  const cx = RING_BOX / 2;
  const cy = RING_BOX / 2;

  return (
    <button
      type="button"
      onClick={onTap}
      aria-pressed={revealed}
      aria-label="Toggle Penny message allowance"
      className="relative flex-shrink-0 flex items-center justify-center rounded-full active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      // 44px tap target via padding (not margin), with a matching negative
      // margin pulling the flow footprint back down to the ring's own 36px
      // visual size — same optical-correction idiom the close button below
      // already uses (`-m-2.5`).
      style={{ width: RING_BOX + 8, height: RING_BOX + 8, margin: -4, padding: 4 }}
    >
      <svg width={RING_BOX} height={RING_BOX} viewBox={`0 0 ${RING_BOX} ${RING_BOX}`} aria-hidden="true">
        <defs>
          <linearGradient id="penny-avatar-ring" x1="0%" y1="0%" x2="100%" y2="100%">
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
                fills clockwise as dashoffset shrinks. Butt caps, not round
                (round caps against a rounded-square avatar is exactly what
                read as a squircle in the first review pass). */}
            <circle
              cx={cx}
              cy={cy}
              r={RING_RADIUS}
              fill="none"
              stroke={amber ? "#f59e0b" : "url(#penny-avatar-ring)"}
              strokeWidth={RING_STROKE}
              strokeLinecap="butt"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          </>
        )}
        {/* Avatar — a CHILD of this same <svg>, positioned at
            RING_AVATAR_OFFSET on both axes (derived from the same RING_BOX
            the circles above share), not a sibling laid out by a second,
            independent algorithm — this is what makes concentricity
            structural rather than coincidental. `rounded-full` equivalent
            (`borderRadius: "9999px"`) rather than the header's previous
            `rounded-xl` chip: a circular ring around a rounded-SQUARE
            avatar reads as unsymmetrical even when the two shapes share a
            centre (a circle's edge sits a fixed distance from centre, a
            square's corner does not). */}
        <foreignObject x={RING_AVATAR_OFFSET} y={RING_AVATAR_OFFSET} width={RING_AVATAR_SIZE} height={RING_AVATAR_SIZE}>
          <div
            {...{ xmlns: "http://www.w3.org/1999/xhtml" }}
            style={{
              width: RING_AVATAR_SIZE,
              height: RING_AVATAR_SIZE,
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

/** Crossfades the header title between "Ask Penny" and the usage line, both
 * occupying the same grid cell so the swap never shifts layout — ported
 * verbatim from the design preview's own CrossfadeTitle. */
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


/** Shared header for the live window and fixture-safe keyboard previews. */
export function PennySheetHeader({ pennyUsed, pennyLimit, usageRevealed, handleAvatarTap, close, headerLinks }: {
  pennyUsed: number;
  pennyLimit: number | null;
  usageRevealed: boolean;
  handleAvatarTap: () => void;
  close: () => void;
  headerLinks: { label: string; href: string }[];
}) {
  return (
          <div className="flex-shrink-0 pt-3">
            <div className="flex items-center justify-between gap-2 px-5">
              <div className="flex items-center gap-2 min-w-0">
                {/* Avatar + usage ring (2026-09-06, /design/penny-usage-ring
                    variant A2, approved) — replaces the old plain
                    `rounded-xl` chip. See AvatarRingButton's own comment for
                    the geometry and why the avatar is now drawn circular. */}
                <AvatarRingButton used={pennyUsed} limit={pennyLimit} revealed={usageRevealed} onTap={handleAvatarTap} />
                <h2 className="min-w-0">
                  <CrossfadeTitle
                    base="Ask Penny"
                    alt={pennyLimit == null ? "No monthly limit" : `${pennyUsed} of ${pennyLimit} messages`}
                    revealed={usageRevealed}
                  />
                </h2>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="w-9 h-9 min-w-[44px] min-h-[44px] -m-2.5 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 active:scale-90 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <X size={15} className="text-slate-500 dark:text-slate-400" />
              </button>
            </div>
            {/* Subordinate doors out of the sheet — quiet, no gradient (the
                indigo-to-violet gradient belongs to Penny's brand mark
                alone). Screen-aware (lib/pennyScreenConfig.tsx): every
                screen but Home falls back to the original single "Your plan
                and updates" row; Home additionally offers the accounts and
                Mirror doors the owner said "also make sense" from inside
                the sheet. `.slice(0, 3)` is a defensive cap matching the
                config's own contract (max 3) rather than trusting every
                future edit to respect it by eye. Each link closes the sheet
                on the way there so the destination isn't reached while a
                sheet still sits over it. `min-w-0` + `truncate` on each
                link (not `flex-wrap` on the row) is the "truncate rather
                than wrap" rule: three links must stay one line even on a
                narrow phone. */}
            <div data-penny-secondary className="mt-2 flex items-center gap-3 px-5">
              {headerLinks.slice(0, 3).map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={close}
                  className="inline-flex items-center gap-0.5 min-w-0 min-h-[44px] text-[12px] font-medium text-slate-500 dark:text-slate-400 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
                >
                  <span className="truncate">{l.label}</span>
                  <ChevronRight size={12} aria-hidden="true" className="flex-shrink-0" />
                </Link>
              ))}
            </div>
            {/* `mt-1` (was `mt-1.5`) — design review, 2026-08-25: the header
                links row, this divider, and the chip row just below it
                (PennyConversation.tsx's `inSheet` chip row, `pt-0.5` for the
                same reason) read as two separated bands of tap targets
                rather than one utility cluster sitting above the thread.
                Tightened by one spacing step on each side of the seam.
                Full-bleed, no horizontal inset (owner, 2026-09-02: this line
                and the chip row's own `border-b` below it read as different
                lengths) — moving the two rows above onto their own `px-5`
                rather than a shared wrapper `px-4` lets this divider span
                edge to edge, matching PennyConversation.tsx's chip-row
                hairline exactly instead of sitting inset by that wrapper's
                padding. `px-5` (not the old `px-4`) also puts this header on
                the same inset as the chip row, thread and composer below,
                which already standardised on `px-5` on 2026-08-25 (see
                PennyConversation.tsx's composer-wrapper comment) — the
                header was the one row still on the old `px-4`, which is
                what put its content 4px out of line with everything below
                it as well as shortening its own divider. */}
            <div className="border-b border-slate-200/70 dark:border-slate-700 mt-1" />
          </div>
  );
}

export default function PennySheet() {
  const { isOpen, ctx, openSeq, open, close } = usePennySheetState();
  const pathname = usePathname();

  // LIVE THREAD SWITCH ON NAVIGATION (2026-08-26, owner-authorised): with
  // PennyConversation's per-screen thread buckets (see that file's header
  // comment, "PER-SCREEN THREADS"), the visible bucket only ever changes on
  // a fresh `open()` call (a new `openSeq`) — before this effect, the ONLY
  // way to get one was tapping the Penny button again. But nothing stops a
  // user from tapping a NAV TAB (Home/Spend/Planning/Insights) while this
  // floating window is already open: BottomNav.tsx's rail stays visible and
  // interactive underneath it by design (this file's header comment,
  // "SHAPE" — no scrim, page fully present), and those tab `<Link>`s don't
  // close the sheet. Without this effect, the window would keep showing
  // whichever screen it was opened over while the page underneath had
  // already moved on — exactly the "old thread over a new page" confusion
  // per-screen threads exist to kill.
  //
  // GUARDED to fire only on a genuine screen CHANGE (`screen !==
  // ctx?.screen`), not on every render this pathname happens to be stable
  // for. This is also what keeps it from looping: `open()` always
  // reassigns the module-level `sheetState` and notifies every subscriber
  // (PennySheetProvider.tsx), which re-renders this component — but that
  // re-render doesn't change `pathname` or `isOpen` (this effect's only
  // dependencies), so the effect itself does not re-run; it only reads the
  // freshly-updated `ctx` the NEXT time one of those two actually changes.
  // Concretely: the call sets `ctx.screen` to the same value this effect
  // just computed, so even if something else forced a re-check, the
  // condition would already be false. There is no path from calling
  // `open()` here back into a reason to call it again with the same inputs.
  //
  // Does NOT fire while closed (`!isOpen` guard) — there is no visible
  // bucket to switch for a closed sheet, and `close()` deliberately doesn't
  // reset `ctx` (PennySheetProvider.tsx), so `ctx?.screen` still holds
  // whatever screen the sheet was last open over. Without this guard,
  // simply navigating around the app with the sheet closed would silently
  // spam `open()` calls (and `openSeq` bumps nothing asked to see) on every
  // route change, forever, for the whole session.
  //
  // Does NOT clobber a pending `askContext.ask`: the only ways `ctx.ask`
  // gets set are ScenarioPage.tsx / Planning's prompt
  // bar calling `open({ screen, ask })` directly from a click — a distinct
  // `open()` call this effect never races, since it isn't triggered by a
  // pathname change at all. The other route into `ctx.ask` being live is a
  // sheet-internal `link` chip (PennyConversation.tsx's `LinkChip`
  // `onTap`), which calls `closePennySheet()` BEFORE `router.push(...)` —
  // so by the time THAT pathname change reaches this effect, `isOpen` is
  // already `false` and it no-ops. The only pathname changes this effect
  // ever actually acts on are nav-tab taps while the sheet stays open, and
  // `screenForPathname` alone never carries an `ask` — so this can only
  // ever open a plain screen switch, never re-fire or override a one-shot
  // question someone else set up.
  useEffect(() => {
    if (!isOpen) return;
    const screen = screenForPathname(pathname);
    if (screen !== ctx?.screen) open({ screen });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, isOpen]);

  // Derived fresh on every render from the CURRENT `ctx` (not cached in a
  // ref/state) so the header links follow the screen the sheet opened over
  // THIS time, not whatever screen was active the first time this
  // (session-long, never-remounted — see header comment point 1) component
  // ever rendered. `ctx?.screen` covers the one real case where `ctx` is
  // `undefined`: PennySheetProvider's initial state before any `open()`
  // call, which getPennyScreenConfig treats the same as "other".
  const headerLinks = getPennyScreenConfig(ctx?.screen).headerLinks;

  // Portals require a client document; this gate does not change on close.
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);

  // Deferred mount for PennyConversation — see header comment point 1.
  // Adjust this component's state before committing its first open, then
  // retain the conversation, drafts and replies for the entire session.
  const [hasOpened, setHasOpened] = useState(false);
  if (isOpen && !hasOpened) setHasOpened(true);

  const panelRef = useSheetA11y<HTMLDivElement>(close);

  // ── PENNY USAGE RING state (2026-09-06) ───────────────────────────────
  const usage = usePennyUsage();
  const moreMessagesOpen = useMoreMessagesSheet();
  const [usageRevealed, setUsageRevealed] = useState(false);
  // Auto-revert ~2.5s after the title crossfades to the usage line, same
  // duration as the approved design preview. Re-tapping cancels the pending
  // timer and schedules a fresh one (the cleanup below runs before the next
  // effect body).
  useEffect(() => {
    if (!usageRevealed) return;
    const t = setTimeout(() => setUsageRevealed(false), 2500);
    return () => clearTimeout(t);
  }, [usageRevealed]);
  // Fetch /subscription whenever the sheet opens — shared with the
  // composer's resting state via the PennySheetProvider singleton (see that
  // file's own comment on why this lives there rather than in local state).
  useEffect(() => {
    if (isOpen) refreshPennyUsage();
  }, [isOpen]);
  /** First tap reveals the usage line in the title; a SECOND tap while
   * already revealed opens the More Messages sheet instead of just hiding
   * it again — this is what makes "tap the title while it shows the count"
   * (the brief's own words) an actual door to that sheet, not only a
   * toggle. Letting the 2.5s auto-revert run its course without a second
   * tap still just hides the count, same as the design preview. */
  function handleAvatarTap() {
    if (usageRevealed) {
      setUsageRevealed(false);
      openMoreMessagesSheet();
    } else {
      setUsageRevealed(true);
    }
  }
  const pennyLimit = usage.info?.usage.penny_limit ?? null;
  const pennyUsed = usage.info?.usage.penny_messages ?? 0;

  if (!mounted) return null;

  return createPortal(
    <>
      {/* Local keyframes for the pop-in entrance — kept component-scoped
          (same pattern as components/Spinner.tsx's `@keyframes spin`)
          rather than added to app/globals.css, since this animation
          belongs to this one surface. The blanket reduced-motion rule
          (globals.css, `*, *::before, *::after { animation-duration:
          0.01ms !important }`) already neutralises it without a JS
          `matchMedia` check here — verified, not duplicated. */}
      {/* Fill mode is `backwards`, not `both` (owner report, 2026-08-25: "when
          I deleted the chips the chat got a bit blurry like it was
          rendering something"). Investigated and confirmed: with `both`,
          the animation's FINAL keyframe style (`transform: scale(1)
          translateY(0)`) is retained on the panel forever after the
          200ms entrance finishes, because `both` = `forwards` + `backwards`.
          A retained `transform` (even the identity one) promotes the panel
          to its own composited layer; on Android Chrome, when that layer's
          box then resizes — e.g. the chip row disappearing when the last
          chip is dismissed/asked (PennyConversation.tsx) — the browser
          re-rasterises the cached layer at the new size instead of just
          reflowing it, which is exactly the transient text fuzziness
          reported. Confirmed `.glass-sheet` (app/globals.css) is a plain
          solid fill with no `backdrop-filter` at all in this build (the
          Android-WebView fallback rule made it permanent, see that file's
          own comment) and nothing on this panel sets `will-change`, so
          those were ruled out — the retained transform is the cause.
          `backwards` still applies the FROM keyframe (scale 0.92,
          translateY 8px, opacity 0) before the animation starts, so the
          entrance itself is unchanged, but it does NOT hold the TO
          keyframe's styles after the animation ends — the panel reverts to
          its underlying (unanimated) CSS, which is safe here specifically
          because that underlying state already equals the animation's end
          state: this element sets no `transform`/`opacity` utility classes
          of its own, so its natural resting transform is `none` (visually
          identical to `scale(1) translateY(0)`) and its natural opacity is
          1. So switching fill modes is a no-op on the settled appearance
          and removes the leftover composited layer. Reduced-motion is
          unaffected: globals.css's blanket `animation-duration: 0.01ms
          !important` still collapses this to a near-instant flash either
          way; `backwards` just means that flash doesn't leave a transform
          behind afterwards either. */}
      <style>{`@keyframes pennyPopIn { from { transform: scale(0.92) translateY(8px); opacity: 0; } to { transform: scale(1) translateY(0); opacity: 1; } }`}</style>

      {/* Click-catcher — transparent, closes the window on an outside tap.
          NOT a scrim: the owner's rejected the takeover-sheet shape and its
          dark backdrop outright (this file's header comment), so the page
          behind must read as fully present, not dimmed. Replaces the old
          `bg-black/25 fade-in` backdrop div one-for-one at the same z-tier;
          see the z-index note further up this file for why the tier itself
          didn't need to move. */}
      <div
        className={`fixed inset-0 z-[56] touch-none bg-transparent ${isOpen ? "" : "hidden"}`}
        onClick={close}
        aria-hidden="true"
      />
      <PennySheetPanel isOpen={isOpen} panelRef={isOpen ? panelRef : undefined}>
          {/* Header — shrink-0, stays put while the thread (rendered by
              PennyConversation below) scrolls independently. No drag-handle
              bar: that signalled "sheet", and this isn't one anymore.
              Horizontal inset moved off this wrapper (was `px-4`) and onto
              the two rows below individually (`px-5` each) so the divider
              two comments down can run full-bleed — see that comment. */}
          <PennySheetHeader pennyUsed={pennyUsed} pennyLimit={pennyLimit} usageRevealed={usageRevealed}
            handleAvatarTap={handleAvatarTap} close={close} headerLinks={headerLinks} />

          {/* Body — PennyConversation owns its own internally-scrolling
              thread and its non-fixed, flow-docked composer when `inSheet`
              is set (see this file's header comment, and the note on the
              PennySheet.tsx docstring in app/design/penny-sheet about why a
              `position: fixed` composer, correct on the full /penny page,
              is wrong here). Rendered only once `hasOpened` — see header
              comment point 1 — then stays mounted for the rest of the
              session regardless of `isOpen`.

              `className="flex-1 min-h-0"` is required, not decorative:
              PennyConversation's own inSheet root sets `h-full` on itself
              (per its doc comment, "the caller must give this component a
              bounded-height box for h-full to resolve against"). A flex
              item with no grow/basis of its own only sizes to its content,
              which `h-full` can't resolve against — this is what turns this
              component into an actual sized flex item of the header/body
              column above, giving `h-full` something definite to be 100%
              of, and letting its own internal thread pane do the
              `overflow-y-auto` scrolling instead of the whole sheet
              growing without bound. */}
          {hasOpened && <PennyConversation inSheet askContext={ctx} askSeq={openSeq} className="flex-1 min-h-0" />}

          {/* More Messages sheet (2026-09-06) — an overlay ON this same
              panel (not a second portal/sheet), opened from the avatar-ring
              crossfade above (second tap while revealed) or the composer's
              own "Get more messages" link (PennyConversation.tsx). Shared
              open/closed state (PennySheetProvider's moreMessagesOpen
              singleton) is what lets both of those different components
              open the identical overlay — see that file's own comment. */}
          {moreMessagesOpen && <MoreMessagesSheet onClose={closeMoreMessagesSheet} />}
      </PennySheetPanel>

      {/* See header comment: scroll locking starts/stops on `isOpen`'s cadence by
          actually mounting/unmounting, without taking the panel (or
          PennyConversation inside it) down with it. */}
      {isOpen && <SheetEffectsGate />}
    </>,
    document.body
  );
}
