"use client";

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, X } from "lucide-react";
import { useSheetA11y } from "@/lib/useSheetA11y";
import { useSheetOpen } from "@/lib/useSheetOpen";

export interface UpcomingFlowNavigation<View> {
  goTo(view: View): void;
  back(): void;
  close(): void;
}

export interface UpcomingFlowSheetProps<View> {
  initialView: View;
  onClose(): void;
  renderView(view: View, navigation: UpcomingFlowNavigation<View>): {
    title: string;
    subtitle?: string;
    leading?: ReactNode;
    body: ReactNode;
    footer?: ReactNode;
  };
}

type Entry<View> = { view: View; scrollTop: number; focusSelector: string | null };
const subscribe = () => () => {};
const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950";
const UpcomingFlowFooterContext = createContext<HTMLElement | null>(null);
const UpcomingFlowSubmissionContext = createContext<(busy: boolean) => void>(() => {});
export function useFlowSubmission() { return useContext(UpcomingFlowSubmissionContext); }

/** Projects a form's stable actions into the persistent flow footer. It is a
 * portal within the existing dialog, never a nested dialog or sheet. */
export function UpcomingFlowFooter({ children }: { children: ReactNode }) {
  const target = useContext(UpcomingFlowFooterContext);
  return target ? createPortal(children, target) : null;
}

function owned(state: unknown, id: string): state is { __upcomingFlowId: string; __upcomingFlowDepth: number } {
  return !!state && typeof state === "object"
    && (state as { __upcomingFlowId?: unknown }).__upcomingFlowId === id
    && Number.isInteger((state as { __upcomingFlowDepth?: unknown }).__upcomingFlowDepth);
}

function payload(id: string, depth: number) {
  const state = history.state;
  return { ...(state && typeof state === "object" ? state : {}), __upcomingFlowId: id, __upcomingFlowDepth: depth };
}

function focusSelector() {
  if (!(document.activeElement instanceof HTMLElement)) return null;
  const named = document.activeElement.closest<HTMLElement>("[data-flow-focus]");
  if (named?.dataset.flowFocus) return `[data-flow-focus="${CSS.escape(named.dataset.flowFocus)}"]`;
  return document.activeElement.id ? `#${CSS.escape(document.activeElement.id)}` : null;
}

