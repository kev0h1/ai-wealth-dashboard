"use client";

import { useLayoutEffect } from "react";
import { touchAllowed } from "@/lib/pennyIosPanGuard";

/** While `enabled` (iOS strategy: keyboard up, layout viewport not shrunk),
 * stops the visual viewport panning over the full-height layout viewport:
 * clamps html/body to the visual viewport height, snaps any pan back to the
 * origin, and cancels touch moves that are not a real scroll of the
 * conversation (`[data-penny-scroll]`). Everything is restored on exit. The
 * body scroll lock (acquireScrollLock) is independent and still restores the
 * saved page offset on close. */
export function usePennyIosPanGuard(enabled: boolean): void {
  useLayoutEffect(() => {
    if (!enabled) return;
    const vv = window.visualViewport;
    const html = document.documentElement.style;
    const body = document.body.style;
    const prev = { htmlHeight: html.height, htmlOverflow: html.overflow, bodyHeight: body.height };
    const clamp = () => {
      const height = vv ? vv.height : window.innerHeight;
      html.height = `${height}px`;
      body.height = `${height}px`;
      html.overflow = "hidden";
    };
    const snap = () => {
      clamp();
      if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
    };
    let startY = 0;
    const onStart = (event: TouchEvent) => { startY = event.touches[0]?.clientY ?? 0; };
    const onMove = (event: TouchEvent) => {
      const scroller = document.querySelector<HTMLElement>("[data-penny-window] [data-penny-scroll]");
      const y = event.touches[0]?.clientY ?? startY;
      const allowed = touchAllowed(event.target as Node | null, scroller, scroller?.scrollTop ?? 0, scroller?.scrollHeight ?? 0, scroller?.clientHeight ?? 0, startY - y);
      if (!allowed && event.cancelable) event.preventDefault();
    };
    clamp();
    vv?.addEventListener("resize", snap);
    vv?.addEventListener("scroll", snap);
    window.addEventListener("scroll", snap);
    window.addEventListener("resize", snap);
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    return () => {
      vv?.removeEventListener("resize", snap);
      vv?.removeEventListener("scroll", snap);
      window.removeEventListener("scroll", snap);
      window.removeEventListener("resize", snap);
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      html.height = prev.htmlHeight;
      html.overflow = prev.htmlOverflow;
      body.height = prev.bodyHeight;
    };
  }, [enabled]);
}
