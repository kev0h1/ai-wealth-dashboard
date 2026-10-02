"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { pennyTypingTop } from "@/lib/pennyKeyboardViewport";
import { usePennyKeyboard } from "@/lib/usePennyKeyboard";
import { applyPennyTypingAttribute, pennyNextEngaged, pennyTypingActive } from "@/lib/pennyTyping";
import { PENNY_PANEL_CSS } from "./PennySheetPanel.styles";

export type PennyKeyboardLayout = "legacy" | "docked";

/** The actual production window, shared with the previews. `legacy` remains
 * available for any caller that needs the former floating geometry.
 * `docked` (G196) never resizes or relocates the window because the user
 * taps the input: it keeps its resting position, and only once a software
 * keyboard is measured does its bottom edge follow the keyboard so the composer
 * sits directly on it (the top edge moves only if the space would otherwise
 * squeeze the composer out). Parent owns the body portal, backdrop, focus trap
 * and thread lifetime. */
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
  const [composerEngaged, setComposerEngaged] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  // Resting top edge, recorded only while no keyboard is up, so the docked
  // window can keep that edge exactly where it was.
  const restTop = useRef<number | null>(null);
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

  const measureRest = () => {
    const frame = frameRef.current;
    // Never measure the typing geometry as if it were the resting one.
    if (!frame || frame.dataset.pennyTyping === "true" || !frame.getClientRects().length) return;
    restTop.current = frame.getBoundingClientRect().top;
  };
  const viewport = usePennyKeyboard(isOpen && proposed, (keyboardVisible) => { if (!keyboardVisible) measureRest(); });

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

  // After a dismissal the window is back at rest; remember where, for next time.
  useLayoutEffect(() => { if (isOpen && proposed && !typing) measureRest(); });

  const frameStyle = typing && viewport ? {
    "--penny-typing-top": `${pennyTypingTop(restTop.current, viewport.visualBottom)}px`,
    "--penny-typing-bottom": `${viewport.inset}px`,
  } as CSSProperties : undefined;
  const panelStyle: CSSProperties = proposed ? {} : {
    maxHeight: "65dvh", minHeight: "min(26rem, 65dvh)", marginBottom: keyboardInset,
    ...(isOpen ? { animation: "pennyPopIn 200ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)) backwards" } : {}),
  };

  return <>{proposed && <style>{PENNY_PANEL_CSS}</style>}<div
    ref={frameRef}
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
