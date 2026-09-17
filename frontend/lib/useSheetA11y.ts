"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// Modal contract for bottom sheets: Escape closes, focus moves in on open,
// Tab loops inside, and focus returns to the opener on close (WCAG dialog pattern).
//
// `{ preventScroll: true }` on both focus() calls below — 2026-08-25, root-
// caused from an owner report on PennySheet.tsx ("it still scrolls to the
// bottom when I click on penny"). Mechanism: this hook's initial
// `focusables()[0]?.focus()` runs in a `useEffect`, which fires the instant
// the ref callback hands it a DOM node — before the browser has painted the
// panel's entrance animation. PennySheet.tsx's old entrance
// (`slideUpSheet`, translate up from `translateY(100%)`, i.e. starting
// fully below the viewport) meant that first frame's `focus()` call landed
// on an element the browser considered off-screen; a plain `.focus()` asks
// the browser to scroll the nearest scrollable ancestor to reveal the
// newly-focused element, and #app-shell has no scroll container of its own
// (see app/globals.css — only `overflow-x: hidden`), so that scroll lands
// on the document (`body`/`html`), i.e. the page behind the sheet jumps to
// the bottom. `preventScroll: true` suppresses exactly that browser
// auto-reveal behaviour and nothing else (the focus/trap/Escape contract is
// unchanged). Every current consumer of this hook (~17 sheets/dialogs, all
// `position: fixed` overlays rendered via `createPortal`) is already fully
// on-screen the moment it mounts or is already visually a floating overlay,
// so there is no case where scrolling the page to reveal the panel was ever
// the intended behaviour — this is a strict fix, not a trade-off. Checked
// components/ConfirmDialog.tsx and components/CommitmentSheet.tsx as
// representative consumers: both are fixed-position, full-viewport-portalled
// dialogs with no reliance on the browser's scroll-into-view. Also applied
// to the focus-restore call on close, for the same reason (the opener was
// already on-screen before the sheet opened; no scroll should be needed to
// return focus to it either).
//
// PennySheet.tsx's own redesign (2026-08-25, floating popover replacing the
// bottom sheet) independently removes the trigger for ITS instance, since
// the new entrance never positions the panel off-viewport — but the gap in
// this shared hook would still exist for every other sheet that opens with
// an off-viewport or transformed entrance, so it's fixed here at the source
// rather than only in the one caller that surfaced it.
// --- H71 opt-in additions: background scroll lock + back-to-close ---------
//
// Both are OFF by default so the existing ~30 call sites (12 named in H71's
// brief plus a handful more found while wiring this in) are behaviourally
// unchanged. A caller opts in with a second argument:
//
//   const panelRef = useSheetA11y<HTMLDivElement>(onClose, { lockScroll: true, backToClose: true });
//
// or, when backToClose is requested, by using the `{ ref, close }` form
// (see the overloads below) and calling `close()` from every affordance
// that closes the sheet (X button, backdrop, Escape) INSTEAD of the raw
// `onClose` — see the `close` doc comment for why that matters.
//
// Scroll lock (`lockScroll`): the naive `body { overflow: hidden }` (still
// used by lib/useLockBodyScroll.ts, a separate, older hook already wired
// into several of these same sheets — see that file) does not reliably
// hold the scroll position on iOS Safari/WKWebView: because the body stays
// in normal flow, the page can still be dragged and, worse, some WebKit
// versions snap it back to the top rather than the offset it was at. The
// fix used here is the standard position-fixed-with-negative-top
// technique: freeze the body at its current visual position by giving it
// `position: fixed; top: -{scrollY}px`, so no scroll gesture has anywhere
// to move it, then on close restore the inline styles and call
// `window.scrollTo(0, scrollY)` to land back exactly where the user was.
// Captures/restores whatever inline styles were already on `body` (rather
// than assuming they were empty), so nested lock/unlock pairs (sheet A
// open, sheet B opens on top of it, B closes, A closes) compose correctly
// as a stack: each lock's cleanup puts the body back exactly how it found
// it, which for a nested lock is the OUTER lock's own fixed/negative-top
// styles, not the page's original ones.
//
// Back-to-close (`backToClose`): opening pushes one history entry; the
// browser or Android hardware back button (both surface as a `popstate`
// event — Capacitor's WebView falls back to native history navigation for
// the hardware back button when nothing else intercepts it, so no
// Capacitor-specific listener is added here: history alone already covers
// it, and adding a second mechanism would just be a second way for the
// two to disagree) closes the sheet via the real `onClose`. Closing
// in-app (X, backdrop, Escape) must go through the `close()` this hook
// returns rather than calling `onClose` directly, because `close()` is
// what turns that tap into `history.back()` — consuming the pushed entry
// through the SAME popstate path a hardware back press takes, so there is
// one close path, not two that can desync. A module-level stack of
// sheet ids (mirroring the existing reference-counted pattern in
// lib/useSheetOpen.ts) means that if sheets are ever nested, a pop only
// closes the innermost one: each instance's popstate handler ignores the
// event unless its own id is the last one pushed. Whatever unmounts a
// sheet WITHOUT going through `close()` or a real back press (a parent
// stops rendering it for some unrelated reason) still needs its entry
// consumed on cleanup, or the next genuine back press on the next page
// would silently do nothing — the exact bug this hook exists to prevent —
// so cleanup calls `history.back()` itself if the entry is still
// unconsumed at that point.
export interface SheetA11yOptions {
  /** Lock background scroll while the sheet is open and restore the exact
   * pre-open scroll offset on close. Off by default. */
  lockScroll?: boolean;
  /** Push a history entry on open; back (hardware/gesture/browser) closes
   * the sheet. Callers MUST route every in-app close (X, backdrop,
   * Escape) through the `close()` this returns instead of calling
   * `onClose` directly once this is on. Off by default. */
  backToClose?: boolean;
}

