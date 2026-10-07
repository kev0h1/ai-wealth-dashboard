// A121: the attribute-tracking half of the biometric lock's DOM gate,
// pulled out as a pure, DOM-library-free module so it is testable without a
// browser or jsdom (neither is available in this repo's plain-Node test
// runner — see scripts/app-lock-inert.test.mjs).
//
// components/BiometricLock.tsx is the only caller. While locked, it walks
// document.body's direct children (plus anything a MutationObserver reports
// as appended later — a sheet/toast mounted mid-lock) and calls `lock()` on
// every one of them except its own overlay portal node. `restoreAll()` puts
// back exactly the inert/aria-hidden state each element had before `lock()`
// touched it — critically, an element this tracker never touched (because
// it wasn't a direct child of body, or was the overlay itself) is never
// modified here at all, so something legitimately inert before the lock
// engaged (e.g. components/TipsLine.tsx's own collapsed-panel usage, which
// lives well below body) is left completely alone in both directions.

/** The minimal surface `lock`/`restoreAll` need — real DOM elements satisfy
 *  this structurally, and a test can hand it a plain object instead. */
export interface InertableElement {
  inert: boolean;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

interface PriorState {
  inert: boolean;
  ariaHidden: string | null;
}

export interface InertTracker {
  /** Snapshot + inert one element. No-op if this tracker already touched it
   *  (so a MutationObserver re-reporting the same node, or calling `lock`
   *  twice, never overwrites the ORIGINAL snapshot with an already-inerted
   *  one). */
  lock(el: InertableElement): void;
  /** Put every tracked element back exactly as `lock` found it, then forget
   *  them all. Safe to call with nothing tracked. */
  restoreAll(): void;
  /** True if this tracker itself set the given element's state (used to
   *  decide whether a node reported by a MutationObserver is the tracker's
   *  own doing, not a caller concern in practice but useful for tests). */
  isTracked(el: InertableElement): boolean;
  /** Number of elements currently tracked (locked and not yet restored). */
  size(): number;
}

export function createInertTracker(): InertTracker {
  const tracked = new Map<InertableElement, PriorState>();

  return {
    lock(el) {
      if (tracked.has(el)) return;
      tracked.set(el, { inert: el.inert, ariaHidden: el.getAttribute("aria-hidden") });
      el.inert = true;
      el.setAttribute("aria-hidden", "true");
    },
    restoreAll() {
      for (const [el, prev] of tracked) {
        el.inert = prev.inert;
        if (prev.ariaHidden === null) el.removeAttribute("aria-hidden");
        else el.setAttribute("aria-hidden", prev.ariaHidden);
      }
      tracked.clear();
    },
    isTracked(el) {
      return tracked.has(el);
    },
    size() {
      return tracked.size;
    },
  };
}

/** The lock overlay's own portal node carries this so the tracker (and the
 *  MutationObserver callback in BiometricLock.tsx) can recognise and skip
 *  it structurally, rather than by ref-identity timing. */
export const APP_LOCK_OVERLAY_ATTR = "data-app-lock-overlay";
