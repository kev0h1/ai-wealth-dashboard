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
