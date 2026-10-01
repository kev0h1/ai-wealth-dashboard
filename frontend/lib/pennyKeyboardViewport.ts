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
