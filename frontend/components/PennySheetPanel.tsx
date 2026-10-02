"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { pennyKeyboardVisible, pennyViewport, type PennyViewport } from "@/lib/pennyKeyboardViewport";
import { PENNY_PANEL_CSS } from "./PennySheetPanel.styles";

export type PennyKeyboardLayout = "legacy" | "dock" | "focus";

/** The actual production window, shared with the G191 previews. `legacy`
 * remains available for any caller that needs the former floating geometry.
 * Parent owns the body portal, backdrop, focus trap and thread lifetime. */
export default function PennySheetPanel({
  children, isOpen, panelRef, keyboardInset = 0, layout = "legacy", onTypingChange,
}: {
  children: ReactNode;
  isOpen: boolean;
  panelRef?: Ref<HTMLDivElement>;
  keyboardInset?: number;
  layout?: PennyKeyboardLayout;
  onTypingChange?: (typing: boolean) => void;
}) {
  const [viewport, setViewport] = useState<(PennyViewport & { keyboardVisible: boolean }) | null>(null);
  const [focused, setFocused] = useState(false);
  const [nativeKeyboard, setNativeKeyboard] = useState(false);
  const baseline = useRef(0);
  const baselineWidth = useRef(0);
  const sawKeyboard = useRef(false);
  const [didFocus, setDidFocus] = useState(false);
  const [wasOpen, setWasOpen] = useState(isOpen);
  const proposed = layout !== "legacy";

  // The conversation is deliberately kept mounted between closes, so clear
  // keyboard-only state here rather than letting a previous open make a new
  // window look like it is still typing. The input itself keeps its draft in
  // PennyConversation.
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (!isOpen) {
      setFocused(false);
      setNativeKeyboard(false);
      setDidFocus(false);
    }
  }

  useLayoutEffect(() => {
    if (!isOpen || !proposed) return;
    const vv = window.visualViewport;
    let frame = 0;
    const read = () => {
      const next = pennyViewport({ width: window.innerWidth, height: window.innerHeight }, vv ? {
        top: vv.offsetTop, left: vv.offsetLeft, width: vv.width, height: vv.height, scale: vv.scale,
      } : null);
      if (Math.abs(baselineWidth.current - next.width) > 80) baseline.current = next.height;
      else baseline.current = Math.max(baseline.current, next.height);
      baselineWidth.current = next.width;
      const keyboardVisible = pennyKeyboardVisible(baseline.current, next);
      // Android Back and iOS keyboard dismissal can retain DOM focus. Once
      // a keyboard has actually been visible, its disappearance ends the
      // typing layout without blurring or discarding the user's draft.
      if (Math.abs(next.scale - 1) < 0.02) {
        if (sawKeyboard.current && !keyboardVisible) setFocused(false);
        sawKeyboard.current = keyboardVisible;
      }
      setViewport({ ...next, keyboardVisible });
    };
    const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(read); };
    const show = () => setNativeKeyboard(true);
    const hide = () => { setNativeKeyboard(false); setFocused(false); };
    baseline.current = 0;
    baselineWidth.current = 0;
    sawKeyboard.current = false;
    read();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    // Capacitor events are visibility signals only, never a second inset.
    window.addEventListener("keyboardWillShow", show);
    window.addEventListener("keyboardDidShow", show);
    window.addEventListener("keyboardWillHide", hide);
    window.addEventListener("keyboardDidHide", hide);
    return () => {
      cancelAnimationFrame(frame);
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("keyboardWillShow", show);
      window.removeEventListener("keyboardDidShow", show);
      window.removeEventListener("keyboardWillHide", hide);
      window.removeEventListener("keyboardDidHide", hide);
    };
  }, [isOpen, proposed]);

  const mobile = viewport != null && viewport.width < 1024;
  const typing = isOpen && proposed && mobile && (focused || nativeKeyboard || (didFocus && Boolean(viewport?.keyboardVisible)));
  useLayoutEffect(() => {
    onTypingChange?.(typing);
    if (!typing) return;
    const root = document.documentElement;
    const previous = root.getAttribute("data-penny-typing");
    root.setAttribute("data-penny-typing", "true");
    return () => {
      if (previous == null) root.removeAttribute("data-penny-typing");
      else root.setAttribute("data-penny-typing", previous);
    };
  }, [typing, onTypingChange]);

  const frameStyle: CSSProperties | undefined = typing && viewport ? {
    top: viewport.top, left: viewport.left, width: viewport.width, height: viewport.height,
  } : undefined;
  const panelStyle: CSSProperties = proposed ? {} : {
    maxHeight: "65dvh", minHeight: "min(26rem, 65dvh)", marginBottom: keyboardInset,
    ...(isOpen ? { animation: "pennyPopIn 200ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)) backwards" } : {}),
  };

  return <>{proposed && <style>{PENNY_PANEL_CSS}</style>}<div
    data-penny-layout={layout}
    data-penny-typing={typing}
    data-penny-window
    className={proposed ? `penny-keyboard-frame ${typing ? "penny-keyboard-typing" : ""} ${isOpen ? "" : "hidden"}` : `fixed z-[58] inset-x-0 px-3 bottom-[calc(110px+env(safe-area-inset-bottom,0px))] lg:inset-x-auto lg:left-auto lg:right-6 lg:bottom-6 lg:px-0 ${isOpen ? "" : "hidden"}`}
    style={frameStyle}
  >
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Ask Penny"
      className={proposed ? "penny-keyboard-panel glass-sheet" : "relative mx-auto w-full max-w-[420px] glass-sheet rounded-3xl shadow-xl ring-1 ring-black/[0.06] dark:ring-white/[0.12] flex flex-col transition-[margin] duration-100 origin-bottom lg:origin-bottom-right"}
      style={panelStyle}
      onPointerDownCapture={proposed ? (event) => {
        if ((event.target as HTMLElement).matches("[data-penny-input]")) { setDidFocus(true); setFocused(true); }
        // A control tap must complete before the keyboard can dismiss and
        // move that control. Keyboard navigation retains its usual focus.
        if (event.button === 0 && document.activeElement?.matches("[data-penny-input]")
          && (event.target as HTMLElement).closest("button, a")) event.preventDefault();
      } : undefined}
      onFocusCapture={proposed ? (event) => {
        if ((event.target as HTMLElement).matches("[data-penny-input]")) { setDidFocus(true); setFocused(true); }
      } : undefined}
      onBlurCapture={proposed ? (event) => {
        const next = event.relatedTarget as HTMLElement | null;
        setFocused(Boolean(next?.matches("[data-penny-input]")));
      } : undefined}
    >{children}</div>
  </div></>;
}
