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
//    session. Deferred via `hasOpenedRef` (see below): PennyConversation
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
// 5. `useKeyboardInset()` attaches `visualViewport` resize/scroll listeners
//    — cheap individually, but this shell mounts once at app boot, so an
//    unconditional call would keep them attached (and re-rendering this
//    component on every keystroke-adjacent keyboard show/hide ANYWHERE in
//    the app, not just while this sheet is open) for the entire session.
//    Deferred the same way PennyConversation itself is: only called once
//    `hasOpened`, via a tiny wrapper component so the hook still obeys the
//    Rules of Hooks (no conditional hook calls in this component itself).
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
//         app/layout.tsx, same as this sheet), InsightsPage's share sheet,
//         and BudgetPage's own (older, page-scoped) Penny chat FAB+panel —
//         crowded enough already that landing on it too would just trade
//         one DOM-order gamble for another
//   z-[65]/z-[70] the established sheet backdrop/panel tier — CommitmentSheet,
//         and ~15 other sheets across the app
//   z-[70] also ConfirmDialog, AccountsPage's modals, PlanningPage's tooltip
//   z-[80] SpendPage's toast alerts (highest tier in the app)
// z-[56]/z-[58] sits with clear room above BottomNav (z-50, so the sheet
// reads as in front of the rail) and clear room below the crowded z-[60]
// tier and the established z-[65]/z-[70] sheet tier. Concretely: this
// sheet's own backdrop/panel (56/58) are both LOWER than CommitmentSheet's
// (65/70), so when CommitmentSheet opens from inside this sheet, it wins
// by actual z-index — a real ordering guarantee, not a DOM-order one.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, ChevronRight } from "lucide-react";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useSheetA11y } from "@/lib/useSheetA11y";
import PennyMark from "@/components/PennyMark";
import PennyConversation from "@/components/PennyConversation";
import { BRAND_GRADIENT } from "@/lib/brand";
import { getPennyScreenConfig } from "@/lib/pennyScreenConfig";
import { usePennySheetState } from "./PennySheetProvider";
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

/** On-screen keyboard avoidance — same technique as components/BankPickerSheet.tsx
 * (visualViewport shrinks when the keyboard appears; window.innerHeight does
 * not), ported locally same as the design preview did, pushing the whole
 * panel up via margin-bottom rather than resizing it. */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}

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

/** Reports the on-screen keyboard inset via `onChange`, only while mounted
 * — see this file's header comment, point 5. Mounted/unmounted on the same
 * `isOpen` cadence as <SheetEffectsGate />; kept as its own component
 * (rather than folded into that one) because it needs to report a value
 * OUT to the panel's own `marginBottom`, not just run a side effect.
 * Resets to 0 on unmount (close) rather than leaving whatever the keyboard
 * inset happened to be the moment the sheet closed — otherwise a REOPEN,
 * before the visualViewport fires its first fresh event, would briefly
 * apply a stale margin left over from the previous time the keyboard was
 * up. */
