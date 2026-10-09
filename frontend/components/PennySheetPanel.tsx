"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { pennyDeviceLandscape, pennyFillTop } from "@/lib/pennyKeyboardViewport";
import { usePennyKeyboard } from "@/lib/usePennyKeyboard";
import { usePennyIosPanGuard } from "@/lib/usePennyIosPanGuard";
import { shouldGuard } from "@/lib/pennyIosPanGuard";
import { applyPennyTypingAttribute, pennyNextEngaged, pennyTypingActive } from "@/lib/pennyTyping";
import { PENNY_PANEL_CSS } from "./PennySheetPanel.styles";

/** The production Penny window (G197). It never resizes or relocates because
 * the user taps the input. Once a software keyboard is measured it takes over
 * the visible area once, Codex's approved variant B (G191, 02c22ef4): full
 * width, from just inside the top down to the keyboard top, with the header
 * links and chips hidden so the conversation fills the space and the composer
 * sits on the keyboard. The G196 mechanics hold it there: no reaction to
 * viewport pan or page scroll until the keyboard height genuinely changes, and
 * it returns to its resting geometry, chips back, when the keyboard goes.
 * Parent owns the body portal, backdrop, focus trap and thread lifetime. */
export default function PennySheetPanel({ children, isOpen, panelRef, presentation = "floating" }: {
  children: ReactNode;
  isOpen: boolean;
  panelRef?: Ref<HTMLDivElement>;
  /** G240 design round. "floating" (default) is today's window, unchanged.
   * "fullscreen" is the proposed phone takeover: top safe area to bottom
   * safe area (or the keyboard edge), opaque canvas behind, square edges.
   * Desktop (lg) keeps the floating window either way. No production caller
   * passes "fullscreen" until Kevin approves a variant. */
  presentation?: "floating" | "fullscreen";
}) {
  const fullscreen = presentation === "fullscreen";
  const [composerEngaged, setComposerEngaged] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const [wasOpen, setWasOpen] = useState(isOpen);

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

  const viewport = usePennyKeyboard(isOpen);
  const [landscape, setLandscape] = useState(false);
  useLayoutEffect(() => {
    const read = () => setLandscape(pennyDeviceLandscape({ width: window.screen.width, height: window.screen.height, orientationType: window.screen.orientation?.type }));
    read();
    window.addEventListener("orientationchange", read);
    window.screen.orientation?.addEventListener("change", read);
    return () => { window.removeEventListener("orientationchange", read); window.screen.orientation?.removeEventListener("change", read); };
  }, []);

  const mobile = viewport != null && viewport.width < 1024;
  // Focus alone can mean a hardware keyboard. More importantly, resizing on
  // touch-down moves the input before touch-up and can prevent iOS focusing it.
  // Keep it still until the software keyboard actually reduces the viewport.
  // Retained DOM focus after keyboard dismissal also allows a second tap to
  // reopen typing without needing another focus event.
  const typing = pennyTypingActive({ isOpen, proposed: true, mobile, engaged: composerEngaged, keyboardVisible: Boolean(viewport?.keyboardVisible) });
  useLayoutEffect(() => {
    if (!typing) return;
    return applyPennyTypingAttribute(document.documentElement);
  }, [typing]);

  // G211: iOS strategy only (layout viewport kept its height). Android and the
  // app shells (layoutShrank) get none of this.
  const iosGuard = typing && Boolean(viewport?.iosStable) && shouldGuard(Boolean(viewport?.keyboardVisible), Boolean(viewport?.layoutShrank));
  usePennyIosPanGuard(iosGuard);

  const frameStyle = typing && viewport ? {
    "--penny-typing-top": `${pennyFillTop(viewport.top)}px`,
    "--penny-typing-bottom": `${viewport.inset}px`,
    ...(fullscreen ? { "--penny-fs-top": `${Math.max(0, Math.round(viewport.top))}px` } : {}),
  } as CSSProperties : undefined;
  const fsUnderlay = fullscreen && isOpen && mobile && !iosGuard;
  return <><style>{PENNY_PANEL_CSS}</style>{iosGuard && <div className="penny-typing-underlay" data-penny-ios-guard aria-hidden="true" />}{fsUnderlay && <div className="penny-fs-underlay" aria-hidden="true" />}<div
    ref={frameRef}
    data-penny-ios-guard={iosGuard ? "" : undefined}
    data-penny-typing={typing}
    data-penny-window
    data-penny-presentation={fullscreen ? "fullscreen" : undefined}
    data-penny-device={landscape ? "landscape" : "portrait"}
    className={`penny-keyboard-frame ${typing ? "penny-keyboard-typing" : ""} ${fullscreen ? "penny-fs-frame" : ""} ${isOpen ? "" : "hidden"}`}
    style={frameStyle}
  >
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Ask Penny"
      className="penny-keyboard-panel glass-sheet"
      onPointerDownCapture={(event) => {
        // A control tap must complete before the keyboard can dismiss and
        // move that control. Keyboard navigation retains its usual focus.
        if (event.button === 0 && document.activeElement?.matches("[data-penny-input]")
          && (event.target as HTMLElement).closest("button, a")) event.preventDefault();
      }}
      onFocusCapture={(event) => {
        if ((event.target as HTMLElement).matches("[data-penny-input]")) setComposerEngaged(engaged => pennyNextEngaged(engaged, { type: "composer-focus" }));
      }}
      onBlurCapture={(event) => {
        const next = event.relatedTarget as HTMLElement | null;
        // Tab to Send or another dialog control must not move that control
        // underneath an open keyboard. A null blur can be keyboard dismissal;
        // let the measured viewport, rather than blur timing, restore the dock.
        const toOutsideDialog = Boolean(next && !event.currentTarget.contains(next));
        setComposerEngaged(engaged => pennyNextEngaged(engaged, { type: "blur", toOutsideDialog }));
      }}
    >{children}</div>
  </div></>;
}
