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

/** The layout viewport itself got shorter by a keyboard's worth. Chrome on
 * Android does this under `interactive-widget=resizes-content` (and Capacitor
 * WebViews do it natively): `position: fixed; bottom: 0` is then already the
 * keyboard top. A URL-bar change is far smaller than the 100px threshold. */
export function pennyLayoutShrank(baselineLayoutHeight: number, layoutHeight: number): boolean {
  return baselineLayoutHeight - layoutHeight > 100;
}

/** Gap between the bottom of the layout viewport and the bottom of the visible
 * viewport, in layout-viewport CSS pixels (what `position: fixed; bottom` is
 * measured from). Self-detecting (G196 fill-once): when the layout viewport
 * shrank with the keyboard the gap is 0 by definition, and adding the visual
 * viewport sum on top would count the keyboard twice. Only when the layout
 * viewport kept its height (iOS Safari, which ignores interactive-widget, or
 * an older Chrome) is the gap read from the visual viewport, where iOS's
 * offsetTop is part of the same sum and counted exactly once. */
export function pennyBottomInset(layoutHeight: number, visual?: Partial<PennyViewport> | null, layoutShrank = false): number {
  if (layoutShrank) return 0;
  if (!visual || visual.height == null) return 0;
  if (Math.abs((visual.scale ?? 1) - 1) >= 0.02) return 0;
  return Math.max(0, Math.round(layoutHeight - (Math.max(0, visual.top ?? 0) + visual.height)));
}

/** A keyboard height change smaller than this is not a different keyboard
 * (suggestion strip flicker, sub-pixel rounding). */
export const PENNY_DOCK_REFIT_PX = 24;

export type PennyDock = { key: number; inset: number; top: number };

/** Fill once. The docked geometry is captured when the keyboard becomes
 * visible and then held: visual viewport scroll or pan, page scroll and URL-bar
 * changes never move the panel again. It re-fits only for a genuine keyboard
 * height change (the visible height differs by at least PENNY_DOCK_REFIT_PX),
 * or while `settling` (the first moments after the keyboard appears, when iOS
 * is still panning and Chrome may deliver its final resize late), and it
 * releases when the keyboard goes. */
export function pennyDockNext(
  previous: PennyDock | null,
  measured: { keyboardVisible: boolean; height: number; inset: number; top: number },
  settling: boolean,
): PennyDock | null {
  if (!measured.keyboardVisible) return null;
  const next = { key: measured.height, inset: measured.inset, top: measured.top };
  if (!previous) return next;
  if (settling || Math.abs(previous.key - measured.height) >= PENNY_DOCK_REFIT_PX) return next;
  return previous;
}

/** Top edge of the filled panel: 8px inside the visible area, never above it
 * if the visual viewport has been panned (offsetTop). CSS adds the safe-area
 * top inset. */
export function pennyFillTop(visualTop = 0): number {
  return Math.round(Math.max(0, visualTop) + 8);
}

/** Whether the DEVICE is held landscape. Derived from the screen, never from
 * the layout viewport: under resizes-content a portrait phone with a keyboard
 * up has a short, wide layout viewport that would read as landscape. */
export function pennyDeviceLandscape(screenInfo: { width: number; height: number; orientationType?: string | null }): boolean {
  if (screenInfo.orientationType) return screenInfo.orientationType.startsWith("landscape");
  return screenInfo.width > screenInfo.height;
}
