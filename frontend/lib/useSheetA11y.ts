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
export function useSheetA11y<T extends HTMLElement>(onClose: () => void) {
  const [el, setEl] = useState<T | null>(null);
  const ref = useCallback((node: T | null) => setEl(node), []);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!el) return;
    const opener = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(
      el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter(f => !f.hasAttribute("disabled"));
    focusables()[0]?.focus({ preventScroll: true });
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.stopPropagation(); onCloseRef.current(); return; }
      if (e.key !== "Tab") return;
      const f = focusables();
      if (f.length === 0) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); opener?.focus?.({ preventScroll: true }); };
  }, [el]);

  return ref;
}
