"use client";

import { ReactNode, Ref, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, X } from "lucide-react";
import { useSheetA11y } from "@/lib/useSheetA11y";
import { useSheetOpen } from "@/lib/useSheetOpen";
import { useSwipeDismiss } from "@/lib/useSwipeDismiss";
import { canStartSheetSwipe, shouldBlockPan, sheetSwipeAllowed, type SwipeNode } from "@/lib/sheetSwipe";

export type SheetFrameVariant = "compact" | "focused";
export interface SheetFrameControls {
  close: () => void;
  /** Finish closing this sheet before opening a replacement. */
  closeThen: (next: () => void) => void;
}

/**
 * The approved B sheet shell. It owns the overlay, dialog
 * contract and scroll boundary: header and footer remain fixed while only
 * the task body scrolls. Flows with their own history can opt out of its
 * history entry, while sharing exactly the same visual and focus contract.
 */
export function SheetFrame({
  variant = "focused",
  title,
  description,
  children,
  footer,
  bodyHeader,
  onClose,
  labelledBy,
  themeClass,
  leading,
  onBack,
  backLabel = "Back",
  dismissDisabled = false,
  manageHistory = true,
  onEscape,
  bodyClassName = "px-5 py-5",
  bodyRef,
  panelRef,
  headingRef,
  onClickCapture,
  nested = false,
}: {
  variant?: SheetFrameVariant;
  title: string;
  description?: ReactNode;
  children: ReactNode | ((controls: SheetFrameControls) => ReactNode);
  footer?: ReactNode | ((controls: SheetFrameControls) => ReactNode);
  /** Fixed task controls, between the title and the independently scrolling body. */
  bodyHeader?: ReactNode;
  onClose: () => void;
  labelledBy?: string;
  themeClass?: string;
  leading?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  dismissDisabled?: boolean;
  manageHistory?: boolean;
  onEscape?: () => void;
  bodyClassName?: string;
  bodyRef?: Ref<HTMLDivElement>;
  panelRef?: (node: HTMLElement | null) => void;
  headingRef?: Ref<HTMLHeadingElement>;
  onClickCapture?: React.MouseEventHandler<HTMLElement>;
  /** G136: this frame stacks over another sheet that already dims the page, so it omits its own dim. Everything else (click-catcher, focus trap, history) is unchanged. */
  nested?: boolean;
}) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const reactId = useId();
  const nextRef = useRef<(() => void) | null>(null);
  const [viewport, setViewport] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  useSheetOpen();
  const finishClose = useCallback(() => {
    const next = nextRef.current;
    nextRef.current = null;
    onClose();
    if (next) queueMicrotask(next);
  }, [onClose]);
  const { ref, close: requestClose } = useSheetA11y<HTMLElement>(finishClose, {
    lockScroll: true, backToClose: manageHistory, dismissDisabled, onEscape,
  });
  // Programmatic completion may close during the final saving render. Only
  // user dismissal (X, backdrop, Escape/Back) is disabled during submission.
  const close = requestClose;
  const closeThen = useCallback((next: () => void) => {
    nextRef.current = next;
    requestClose();
  }, [requestClose]);
  // G205: swipe down to dismiss on phones. The drag ends in `close`, the very
  // function the X button calls, so history, focus restore, teardown pops
  // and any confirm-on-close the caller wires into onClose behave the same.
  // dismissDisabled switches the gesture off like it disables the X.
  const handleRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const bodyEl = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const swipe = useSwipeDismiss<HTMLElement>(() => close(), {
    axis: "y", sign: 1, dismissFraction: 0.2, flickVelocity: 0.4,
    fade: false, companionRef: backdropRef, restoreAfterMs: 400,
    canStart: e => !dismissDisabled && sheetSwipeAllowed(e.pointerType ?? "touch", window.innerWidth) && canStartSheetSwipe(
      e.target as unknown as SwipeNode,
      { handle: handleRef.current as unknown as SwipeNode, header: headerRef.current as unknown as SwipeNode, body: bodyEl.current as unknown as SwipeNode },
    ),
  });
  const setPanel = useCallback((node: HTMLElement | null) => {
    ref(node);
    swipe.ref.current = node;
    panelRef?.(node);
  }, [ref, panelRef, swipe.ref]);
  const setBody = useCallback((node: HTMLDivElement | null) => {
    bodyEl.current = node;
    if (typeof bodyRef === "function") bodyRef(node);
    else if (bodyRef) (bodyRef as { current: HTMLDivElement | null }).current = node;
  }, [bodyRef]);
  // A touch that is dragging the sheet must not also pan the page: React's
  // touch listeners are passive, so cancel the browser pan natively.
  useEffect(() => {
    const panel = swipe.ref.current;
    if (!panel) return;
    const block = (e: TouchEvent) => {
      if (shouldBlockPan(e.cancelable, swipe.gestureActive())) e.preventDefault();
    };
    panel.addEventListener("touchmove", block, { passive: false });
    return () => panel.removeEventListener("touchmove", block);
  }, [swipe, mounted]);
  // One visible viewport, never a second keyboard-height padding. This also
  // covers WebViews whose layout viewport has already resized natively.
  useLayoutEffect(() => {
    const visual = window.visualViewport;
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (visual && Math.abs(visual.scale - 1) < 0.02) {
        setViewport({ top: visual.offsetTop, left: visual.offsetLeft, width: visual.width, height: visual.height });
      } else setViewport(null); // Do not counteract the user's pinch zoom.
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    visual?.addEventListener("resize", schedule);
    visual?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      visual?.removeEventListener("resize", schedule);
      visual?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);
  const titleId = labelledBy ?? `sheet-frame-title-${reactId.replace(/:/g, "")}`;
  const mobileHeight = variant === "focused"
    ? "h-[calc(100%-max(1rem,env(safe-area-inset-top,0px)))] lg:h-[85%]"
    : "max-h-[88%]";

  if (!mounted) return null;
  // closeThen reads its ref only when an event invokes it, never while
  // the body/footer render functions receive these controls.
  // eslint-disable-next-line react-hooks/refs
  const renderedBody = typeof children === "function" ? children({ close, closeThen }) : children;
  // eslint-disable-next-line react-hooks/refs
  const renderedFooter = typeof footer === "function" ? footer({ close, closeThen }) : footer;
  return createPortal(
    <div data-sheet-overlay className={`${themeClass ?? ""} fixed inset-0 z-[70] flex items-end justify-center p-0 lg:items-center lg:p-6`} style={viewport ?? undefined}>
      <button ref={backdropRef} type="button" tabIndex={-1} aria-hidden="true" onClick={() => { if (!dismissDisabled) close(); }} className={`absolute inset-0 cursor-default ${nested ? "" : "bg-black/40 fade-in"}`} />
      <section
        data-sheet-frame
        ref={setPanel}
        {...swipe.handlers}
        tabIndex={-1}
        onClickCapture={onClickCapture}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? `${titleId}-description` : undefined}
        className={`glass-sheet relative z-10 flex w-full max-w-[500px] flex-col overflow-hidden rounded-t-3xl border-t border-slate-200 shadow-xl outline-none dark:border-slate-700 dark:shadow-none lg:max-h-[85%] lg:rounded-3xl lg:border [&_button:not([data-compact])]:min-h-11 [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-indigo-500 [&_input:focus-visible]:outline-2 [&_input:focus-visible]:outline-indigo-500 ${mobileHeight}`}
      >
        <div ref={handleRef} data-sheet-handle aria-hidden="true" className="flex h-5 shrink-0 touch-none items-center justify-center lg:hidden"><span className="h-1 w-9 rounded-full bg-slate-300 dark:bg-slate-600" /></div>
        <header ref={headerRef} className="flex shrink-0 touch-none items-start gap-3 border-b border-slate-100 px-5 pb-4 pt-0 dark:border-slate-700 lg:pt-4">
          {onBack && <button type="button" onClick={onBack} disabled={dismissDisabled} aria-label={backLabel} className="-ml-2 -mt-1 flex size-11 shrink-0 items-center justify-center rounded-full text-slate-600 active:scale-95 disabled:opacity-50 dark:text-slate-300"><ChevronLeft size={20} aria-hidden="true" /></button>}
          {leading && <div className="shrink-0">{leading}</div>}
          <div className="min-w-0 flex-1">
            <h2 ref={headingRef} tabIndex={-1} id={titleId} className="break-words text-lg font-bold text-slate-950 outline-none dark:text-slate-50">{title}</h2>
            {description ? <p id={`${titleId}-description`} className="mt-1 text-[13px] leading-5 text-slate-500 dark:text-slate-400">{description}</p> : null}
          </div>
          <button type="button" onClick={close} disabled={dismissDisabled} aria-label={`Close ${title}`} className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500 transition-transform active:scale-95 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-300">
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        {bodyHeader != null && <div data-sheet-body-header className="shrink-0">{bodyHeader}</div>}
        <div ref={setBody} data-sheet-body className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${bodyClassName}`} style={!footer ? { paddingBottom: "max(20px, env(safe-area-inset-bottom, 0px))" } : undefined}>{renderedBody}</div>
        {footer ? <footer data-sheet-footer className="shrink-0 border-t border-slate-100 px-5 pt-3 dark:border-slate-700" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))" }}>{renderedFooter}</footer> : null}
      </section>
    </div>,
    document.body
  );
}
