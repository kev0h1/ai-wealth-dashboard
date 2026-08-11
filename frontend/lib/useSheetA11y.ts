"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// Modal contract for bottom sheets: Escape closes, focus moves in on open,
// Tab loops inside, and focus returns to the opener on close (WCAG dialog pattern).
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
    focusables()[0]?.focus();
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
    return () => { document.removeEventListener("keydown", onKey); opener?.focus?.(); };
  }, [el]);

  return ref;
}
