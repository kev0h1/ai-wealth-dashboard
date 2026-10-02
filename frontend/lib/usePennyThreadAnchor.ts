"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";

/** Keeps a Penny thread pinned through a viewport resize only when the
 * reader was already at its latest turn. It is shared by the live sheet and
 * the keyboard preview so the approved interaction is exercised directly. */
export function usePennyThreadAnchor(ref: RefObject<HTMLElement | null>, active: boolean) {
  const followLatestRef = useRef(true);

  const anchorToLatest = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    followLatestRef.current = true;
    element.scrollTop = element.scrollHeight;
  }, [ref]);

  const onScroll = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    followLatestRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
  }, [ref]);

  useEffect(() => {
    const element = ref.current;
    if (!active || !element || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (followLatestRef.current) element.scrollTop = element.scrollHeight;
      });
    });
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [active, ref]);

  return { anchorToLatest, onScroll };
}