/** One physical sheet for a details/edit flow. Child bodies must not portal or lock scroll. */
export default function UpcomingFlowSheet<View>({ initialView, onClose, renderView }: UpcomingFlowSheetProps<View>) {
  useSheetOpen();
  const id = useId();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const [view, setView] = useState(initialView);
  const [depth, setDepth] = useState(0);
  const [motionKey, setMotionKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const setSubmission = useCallback((busy: boolean) => { savingRef.current = busy; setSaving(busy); }, []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelNodeRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [footerTarget, setFooterTarget] = useState<HTMLElement | null>(null);
  const footerRef = useCallback((node: HTMLDivElement | null) => setFooterTarget(node), []);
  const entriesRef = useRef<Entry<View>[]>([{ view: initialView, scrollTop: 0, focusSelector: null }]);
  const depthRef = useRef(0);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const lifecycleRef = useRef({ generation: 0 });
  const restoreRef = useRef<Entry<View> | null>(null);
  const pointerRef = useRef(false);
  const pendingRef = useRef(false);
  const restoringHistoryRef = useRef(false);
  const afterRestoreRef = useRef<"back" | "close" | null>(null);
  const timerRef = useRef<number | null>(null);

  useLayoutEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  const close = useCallback(() => {
    if (closingRef.current || savingRef.current) return;
    if (restoringHistoryRef.current) { afterRestoreRef.current = "close"; return; }
    closingRef.current = true;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    const state = history.state;
    if (owned(state, id)) history.go(-(state.__upcomingFlowDepth + 1));
    onCloseRef.current();
  }, [id]);

  const back = useCallback(() => {
    if (closingRef.current || pendingRef.current || savingRef.current) return;
    if (restoringHistoryRef.current) { afterRestoreRef.current = "back"; return; }
    if (depthRef.current === 0) { close(); return; }
    pendingRef.current = true;
    history.back();
    timerRef.current = window.setTimeout(() => { pendingRef.current = false; }, 500);
  }, [close]);

  const { ref: a11yRef } = useSheetA11y<HTMLDivElement>(back, { lockScroll: true });
  const panelRef = useCallback((node: HTMLDivElement | null) => { panelNodeRef.current = node; a11yRef(node); }, [a11yRef]);

  const goTo = useCallback((next: View) => {
    if (closingRef.current || pendingRef.current || savingRef.current) return;
    pendingRef.current = true;
    const current = entriesRef.current[depthRef.current];
    if (current) { current.scrollTop = scrollRef.current?.scrollTop ?? 0; current.focusSelector = focusSelector(); }
    const nextDepth = depthRef.current + 1;
    const entry: Entry<View> = { view: next, scrollTop: 0, focusSelector: null };
    entriesRef.current = [...entriesRef.current.slice(0, nextDepth), entry];
    depthRef.current = nextDepth;
    setDepth(nextDepth);
    history.pushState(payload(id, nextDepth), "");
    restoreRef.current = entry;
    setView(next);
    if (pointerRef.current && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) setMotionKey((key) => key + 1);
  }, [id]);

  useEffect(() => {
    const pointer = () => { pointerRef.current = true; };
    const keyboard = () => { pointerRef.current = false; };
    window.addEventListener("pointerdown", pointer, true);
    window.addEventListener("keydown", keyboard, true);
    return () => { window.removeEventListener("pointerdown", pointer, true); window.removeEventListener("keydown", keyboard, true); };
  }, []);

  useEffect(() => {
    const lifecycle = lifecycleRef.current;
    const generation = ++lifecycle.generation;
    closingRef.current = false;
    const state = history.state;
    if (owned(state, id) && entriesRef.current[state.__upcomingFlowDepth]) {
      depthRef.current = state.__upcomingFlowDepth;
      setDepth(state.__upcomingFlowDepth);
    } else {
      depthRef.current = 0;
      setDepth(0);
      history.pushState(payload(id, 0), "");
    }
    const pop = (event: PopStateEvent) => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      pendingRef.current = false;
      if (closingRef.current) return;
      if (savingRef.current || restoringHistoryRef.current) {
        // A submitted bank-setting change cannot be cancelled by navigating
        // away from its editor. Restore this flow's current history entry.
        const targetDepth = owned(event.state, id) ? event.state.__upcomingFlowDepth : -1;
        const delta = depthRef.current - targetDepth;
        if (delta) { restoringHistoryRef.current = true; history.go(delta); }
        else {
          restoringHistoryRef.current = false;
          const queued = afterRestoreRef.current;
          afterRestoreRef.current = null;
          if (queued === "close") close();
          else if (queued === "back") back();
        }
        return;
      }
      if (owned(event.state, id)) {
        const entry = entriesRef.current[event.state.__upcomingFlowDepth];
        if (!entry) return;
        depthRef.current = event.state.__upcomingFlowDepth;
        setDepth(event.state.__upcomingFlowDepth);
        restoreRef.current = entry;
        setView(entry.view);
      } else { closingRef.current = true; onCloseRef.current(); }
    };
    window.addEventListener("popstate", pop);
    return () => {
      window.removeEventListener("popstate", pop);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      pendingRef.current = false;
      if (closingRef.current) return;
      queueMicrotask(() => {
        if (lifecycle.generation !== generation || closingRef.current) return;
        const current = history.state;
        if (owned(current, id)) history.go(-(current.__upcomingFlowDepth + 1));
      });
    };
  }, [back, close, id]);

  useLayoutEffect(() => {
    pendingRef.current = false;
    const entry = restoreRef.current;
    if (!entry) return;
    restoreRef.current = null;
    if (scrollRef.current) scrollRef.current.scrollTop = entry.scrollTop;
    const target = entry.focusSelector ? panelNodeRef.current?.querySelector<HTMLElement>(entry.focusSelector) : null;
    (target ?? headingRef.current)?.focus({ preventScroll: true });
  }, [view]);

  if (!mounted) return null;
  const navigation: UpcomingFlowNavigation<View> = { goTo, back, close };
  // These event callbacks read refs only when invoked by the user, not here.
  // eslint-disable-next-line react-hooks/refs
  const rendered = renderView(view, navigation);
  return createPortal(<UpcomingFlowSubmissionContext.Provider value={setSubmission}><UpcomingFlowFooterContext.Provider value={footerTarget}><>
    <button type="button" tabIndex={-1} aria-hidden="true" aria-label="Close details" onClick={close} className="fixed inset-0 z-[65] cursor-default bg-black/45" />
    <div className="pointer-events-none fixed inset-0 z-[70] flex items-end justify-center lg:items-center lg:p-6">
      <section ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={rendered.subtitle ? `${id}-subtitle` : undefined} onClickCapture={(event) => {
        // The second tap of a double-click must not activate a different
        // footer control that appeared under the pointer after the first.
        if (event.detail > 1) { event.preventDefault(); event.stopPropagation(); }
      }} className="glass-sheet pointer-events-auto flex h-[min(780px,90dvh)] w-full max-w-lg flex-col rounded-t-3xl border-t border-slate-200 dark:border-slate-700 lg:rounded-3xl lg:border lg:shadow-xl">
        <div className="flex shrink-0 justify-center pb-1 pt-3 lg:hidden" aria-hidden="true"><span className="h-1 w-10 rounded-full bg-slate-200 dark:bg-slate-600" /></div>
        <header className="flex shrink-0 items-start gap-3 px-5 pb-4 pt-2 lg:pt-5">
          {depth > 0 && <button type="button" onClick={back} disabled={saving} aria-label="Back to details" className={`flex size-11 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 active:scale-95 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800 ${focusRing}`}><ChevronLeft size={20} aria-hidden="true" /></button>}
          {rendered.leading && <div className="shrink-0 pt-1">{rendered.leading}</div>}
          <div className="min-w-0 flex-1 pt-1"><h2 ref={headingRef} id={`${id}-title`} tabIndex={-1} className="break-words text-lg font-bold leading-6 text-slate-950 outline-none dark:text-white">{rendered.title}</h2>{rendered.subtitle && <p id={`${id}-subtitle`} className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">{rendered.subtitle}</p>}</div>
          <button type="button" onClick={close} disabled={saving} aria-label="Close details" className={`flex size-11 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 active:scale-95 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800 ${focusRing}`}><X size={18} aria-hidden="true" /></button>
        </header>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5"><div key={motionKey} className={motionKey ? "upcoming-flow-change" : undefined}>{rendered.body}</div></div>
        <footer className={`min-h-20 shrink-0 border-t border-slate-200 px-5 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-4 dark:border-slate-700 ${rendered.footer || footerTarget ? "" : "hidden"}`}>
          <div>{rendered.footer}</div>
          {/* Keep the portal target separate from React-owned detail actions,
              so replacing one cannot clear the editor's newly mounted footer. */}
          <div ref={footerRef} />
        </footer>
      </section>
    </div>
    <style jsx>{`.upcoming-flow-change{animation:upcoming-flow-change 150ms cubic-bezier(.23,1,.32,1) both}@keyframes upcoming-flow-change{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}@media (prefers-reduced-motion:reduce){.upcoming-flow-change{animation:none}}`}</style>
  </></UpcomingFlowFooterContext.Provider></UpcomingFlowSubmissionContext.Provider>, document.body);
}