function KeyboardInsetGate({ onChange }: { onChange: (inset: number) => void }) {
  const inset = useKeyboardInset();
  useEffect(() => { onChange(inset); }, [inset, onChange]);
  useEffect(() => () => onChange(0), [onChange]);
  return null;
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
  // gets set are TaxPennyEntry.tsx / ScenarioPage.tsx / Planning's prompt
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

  // SSR guard — createPortal needs `document`, which doesn't exist on the
  // server. Defaulting `mounted` to true (as the design preview's own
  // header comment flags it once did) would try to portal during SSR; this
  // flips true a tick after the client mounts instead, same fix that
  // preview settled on. This gate only ever runs once, at first client
  // mount — it does not re-run on open/close, so it can't be the thing
  // that tears PennyConversation down.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Deferred mount for PennyConversation — see header comment point 1.
  // Set synchronously in the render body (a documented React exception,
  // same pattern useSheetA11y.ts itself uses for `onCloseRef.current =
  // onClose`), NOT in a useEffect: an effect-based flip would land one
  // render after `isOpen` first goes true, so the sheet would visibly open
  // with an empty body for a frame, and a same-open `askContext.ask` would
  // have to wait a tick to even have a mounted component to fire from.
  // Idempotent under React 18 Strict Mode's double-render (setting `true`
  // when already `true` changes nothing), so it's safe here.
  const hasOpenedRef = useRef(false);
  if (isOpen) hasOpenedRef.current = true;
  const hasOpened = hasOpenedRef.current;

  const panelRef = useSheetA11y<HTMLDivElement>(close);
  // Reported by <KeyboardInsetGate />, not called directly here — see this
  // file's header comment, point 5, for why the hook itself can't just be
  // called unconditionally in this component's body.
  const [keyboardInset, setKeyboardInset] = useState(0);

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
        className={`fixed inset-0 z-[56] bg-transparent ${isOpen ? "" : "hidden"}`}
        onClick={close}
        aria-hidden="true"
      />
      {/* Panel wrapper — fixed, sits ABOVE the raised Penny nav button with
          a gap, not just above the rail. 2026-08-25 owner feedback: "it
          partially covers penny" — the window "grows out of" that button
          (this file's header comment), so covering even the top sliver of
          it breaks the conceit. The old value here, `calc(88px +
          safe-area)`, only cleared the RAIL: it was derived from the rail's
          own geometry (`h-[64px]` grid + a `max(safe-area, 10px)` floor,
          ~74px to the rail's top edge on a no-inset device, +14px
          breathing room = 88px) but never accounted for the raised centre
          button, which pokes up ABOVE the rail's top edge on its own.
          Recomputed from BottomNav.tsx's actual button geometry:
            - rail height: 64px (`h-[64px]` on the nav grid)
            - assumed safe-area floor: 10px (the `max(safe-area, 10px)` in
              BottomNav.tsx's `<nav>` style — this flat number bakes in the
              10px branch, same as the old 88px did; real device inset is
              added on top via `env()` below, same idiom as before)
            - button offset above the rail's top edge: 28px (the button is
              `absolute`/`-top-7` — Tailwind's `top-7` is 1.75rem = 28px —
              positioned relative to the rail's own container, and an
              absolutely-positioned element doesn't add to that container's
              flow height, so this is how far it visibly pokes up past the
              rail rather than being clipped)
            - button height: 56px (`w-14 h-14`) — not part of this sum;
              only the TOP of the button (the highest point that must stay
              clear) matters for a bottom-anchored clearance
            - gap requested: 8px, so the window's bottom edge sits just
              above the button's top edge rather than flush against it
            10 (floor) + 64 (rail) + 28 (button poke-up) + 8 (gap) = 110.
          Verify: with no safe-area inset, the button's own top-to-viewport-
          bottom distance is 10 + 64 + 28 = 102px; 110px leaves exactly the
          intended 8px clear above it. `px-3` (12px each side) keeps the
          window off the screen edges horizontally too; nothing about this
          shape should touch a viewport edge the way the old edge-to-edge
          sheet did. If BottomNav.tsx's rail height, button size/offset, or
          floor value ever change, this 110 must be recomputed from the new
          numbers, not nudged by eye.

          TWO ANCHORING MODELS, branched at `lg:` (impeccable review finding,
          HIGH, 2026-08-25): the button-relative math above is a MOBILE-ONLY
          concept — BottomNav.tsx is `lg:hidden`, there is no rail and no
          raised button on desktop for the panel to "grow out of". Below
          `lg`, this stays anchored bottom-centre off the button, full
          bleed-minus-`px-3` width, using the `bottom-[calc(...)]` clearance
          derived above. At `lg` and up, it switches to the OTHER
          established convention for this kind of surface: a fixed
          bottom-right corner popover (`lg:right-6 lg:bottom-6`, a flat 24px
          off both edges — no button geometry to derive from, so no reason
          to inherit the mobile formula), anchored to the new Penny trigger
          in Sidebar.tsx rather than to anything in BottomNav.tsx.
          `lg:inset-x-auto lg:left-auto` cancel the mobile `inset-x-0` (which
          set both `left:0`/`right:0`) so the box stops stretching
          edge-to-edge and instead sizes to its own content (`max-w-[420px]`
          below), positioned purely by `right`/`bottom`. `lg:px-0` drops the
          mobile edge padding, redundant once the box is corner-anchored
          with its own margin from `right-6`/`bottom-6`. Same `max-w-[420px]`
          box, same 65dvh cap, same pop-in animation either way — only the
          anchor point (and, on the inner panel below, the transform-origin
          pivot) changes. */}
      <div
        className={`fixed z-[58] inset-x-0 px-3 bottom-[calc(110px+env(safe-area-inset-bottom,0px))] lg:inset-x-auto lg:left-auto lg:right-6 lg:bottom-6 lg:px-0 ${isOpen ? "" : "hidden"}`}
      >
        {/* `ring-1 ring-black/[0.06] dark:ring-white/[0.12]` (2026-08-25,
            owner: "in dark mode you can't really see the margin of the chat
            window"). Root cause: `.glass-sheet` (app/globals.css) only
            draws a `border-top` — meant for an edge-to-edge bottom sheet,
            where the top edge is the only one that needs separating from
            the page above it — but this shape (this file's own header
            comment) is a fully rounded floating window with no natural top
            edge, so that single border does nothing for a panel that needs
            a boundary on all four sides. In light mode `shadow-xl` alone
            was carrying the edge, faintly; in dark mode a near-black shadow
            over a near-black page is invisible, so the panel had no visible
            boundary at all, exactly what the owner's dark screenshots
            showed. Not a new value: `ring-1 ring-black/[0.06]
            dark:ring-white/[0.12]` is the established codebase pattern for
            exactly this "barely-there in light, quiet-but-visible in dark"
            edge (see e.g. AccountMiniCard.tsx, InvestmentMiniCard.tsx,
            CommitmentSheet.tsx's own icon chips), reused here rather than
            invented. `shadow-xl` stays as the panel's ONE shadow (The One
            Shadow Rule, DESIGN.md — floating elements like this one and the
            Penny FAB are the documented exception allowed a `shadow-xl`);
            there is no established alternate dark-mode shadow token
            anywhere in this codebase to swap it for (checked: no sheet or
            dialog in components/ redefines shadow colour per theme), so the
            ring is the fix, not the shadow. */}
        <div
          ref={isOpen ? panelRef : undefined}
          role="dialog"
          aria-modal="true"
          aria-label="Ask Penny"
          className="mx-auto w-full max-w-[420px] glass-sheet rounded-3xl shadow-xl ring-1 ring-black/[0.06] dark:ring-white/[0.12] flex flex-col transition-[margin] duration-100 origin-bottom lg:origin-bottom-right"
          // Capped to 65dvh — a compact popover, not a page. The panel is a
          // flex column with an indefinite (auto) main size, so it already
          // sizes to its own content (header + chip row + thread +
          // composer) and only grows up to this ceiling; above it, the
          // thread's own `overflow-y-auto` (PennyConversation) scrolls
          // internally rather than the panel growing further — same
          // structural contract as before, just a lower ceiling to match
          // the smaller floating shape.
          //
          // MINIMUM height (2026-08-25, owner: "did the chat window
          // shrink? seems very small"): auto-sizing-to-content cuts both
          // ways — with a short thread (just-opened, or a payday lead plus
          // one turn) the panel shrink-wraps down to almost nothing, and a
          // window that small no longer reads as a chat window. A minimum
          // height pins a floor; the thread pane (`flex-1` in
          // PennyConversation) is the one region that absorbs the slack
          // between the floor and whatever the content actually needs, so
          // short content sits top-aligned in a stable window instead of
          // the window hugging it. The floor is the sum of this panel's
          // actual fixed chrome, not a round number picked by eye:
          //   header (icon/title row, subordinate-links row at its own
          //     min-h-[44px], spacing + divider, pt-3 top pad)   ~104px
          //   chip row (pt-1 + one row of min-h-[28px] chips + pb-1)
          //                                                       ~36px
          //   composer (pt-2 + composerCard's own padding, input
          //     row, disclaimer line + the new pb-6 bottom pad
          //     from the Fix 2 below)                            ~114px
          //   two-to-three compact bubbles + `space-y-3` gaps, the
          //     "reads as a conversation" floor for the thread    ~160px
          //   ------------------------------------------------------
          //   total                                              ~414px
          // ~414px rounds to 26rem (416px) — hence 26rem below.
          //
          // Interplay with the 65dvh cap above: a plain `min-h-[26rem]`
          // CLASS would fight `maxHeight: 65dvh` on any viewport where
          // 65dvh is actually shorter than 26rem (a short landscape phone,
          // e.g. ~380px tall means 65dvh ≈ 247px) — min-height is a floor
          // on the used size and can legally win the flex sizing over a
          // smaller max-height in that case, forcing the panel past the
          // cap or off-screen, the exact failure this fix must not
          // introduce. So the floor is set inline instead, right next to
          // the cap, as `minHeight: "min(26rem, 65dvh)"` — CSS's own
          // `min()` picks whichever is smaller at render time, so the
          // floor never exceeds the ceiling by construction: on a normal
          // phone it resolves to 26rem (the stable-window floor this fix
          // wants), on a short landscape viewport it collapses to the same
          // 65dvh the cap already enforces, and the two values agree
          // instead of racing.
          //
          // Entrance: scale + fade (`pennyPopIn` above), as if growing out
          // of whichever trigger sits underneath it — replaces the old
          // `slideUpSheet` (translate up from fully off-screen). The pivot
          // point is the `origin-bottom lg:origin-bottom-right` classes
          // above, NOT this inline style block (an inline `transformOrigin`
          // would always beat a Tailwind class regardless of breakpoint, so
          // it has to live in a class to be `lg:`-overridable at all) —
          // below `lg`, `origin-bottom` (50% 100%) reads as emerging from
          // BottomNav's raised Penny button; at `lg`, `origin-bottom-right`
          // (100% 100%) reads as emerging from Sidebar.tsx's Penny trigger,
          // the corner the popover is now anchored to at that breakpoint
          // (see the outer wrapper's own comment for the anchoring split).
          // This shape change also independently removes one trigger for
          // the "page scrolls to the bottom on open" bug: this panel never
          // starts translated below the viewport (only scaled down and
          // nudged 8px, still within the fixed box's own layout), where
          // `slideUpSheet` used to start at `translateY(100%)` — see
          // lib/useSheetA11y.ts's own comment for the actual root cause and
          // fix (an off-viewport `focus()` call, independent of this shape).
          style={{
            maxHeight: "65dvh",
            minHeight: "min(26rem, 65dvh)",
            marginBottom: keyboardInset,
            ...(isOpen ? { animation: "pennyPopIn 200ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)) backwards" } : {}),
          }}
        >
          {/* Header — shrink-0, stays put while the thread (rendered by
              PennyConversation below) scrolls independently. No drag-handle
              bar: that signalled "sheet", and this isn't one anymore. */}
          <div className="flex-shrink-0 px-4 pt-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: BRAND_GRADIENT, width: 28, height: 28 }}
                >
                  <PennyMark size={13} className="text-white" />
                </span>
                <h2 className="text-[16px] font-bold text-slate-900 dark:text-slate-100 truncate">Ask Penny</h2>
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
            <div className="mt-2 flex items-center gap-3">
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
                Tightened by one spacing step on each side of the seam. */}
            <div className="border-b border-slate-200/70 dark:border-slate-700 mt-1" />
          </div>

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
        </div>
      </div>

      {/* See header comment: both start/stop on `isOpen`'s cadence by
          actually mounting/unmounting, without taking the panel (or
          PennyConversation inside it) down with it. */}
      {isOpen && (
        <>
          <SheetEffectsGate />
          <KeyboardInsetGate onChange={setKeyboardInset} />
        </>
      )}
    </>,
    document.body
  );
}