interface SheetA11yHandle<T extends HTMLElement> {
  ref: (node: T | null) => void;
  /** The one close path when `backToClose` is on: consumes the pushed
   * history entry via `history.back()`, which fires `popstate`, which is
   * what actually calls the real `onClose`. Use this from every close
   * affordance (X, backdrop click, and this hook's own Escape handling
   * already does) rather than calling `onClose` yourself. */
  close: () => void;
}

let sheetHistoryIdSeq = 0;
// Ids of currently-open sheets that pushed a history entry, in push order
// (last = innermost/topmost). Module-level so every hook instance shares
// one stack, the same convention lib/useSheetOpen.ts already uses for its
// open-sheet reference count.
const sheetHistoryStack: string[] = [];

export function useSheetA11y<T extends HTMLElement>(onClose: () => void): (node: T | null) => void;
export function useSheetA11y<T extends HTMLElement>(onClose: () => void, options: SheetA11yOptions): SheetA11yHandle<T>;
export function useSheetA11y<T extends HTMLElement>(
  onClose: () => void,
  options?: SheetA11yOptions
): ((node: T | null) => void) | SheetA11yHandle<T> {
  const [el, setEl] = useState<T | null>(null);
  const ref = useCallback((node: T | null) => setEl(node), []);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const lockScroll = options?.lockScroll ?? false;
  const backToClose = options?.backToClose ?? false;
  // Guards against a double-tap on the close affordance calling
  // history.back() twice before the first popstate has resolved (which
  // would consume two entries instead of one). Reset whenever the
  // backToClose effect below (re)starts, i.e. each time the sheet opens.
  const closingRef = useRef(false);

  // requestClose is what both this hook's own Escape handling and the
  // returned `close()` call — a single implementation for "the user asked
  // to close this sheet", whether or not backToClose is on.
  const requestClose = useCallback(() => {
    if (backToClose) {
      if (closingRef.current) return;
      closingRef.current = true;
      // Triggers `popstate` asynchronously; onCloseRef.current() is called
      // from that handler below, not here, so a hardware back press and an
      // in-app close button end up running the exact same code path.
      history.back();
    } else {
      onCloseRef.current();
    }
  }, [backToClose]);

  useEffect(() => {
    if (!el) return;
    const opener = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(
      el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter(f => !f.hasAttribute("disabled"));
    focusables()[0]?.focus({ preventScroll: true });
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.stopPropagation(); requestClose(); return; }
      if (e.key !== "Tab") return;
      const f = focusables();
      if (f.length === 0) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); opener?.focus?.({ preventScroll: true }); };
  }, [el, requestClose]);

  // Background scroll lock (opt-in). Gated on `el` rather than plain mount
  // so it starts/stops exactly when the panel becomes visible/hidden,
  // matching both consumer shapes in this codebase: sheets a parent
  // conditionally renders at all, and sheets (e.g. ConfirmDialog) that are
  // always mounted but return null internally until `open` flips.
  useEffect(() => {
    if (!el || !lockScroll) return;
    const scrollY = window.scrollY;
    const body = document.body.style;
    const prev = { position: body.position, top: body.top, left: body.left, right: body.right, width: body.width };
    body.position = "fixed";
    body.top = `-${scrollY}px`;
    body.left = "0";
    body.right = "0";
    body.width = "100%";
    return () => {
      body.position = prev.position;
      body.top = prev.top;
      body.left = prev.left;
      body.right = prev.right;
      body.width = prev.width;
      window.scrollTo(0, scrollY);
    };
  }, [el, lockScroll]);

  // Back-to-close (opt-in). See the file header comment above for the
  // full reasoning; in short, one pushed history entry per open sheet,
  // popstate closes only the innermost one, and cleanup consumes an
  // unconsumed entry itself so a later back press never lands on a
  // dangling one.
  useEffect(() => {
    if (!el || !backToClose) return;
    closingRef.current = false;
    const id = `sheet-${++sheetHistoryIdSeq}`;
    sheetHistoryStack.push(id);
    history.pushState({ ...(history.state ?? {}), __sheetA11yId: id }, "");
    let consumed = false;

    function onPopState() {
      // Only the topmost (most recently pushed, i.e. innermost) open sheet
      // reacts to a given pop; an outer sheet's listener, if any, just
      // no-ops and waits for its own turn.
      if (sheetHistoryStack[sheetHistoryStack.length - 1] !== id) return;
      consumed = true;
      sheetHistoryStack.pop();
      onCloseRef.current();
    }
    window.addEventListener("popstate", onPopState);

    return () => {
      window.removeEventListener("popstate", onPopState);
      if (!consumed) {
        const idx = sheetHistoryStack.indexOf(id);
        if (idx !== -1) sheetHistoryStack.splice(idx, 1);
        // Unmounted without a pop ever consuming our entry (e.g. some
        // other state change stopped rendering this sheet without going
        // through `close()`). Consume it now so it doesn't dangle — the
        // listener above is already removed, so this does not re-trigger
        // onClose a second time for THIS sheet. Known limitation, left
        // for H72 to check per sheet: if another sheet is simultaneously
        // open and nested inside this one, the popstate this triggers
        // will land on whatever is now the topmost entry in
        // sheetHistoryStack, i.e. that other sheet, and close it too,
        // since a real browser history entry is genuinely being consumed
        // here and popstate carries no way to say "this pop doesn't count
        // for anyone". Harmless for a sheet with no nested child (true of
        // ItemDetailSheet today), but worth the same explicit check H72
        // already calls for before turning this on for a sheet that can
        // have another sheet open inside it.
        history.back();
      }
    };
  }, [el, backToClose]);

  if (options) return { ref, close: requestClose };
  return ref;
}
