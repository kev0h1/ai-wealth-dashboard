"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { pennyBottomInset, pennyKeyboardVisible, pennyViewport } from "@/lib/pennyKeyboardViewport";

export type PennyKeyboardState = {
  /** A software keyboard is measured as visible (not toolbar, not pinch zoom). */
  keyboardVisible: boolean;
  /** `fixed; bottom` offset that lands an element on the keyboard. 0 when hidden. */
  inset: number;
  /** Visible viewport bottom in layout-viewport coordinates. */
  visualBottom: number;
  width: number;
};

/** Measures the on-screen keyboard from one source, the visual viewport, and
 * re-measures on its resize and scroll (Chrome pans it, iOS scrolls it), on
 * window resize (WebView shells) and on Capacitor keyboard events, each
 * coalesced to one rAF. The baseline is the largest visible height seen at
 * this width, reset when the width changes (rotation). */
export function usePennyKeyboard(enabled: boolean, onMeasure?: (keyboardVisible: boolean) => void): PennyKeyboardState | null {
  const [state, setState] = useState<PennyKeyboardState | null>(null);
  const baseline = useRef(0);
  const baselineWidth = useRef(0);
  const measure = useRef(onMeasure);
  measure.current = onMeasure;

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
      baselineWidth.current = next.width;
      const keyboardVisible = pennyKeyboardVisible(baseline.current, next);
      measure.current?.(keyboardVisible);
      const inset = keyboardVisible ? pennyBottomInset(layout.height, visual) : 0;
      const visualBottom = layout.height - inset;
      setState(previous => previous && previous.keyboardVisible === keyboardVisible && previous.inset === inset
        && previous.visualBottom === visualBottom && previous.width === next.width
        ? previous : { keyboardVisible, inset, visualBottom, width: next.width });
    };
    const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(read); };
    baseline.current = 0;
    baselineWidth.current = 0;
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
