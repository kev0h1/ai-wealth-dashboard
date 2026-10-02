/** Geometry is measured once, from the visible viewport. Never add a native
 * keyboard height to it: a WebView may already have resized itself. */
export type PennyViewport = { top: number; left: number; width: number; height: number; scale: number };

export function pennyViewport(layout: { width: number; height: number }, visual?: Partial<PennyViewport> | null): PennyViewport {
  return {
    top: Math.max(0, visual?.top ?? 0),
    left: Math.max(0, visual?.left ?? 0),
    width: Math.max(1, Math.min(layout.width, visual?.width ?? layout.width)),
    height: Math.max(1, Math.min(layout.height, visual?.height ?? layout.height)),
    scale: visual?.scale ?? 1,
  };
}

export function pennyKeyboardVisible(baselineHeight: number, current: PennyViewport): boolean {
  // Browser chrome and pinch zoom are not a software keyboard.
  return Math.abs(current.scale - 1) < 0.02 && baselineHeight - current.height > 100;
}

/** Gap between the bottom of the layout viewport and the bottom of the visible
 * viewport, in layout-viewport CSS pixels (what `position: fixed; bottom` is
 * measured from). Chrome on Android (resizes-visual) keeps the layout viewport
 * full height, so the keyboard shows up here as a positive gap. iOS Safari
 * scrolls the layout viewport, so `top` (offsetTop) is part of the same
 * sum and is counted exactly once. A WebView that already resized itself has
 * layout height equal to visual height, so the gap is 0 and nothing is added. */
export function pennyBottomInset(layoutHeight: number, visual?: Partial<PennyViewport> | null): number {
  if (!visual || visual.height == null) return 0;
  if (Math.abs((visual.scale ?? 1) - 1) >= 0.02) return 0;
  return Math.max(0, Math.round(layoutHeight - (Math.max(0, visual.top ?? 0) + visual.height)));
}

/** Smallest panel that still shows the header, the question shortcuts, a
 * little conversation and the composer with its caveat. */
export const PENNY_TYPING_MIN_PANEL = 320;

/** Where the panel's top edge sits while the keyboard is open. It stays at its
 * resting position whenever the space above the keyboard allows; it only moves
 * up by the shortfall when it would otherwise squeeze the composer out. Never
 * above the visible area: if the visual viewport has been panned (offsetTop),
 * the header and close control stay at least 8px inside it. */
export function pennyTypingTop(restTop: number | null, visualBottom: number, visualTop = 0, minHeight = PENNY_TYPING_MIN_PANEL): number {
  return Math.round(Math.max(Math.min(restTop ?? Infinity, visualBottom - minHeight), visualTop + 8));
}
