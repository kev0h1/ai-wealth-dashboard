"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { pennyBottomInset, pennyDockNext, pennyKeyboardVisible, pennyLayoutShrank, pennyViewport, type PennyDock } from "@/lib/pennyKeyboardViewport";

/** How long after the keyboard appears the dock may still settle. */
const SETTLE_MS = 500;

export type PennyKeyboardState = {
  /** A software keyboard is measured as visible (not toolbar, not pinch zoom). */
  keyboardVisible: boolean;
  /** `fixed; bottom` offset that lands an element on the keyboard. 0 when hidden. */
  inset: number;
  /** Visual viewport offsetTop captured with the dock (fill-once). */
  top: number;
  width: number;
  /** The layout viewport shrank with the keyboard (Android strategy). False on iOS. */
  layoutShrank: boolean;
};

/** Measures the on-screen keyboard from one source, the visual viewport, and
 * re-measures on its resize and scroll (Chrome pans it, iOS scrolls it), on
 * window resize (WebView shells) and on Capacitor keyboard events, each
 * coalesced to one rAF. The baseline is the largest visible height seen at
 * this width, reset when the width changes (rotation). */
export function usePennyKeyboard(enabled: boolean): PennyKeyboardState | null {
  const [state, setState] = useState<PennyKeyboardState | null>(null);
  const baseline = useRef(0);
  const baselineWidth = useRef(0);
  const layoutBaseline = useRef(0);
  const dock = useRef<PennyDock | null>(null);
  const shownAt = useRef(0);

  useLayoutEffect(() => {
    if (!enabled) return;
    const vv = window.visualViewport;
    let frame = 0;
    const read = () => {
      const layout = { width: window.innerWidth, height: window.innerHeight };
      const visual = vv ? { top: vv.offsetTop, left: vv.offsetLeft, width: vv.width, height: vv.height, scale: vv.scale } : null;
      const next = pennyViewport(layout, visual);
      if (Math.abs(baselineWidth.current - next.width) > 80) baseline.current = next.height;
      else baseline.current = Math.max(baseline.current, next.height);
      if (Math.abs(baselineWidth.current - next.width) > 80 || layoutBaseline.current === 0) layoutBaseline.current = layout.height;
      else layoutBaseline.current = Math.max(layoutBaseline.current, layout.height);
      const keyboardVisible = pennyKeyboardVisible(baseline.current, next);
      const layoutShrank = pennyLayoutShrank(layoutBaseline.current, layout.height);
      const inset = keyboardVisible ? pennyBottomInset(layout.height, visual, layoutShrank) : 0;
      const now = performance.now();
      if (keyboardVisible && !dock.current) shownAt.current = now;
      dock.current = pennyDockNext(dock.current, { keyboardVisible, height: next.height, inset, top: next.top }, now - shownAt.current < SETTLE_MS);
      const held = dock.current;
      baselineWidth.current = next.width;
      setState(previous => previous && previous.keyboardVisible === keyboardVisible && previous.inset === (held?.inset ?? 0)
        && previous.width === next.width && previous.layoutShrank === layoutShrank && previous.top === (held?.top ?? 0)
        ? previous : { keyboardVisible, inset: held?.inset ?? 0, top: held?.top ?? 0, width: next.width, layoutShrank });
    };
    const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(read); };
    baseline.current = 0;
    baselineWidth.current = 0;
    layoutBaseline.current = 0;
    dock.current = null;
    read();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    // Native events only request a fresh measurement. The WebView may not have
    // resized when keyboardWillShow is delivered; geometry stays single-source.
    const keyboardEvents = ["keyboardWillShow", "keyboardDidShow", "keyboardWillHide", "keyboardDidHide"];
    keyboardEvents.forEach(name => window.addEventListener(name, update));
    return () => {
      cancelAnimationFrame(frame);
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      keyboardEvents.forEach(name => window.removeEventListener(name, update));
    };
  }, [enabled]);

  return state;
}
