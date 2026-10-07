"use client";

import { planReturn } from "@/lib/upcomingFlowStack";
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SheetFrame } from "@/components/SheetFrame";

export interface UpcomingFlowNavigation<View> {
  goTo(view: View): void;
  back(): void;
  close(): void;
  /** Pops straight to the nearest earlier step matching `match`. Returns false (and does nothing) when no such step is beneath this one. */
  returnTo(match: (view: View) => boolean): boolean;
  /** True when returnTo(match) would navigate, so a transient state can render empty instead of flashing copy. */
  canReturnTo(match: (view: View) => boolean): boolean;
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
const UpcomingFlowFooterContext = createContext<{ target: HTMLElement | null; retain(): () => void }>({
  target: null,
  retain: () => () => {},
});
const UpcomingFlowSubmissionContext = createContext<(busy: boolean) => void>(() => {});
export function useFlowSubmission() { return useContext(UpcomingFlowSubmissionContext); }

/** Projects a form's stable actions into the persistent flow footer. It is a
 * portal within the existing dialog, never a nested dialog or sheet. */
export function UpcomingFlowFooter({ children }: { children: ReactNode }) {
  const { target, retain } = useContext(UpcomingFlowFooterContext);
  useEffect(retain, [retain]);
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

/** One physical sheet for a details/edit flow. Child bodies must not portal or lock scroll, with ONE
 *  exception (G136): components/DatePicker opens a nested SheetFrame, which does both. That is safe
 *  because the picker owns its own history entry, and useSheetA11y builds that entry by spreading the
 *  current history.state, so this flow's __upcomingFlowId and __upcomingFlowDepth keys survive; closing
 *  the picker pops only its own entry and never touches the flow (check:g192-sheet-anatomy pins the spread). */
export default function UpcomingFlowSheet<View>({ initialView, onClose, renderView }: UpcomingFlowSheetProps<View>) {
  const id = useId();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const [view, setView] = useState(initialView);
  const [depth, setDepth] = useState(0);
  const [motionKey, setMotionKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const setSubmission = useCallback((busy: boolean) => { savingRef.current = busy; setSaving(busy); }, []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelNodeRef = useRef<HTMLElement>(null);
  const panelRef = useCallback((node: HTMLElement | null) => { panelNodeRef.current = node; }, []);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [footerTarget, setFooterTarget] = useState<HTMLElement | null>(null);
  const [portalFooters, setPortalFooters] = useState(0);
  const footerRef = useCallback((node: HTMLDivElement | null) => setFooterTarget(node), []);
  const fallbackFooterRef = useCallback((node: HTMLDivElement | null) => {
    if (node) setFooterTarget(node);
  }, []);
  const retainFooter = useCallback(() => {
    setPortalFooters(count => count + 1);
    return () => setPortalFooters(count => Math.max(0, count - 1));
  }, []);
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

  const returnTo = useCallback((match: (view: View) => boolean) => {
    const from = depthRef.current;
    const plan = planReturn(entriesRef.current.map((entry) => entry.view), from, match);
    if (plan.kind === "none") return false;
    if (closingRef.current || pendingRef.current || savingRef.current) return true;
    if (plan.kind === "back") { back(); return true; }
    pendingRef.current = true;
    history.go(plan.delta);
    timerRef.current = window.setTimeout(() => { pendingRef.current = false; }, 500);
    return true;
  }, [back]);

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
  const navigation: UpcomingFlowNavigation<View> = { goTo, back, close, returnTo, canReturnTo: (match) => planReturn(entriesRef.current.map((entry) => entry.view), depthRef.current, match).kind !== "none" };
  // These event callbacks read refs only when invoked by the user, not here.
  // eslint-disable-next-line react-hooks/refs
  const rendered = renderView(view, navigation);
  const hasFooter = rendered.footer != null || portalFooters > 0;
  return <UpcomingFlowSubmissionContext.Provider value={setSubmission}><UpcomingFlowFooterContext.Provider value={{ target: footerTarget, retain: retainFooter }}>
    <SheetFrame title={rendered.title} description={rendered.subtitle} leading={rendered.leading}
      onClose={close} onEscape={back} onBack={depth > 0 ? back : undefined} backLabel="Back to details"
      dismissDisabled={saving} manageHistory={false} labelledBy={`${id}-title`}
      panelRef={panelRef} headingRef={headingRef} bodyRef={scrollRef}
      onClickCapture={(event) => {
        // The second tap of a double-click must not activate a different
        // footer control that appeared under the pointer after the first.
        if (event.detail > 1) { event.preventDefault(); event.stopPropagation(); }
      }} footer={hasFooter ? <>
          <div>{rendered.footer}</div>
          {/* Keep the portal target separate from React-owned detail actions,
              so replacing one cannot clear the editor's newly mounted footer. */}
          <div ref={footerRef} />
      </> : undefined}>
      <div key={motionKey} className={motionKey ? "upcoming-flow-change" : undefined}>{rendered.body}{!hasFooter && <div ref={fallbackFooterRef} />}</div>
    </SheetFrame>
    <style jsx>{`.upcoming-flow-change{animation:upcoming-flow-change 150ms cubic-bezier(.23,1,.32,1) both}@keyframes upcoming-flow-change{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}@media (prefers-reduced-motion:reduce){.upcoming-flow-change{animation:none}}`}</style>
  </UpcomingFlowFooterContext.Provider></UpcomingFlowSubmissionContext.Provider>;
}
