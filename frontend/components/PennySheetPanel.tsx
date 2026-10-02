"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { pennyKeyboardVisible, pennyViewport, type PennyViewport } from "@/lib/pennyKeyboardViewport";
import { applyPennyTypingAttribute, pennyNextEngaged, pennyTypingActive } from "@/lib/pennyTyping";
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
  const [composerEngaged, setComposerEngaged] = useState(false);
  const baseline = useRef(0);
  const baselineWidth = useRef(0);
  const [wasOpen, setWasOpen] = useState(isOpen);
  const proposed = layout !== "legacy";

  // The conversation is deliberately kept mounted between closes, so clear
  // keyboard-only state here rather than letting a previous open make a new
  // window look like it is still typing. The input itself keeps its draft in
  // PennyConversation.
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (!isOpen) {
      setComposerEngaged(engaged => pennyNextEngaged(engaged, { type: "close" }));
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
      setViewport({ ...next, keyboardVisible });
    };
    const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(read); };
    baseline.current = 0;
    baselineWidth.current = 0;
    read();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    // Native events request a fresh measurement, not an early takeover.
    // The WebView may not have resized when keyboardWillShow is delivered.
    // Geometry still comes from one viewport, never a second native inset.
    const keyboardEvents = ["keyboardWillShow", "keyboardDidShow", "keyboardWillHide", "keyboardDidHide"];
    keyboardEvents.forEach(name => window.addEventListener(name, update));
    return () => {
      cancelAnimationFrame(frame);
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      keyboardEvents.forEach(name => window.removeEventListener(name, update));
    };
  }, [isOpen, proposed]);

  const mobile = viewport != null && viewport.width < 1024;
  // Focus alone can mean a hardware keyboard. More importantly, resizing on
  // touch-down moves the input before touch-up and can prevent iOS focusing it.
  // Keep it still until the software keyboard actually reduces the viewport.
  // Retained DOM focus after keyboard dismissal also allows a second tap to
  // reopen typing without needing another focus event.
  const typing = pennyTypingActive({ isOpen, proposed, mobile, engaged: composerEngaged, keyboardVisible: Boolean(viewport?.keyboardVisible) });
  useLayoutEffect(() => {
    onTypingChange?.(typing);
    if (!typing) return;
    return applyPennyTypingAttribute(document.documentElement);
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
        // A control tap must complete before the keyboard can dismiss and
        // move that control. Keyboard navigation retains its usual focus.
        if (event.button === 0 && document.activeElement?.matches("[data-penny-input]")
          && (event.target as HTMLElement).closest("button, a")) event.preventDefault();
      } : undefined}
      onFocusCapture={proposed ? (event) => {
        if ((event.target as HTMLElement).matches("[data-penny-input]")) setComposerEngaged(engaged => pennyNextEngaged(engaged, { type: "composer-focus" }));
      } : undefined}
      onBlurCapture={proposed ? (event) => {
        const next = event.relatedTarget as HTMLElement | null;
        // Tab to Send or another dialog control must not move that control
        // underneath an open keyboard. A null blur can be keyboard dismissal;
        // let the measured viewport, rather than blur timing, restore the dock.
        const toOutsideDialog = Boolean(next && !event.currentTarget.contains(next));
        setComposerEngaged(engaged => pennyNextEngaged(engaged, { type: "blur", toOutsideDialog }));
      } : undefined}
    >{children}</div>
  </div></>;
}
