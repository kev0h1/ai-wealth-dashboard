"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, X } from "lucide-react";
import { useSheetA11y } from "@/lib/useSheetA11y";
import { useSheetOpen } from "@/lib/useSheetOpen";

export type PreviewFlowView =
  | { kind: "account"; id: string }
  | { kind: "payment" }
  | { kind: "edit-payment" }
  | { kind: "plan"; id: string }
  | { kind: "edit-plan"; id: string };

export interface PreviewFlowNavigation {
  goTo: (view: PreviewFlowView) => void;
  back: () => void;
  close: () => void;
}

interface PreviewFlowSheetProps {
  initialView: PreviewFlowView;
  onClose: () => void;
  renderView: (
    view: PreviewFlowView,
    navigation: PreviewFlowNavigation,
  ) => {
    title: string;
    subtitle?: string;
    leading?: ReactNode;
    body: ReactNode;
    footer?: ReactNode;
  };
}

type FlowEntry = {
  view: PreviewFlowView;
  scrollTop: number;
  focusSelector: string | null;
};

type RestoreTarget = {
  entry: FlowEntry;
  focusHeading: boolean;
};

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950";
const subscribeToHydration = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

function historyPayload(id: string, depth: number) {
  const current = history.state;
  const safeCurrent = current && typeof current === "object" ? current : {};
  return { ...safeCurrent, __previewFlowSheetId: id, __previewFlowDepth: depth };
}

function isOwnedHistoryState(state: unknown, id: string): state is { __previewFlowSheetId: string; __previewFlowDepth: number } {
  return !!state
    && typeof state === "object"
    && (state as { __previewFlowSheetId?: unknown }).__previewFlowSheetId === id
    && Number.isInteger((state as { __previewFlowDepth?: unknown }).__previewFlowDepth);
}

function activeFocusSelector() {
  if (!(document.activeElement instanceof HTMLElement)) return null;
  const named = document.activeElement.closest<HTMLElement>("[data-flow-focus]");
  if (named?.dataset.flowFocus) return `[data-flow-focus="${CSS.escape(named.dataset.flowFocus)}"]`;
  if (document.activeElement.id) return `#${CSS.escape(document.activeElement.id)}`;
  return null;
}

/**
 * Preview-only shell for a continuous Details → Edit flow. The shell is one
 * dialog for its whole lifetime: views exchange content, never portals,
 * backdrops or scroll locks.
 */
