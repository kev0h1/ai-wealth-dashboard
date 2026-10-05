/** iOS typing takeover pan guard (G211). Pure decisions only; the DOM wiring
 * lives in usePennyIosPanGuard. iOS Safari and WKWebView keep the layout
 * viewport at full height while the keyboard is up, so the visual viewport can
 * pan over it. The guard exists for that strategy only: where the layout
 * viewport shrank (Android Chrome, app shells) nothing here applies. */

/** The guard runs while a software keyboard is up and the layout viewport did
 * NOT shrink with it. */
export function shouldGuard(keyboardVisible: boolean, layoutShrank: boolean): boolean {
  return keyboardVisible && !layoutShrank;
}

/** The iOS strategy must be seen on two consecutive reads before the guard
 * starts. Chrome on Android can deliver the visual viewport resize a frame
 * before innerHeight updates, so a single read may show keyboard visible with
 * the layout not yet shrunk; the next read corrects it. */
export function stableAcross(prevRead: boolean, read: boolean): boolean {
  return prevRead && read;
}

/** Whether a touch move may proceed. `deltaY` is the scroll intent: positive
 * scrolls the conversation towards its end (finger moving up), negative
 * towards its start. Only a touch that starts inside the conversation scroller
 * and can actually scroll in that direction is allowed; a rubber-band at
 * either end, or any touch elsewhere, is blocked so it cannot pan the page. */
export function touchAllowed(
  target: { nodeType?: number } | null,
  scrollerEl: { contains(node: unknown): boolean } | null,
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  deltaY: number,
): boolean {
  if (!target || !scrollerEl || !scrollerEl.contains(target)) return false;
  const max = scrollHeight - clientHeight;
  if (max <= 1) return false;
  if (deltaY < 0) return scrollTop > 0;
  if (deltaY > 0) return scrollTop < max - 1;
  return true;
}

// deltaY in touchAllowed is start-relative (touchstart Y minus current Y), not
// per-event: a gesture that reverses direction is judged against where it began.

type Listener = (event: never) => void;
type Target = {
  addEventListener(type: string, fn: Listener, options?: unknown): void;
  removeEventListener(type: string, fn: Listener, options?: unknown): void;
};
export type PanGuardWindow = Target & {
  innerHeight: number;
  scrollTo(x: number, y: number): void;
  visualViewport?: (Target & { height: number; offsetTop: number; offsetLeft: number }) | null;
};
export type PanGuardDocument = Target & {
  documentElement: { style: { height: string; overflow: string } };
  body: { style: { height: string } };
  querySelector(selector: string): { scrollTop: number; scrollHeight: number; clientHeight: number; contains(n: unknown): boolean } | null;
};
type TouchLike = { target: unknown; touches: ArrayLike<{ clientY: number }>; cancelable: boolean; preventDefault(): void };

/** Installs the guard against a minimal window/document surface (so it runs
 * under node with fakes) and returns the teardown. `acquireLock` is the
 * reference-counted body scroll lock (H71, fixed body with the saved page
 * offset). The page offset is never read or written here: the lock
 * owns it. Order: lock first, then clamp; on exit unclamp first, then release,
 * because the lock's restore scrollTo(saved) can only reach the saved offset
 * once html/body are tall again. */
export function installPennyIosPanGuard(win: PanGuardWindow, doc: PanGuardDocument, opts: { acquireLock: () => () => void }): () => void {
  const vv = win.visualViewport ?? null;
  const html = doc.documentElement.style;
  const body = doc.body.style;
  const releaseLock = opts.acquireLock();
  const prev = { htmlHeight: html.height, htmlOverflow: html.overflow, bodyHeight: body.height };
  const clamp = () => {
    const height = vv ? vv.height : win.innerHeight;
    html.height = `${height}px`;
    body.height = `${height}px`;
    html.overflow = "hidden";
  };
  // An iOS visual-viewport pan reads as vv.offsetTop/offsetLeft != 0 with
  // the page offset still 0. With the body fixed, scrollTo(0, 0) resets that pan
  // (documented WebKit behaviour; unverified on a device here). Idempotent:
  // nothing is called when both offsets are 0.
  const snap = () => {
    clamp();
    if (vv && (vv.offsetTop !== 0 || vv.offsetLeft !== 0)) win.scrollTo(0, 0);
  };
  let startY = 0;
  const onStart = (event: TouchLike) => { startY = event.touches[0]?.clientY ?? 0; };
  const onMove = (event: TouchLike) => {
    const scroller = doc.querySelector("[data-penny-window] [data-penny-scroll]");
    const y = event.touches[0]?.clientY ?? startY;
    const allowed = touchAllowed(event.target as { nodeType?: number } | null, scroller, scroller?.scrollTop ?? 0, scroller?.scrollHeight ?? 0, scroller?.clientHeight ?? 0, startY - y);
    if (!allowed && event.cancelable) event.preventDefault();
  };
  clamp();
  vv?.addEventListener("resize", snap);
  vv?.addEventListener("scroll", snap);
  win.addEventListener("resize", snap);
  doc.addEventListener("touchstart", onStart as Listener, { passive: true });
  doc.addEventListener("touchmove", onMove as Listener, { passive: false });
  return () => {
    vv?.removeEventListener("resize", snap);
    vv?.removeEventListener("scroll", snap);
    win.removeEventListener("resize", snap);
    doc.removeEventListener("touchstart", onStart as Listener);
    doc.removeEventListener("touchmove", onMove as Listener);
    html.height = prev.htmlHeight;
    html.overflow = prev.htmlOverflow;
    body.height = prev.bodyHeight;
    releaseLock();
  };
}