export default function PreviewFlowSheet({ initialView, onClose, renderView }: PreviewFlowSheetProps) {
  useSheetOpen();
  const flowId = useId();
  const mounted = useSyncExternalStore(subscribeToHydration, clientSnapshot, serverSnapshot);
  const [view, setView] = useState<PreviewFlowView>(initialView);
  const [depth, setDepth] = useState(0);
  const [motionKey, setMotionKey] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const panelNodeRef = useRef<HTMLDivElement>(null);
  const entriesRef = useRef<FlowEntry[]>([{ view: initialView, scrollTop: 0, focusSelector: null }]);
  const depthRef = useRef(0);
  const closeRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const historyLifecycleRef = useRef({ generation: 0 });
  const restoreRef = useRef<RestoreTarget | null>(null);
  const pointerInputRef = useRef(false);
  const traversalPendingRef = useRef(false);
  const traversalTimerRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const completeClose = useCallback(() => {
    if (closeRef.current) return;
    closeRef.current = true;
    if (traversalTimerRef.current) window.clearTimeout(traversalTimerRef.current);
    traversalPendingRef.current = false;
    const currentState = history.state;
    const steps = isOwnedHistoryState(currentState, flowId) ? currentState.__previewFlowDepth + 1 : 0;
    // We intentionally close synchronously so the parent can unmount the
    // portal. `history.go` consumes the entries without making the previous
    // page briefly visible through an otherwise still-open sheet.
    if (steps > 0) history.go(-steps);
    onCloseRef.current();
  }, [flowId]);

  const requestBack = useCallback(() => {
    if (closeRef.current || traversalPendingRef.current) return;
    if (depthRef.current === 0) {
      completeClose();
      return;
    }
    traversalPendingRef.current = true;
    history.back();
    traversalTimerRef.current = window.setTimeout(() => { traversalPendingRef.current = false; }, 500);
  }, [completeClose]);

  const { ref: a11yPanelRef } = useSheetA11y<HTMLDivElement>(requestBack, { lockScroll: true });
  const panelRef = useCallback((node: HTMLDivElement | null) => {
    panelNodeRef.current = node;
    a11yPanelRef(node);
  }, [a11yPanelRef]);

  const goTo = useCallback((nextView: PreviewFlowView) => {
    if (closeRef.current) return;
    const current = entriesRef.current[depthRef.current];
    if (current) {
      current.scrollTop = scrollRef.current?.scrollTop ?? 0;
      current.focusSelector = activeFocusSelector();
    }
    const nextDepth = depthRef.current + 1;
    entriesRef.current = [
      ...entriesRef.current.slice(0, nextDepth),
      { view: nextView, scrollTop: 0, focusSelector: null },
    ];
    depthRef.current = nextDepth;
    setDepth(nextDepth);
    history.pushState(historyPayload(flowId, nextDepth), "");
    restoreRef.current = { entry: entriesRef.current[nextDepth], focusHeading: true };
    setView(nextView);
    if (pointerInputRef.current && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setMotionKey((key) => key + 1);
    }
  }, [flowId]);

  const navigation: PreviewFlowNavigation = { goTo, back: requestBack, close: completeClose };

  // A pointer-originated view change may use one small continuity cue. Keyboard
  // actions remain instant, and the solid sheet never moves or changes height.
  useEffect(() => {
    const rememberPointerInput = () => { pointerInputRef.current = true; };
    const rememberKeyboardInput = () => { pointerInputRef.current = false; };
    window.addEventListener("pointerdown", rememberPointerInput, true);
    window.addEventListener("keydown", rememberKeyboardInput, true);
    return () => {
      window.removeEventListener("pointerdown", rememberPointerInput, true);
      window.removeEventListener("keydown", rememberKeyboardInput, true);
    };
  }, []);

  useEffect(() => {
    const lifecycle = historyLifecycleRef.current;
    const generation = ++lifecycle.generation;
    closeRef.current = false;
    // React Strict Mode runs setup → cleanup → setup. Its first setup has
    // already put the base marker at the current entry, so the second setup
    // attaches to it instead of adding another invisible Back step.
    const currentState = history.state;
    if (isOwnedHistoryState(currentState, flowId) && entriesRef.current[currentState.__previewFlowDepth]) {
      depthRef.current = currentState.__previewFlowDepth;
      setDepth(currentState.__previewFlowDepth);
    } else {
      depthRef.current = 0;
      setDepth(0);
      history.pushState(historyPayload(flowId, 0), "");
    }

    const onPopState = (event: PopStateEvent) => {
      if (traversalTimerRef.current) window.clearTimeout(traversalTimerRef.current);
      traversalPendingRef.current = false;
      if (closeRef.current) return;
      if (isOwnedHistoryState(event.state, flowId)) {
        const nextDepth = event.state.__previewFlowDepth;
        const entry = entriesRef.current[nextDepth];
        if (!entry) return;
        // Keep later entries until a new `goTo` replaces that branch. This
        // makes the browser Forward control restore a just-left edit view,
        // while a new route from this depth deliberately truncates it.
        depthRef.current = nextDepth;
        setDepth(nextDepth);
        restoreRef.current = { entry, focusHeading: false };
        setView(entry.view);
        return;
      }
      // The base flow entry was popped, so this is the one complete-close
      // route for browser, Android hardware and the sheet's Escape key.
      closeRef.current = true;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPopState);

    return () => {
      window.removeEventListener("popstate", onPopState);
      if (traversalTimerRef.current) window.clearTimeout(traversalTimerRef.current);
      traversalPendingRef.current = false;
      if (closeRef.current) return;
      // A parent can unmount a preview while its sheet is open. Consume only
      // our current history branch, and skip React Strict Mode's test cleanup.
      queueMicrotask(() => {
        if (lifecycle.generation !== generation || closeRef.current) return;
        if (isOwnedHistoryState(history.state, flowId)) history.go(-(history.state.__previewFlowDepth + 1));
      });
    };
  }, [flowId]);

  useLayoutEffect(() => {
    const restore = restoreRef.current;
    if (!restore) return;
    restoreRef.current = null;
    const scrollArea = scrollRef.current;
    if (scrollArea) scrollArea.scrollTop = restore.entry.scrollTop;
    const focusTarget = !restore.focusHeading && restore.entry.focusSelector
      ? panelNodeRef.current?.querySelector<HTMLElement>(restore.entry.focusSelector) ?? headingRef.current
      : headingRef.current;
    focusTarget?.focus({ preventScroll: true });
  }, [view]);

  if (!mounted) return null;

  // The pure render prop only attaches these navigation methods as event
  // handlers. None runs during render; the refs belong to those later events.
  // eslint-disable-next-line react-hooks/refs -- render-prop callback false positive, not a ref read
  const rendered = renderView(view, navigation);
  const isNestedView = depth > 0;

  return createPortal(
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        aria-label="Close details"
        onClick={completeClose}
        className="fixed inset-0 z-[65] cursor-default bg-black/45"
      />

      <div className="pointer-events-none fixed inset-0 z-[70] flex items-end justify-center lg:items-center lg:p-6">
        <section
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${flowId}-title`}
          aria-describedby={rendered.subtitle ? `${flowId}-subtitle` : undefined}
          className="glass-sheet pointer-events-auto flex w-full max-w-lg flex-col rounded-t-3xl border-t border-slate-200 dark:border-slate-700 lg:rounded-3xl lg:border lg:shadow-xl"
          style={{ height: "min(780px, 90dvh)" }}
        >
          <div className="flex shrink-0 justify-center pb-1 pt-3 lg:hidden" aria-hidden="true">
            <span className="h-1 w-10 rounded-full bg-slate-200 dark:bg-slate-600" />
          </div>

          <header className="flex shrink-0 items-start gap-3 px-5 pb-4 pt-2 lg:pt-5">
            {isNestedView && (
              <button
                type="button"
                onClick={requestBack}
                aria-label="Back to details"
                className={`flex size-11 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 active:scale-95 dark:text-slate-300 dark:hover:bg-slate-800 ${focusRing}`}
              >
                <ChevronLeft size={20} aria-hidden="true" />
              </button>
            )}
            {rendered.leading ? <div className={`shrink-0 pt-1 ${isNestedView ? "hidden min-[400px]:block" : ""}`}>{rendered.leading}</div> : null}
            <div className="min-w-0 flex-1 pt-1">
              <h2 ref={headingRef} id={`${flowId}-title`} tabIndex={-1} className="break-words text-lg font-bold leading-6 text-slate-950 outline-none dark:text-white">
                {rendered.title}
              </h2>
              {rendered.subtitle ? <p id={`${flowId}-subtitle`} className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">{rendered.subtitle}</p> : null}
            </div>
            <button
              type="button"
              onClick={completeClose}
              aria-label="Close details"
              className={`flex size-11 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 active:scale-95 dark:text-slate-300 dark:hover:bg-slate-800 ${focusRing}`}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
            <div key={motionKey} className={motionKey ? "preview-flow-view-change" : undefined}>
              {rendered.body}
            </div>
          </div>

          {rendered.footer ? (
            <footer className="shrink-0 border-t border-slate-200 px-5 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-4 dark:border-slate-700">
              {rendered.footer}
            </footer>
          ) : null}
        </section>
      </div>

      <style jsx>{`
        .preview-flow-view-change {
          animation: preview-flow-view-change 150ms cubic-bezier(0.23, 1, 0.32, 1) both;
        }
        @keyframes preview-flow-view-change {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .preview-flow-view-change { animation: none; }
        }
      `}</style>
    </>,
    document.body,
  );
}
