// G205: where a swipe-down may begin on a SheetFrame. Pure duck-typed DOM
// walking so it runs under plain node in the tests.
//
// Rules: the handle and header always start a dismiss; the body starts one
// only when it (and any nested scroller the finger is on) is scrolled to the
// top, so the gesture never fights a scrolling list; the footer, text inputs
// and anything marked data-no-sheet-swipe never start one.

export interface SwipeNode {
  parentElement: SwipeNode | null;
  scrollTop?: number;
  scrollHeight?: number;
  clientHeight?: number;
  tagName?: string;
  hasAttribute?: (name: string) => boolean;
}

export interface SheetSwipeParts {
  handle: SwipeNode | null;
  header: SwipeNode | null;
  body: SwipeNode | null;
}

/** Chrome of the frame itself, in the order a drag from it is judged. */
function within(node: SwipeNode | null, ancestor: SwipeNode | null): boolean {
  for (let n = node; n; n = n.parentElement) if (n === ancestor) return true;
  return false;
}

const TEXT_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export function canStartSheetSwipe(
  target: SwipeNode | null,
  parts: SheetSwipeParts,
  overflowY: (node: SwipeNode) => string = node => (typeof getComputedStyle === "function" ? getComputedStyle(node as unknown as Element).overflowY : "visible"),
): boolean {
  if (!target) return false;
  for (let n: SwipeNode | null = target; n; n = n.parentElement) {
    if (n.hasAttribute?.("data-no-sheet-swipe")) return false;
    if (n.tagName && TEXT_TAGS.has(n.tagName)) return false;
  }
  if (within(target, parts.handle) || within(target, parts.header)) return true;
  if (!within(target, parts.body)) return false;
  // Body: every scroller between the finger and the body must be at its top.
  for (let n: SwipeNode | null = target; n; n = n.parentElement) {
    const scrollable = (n.scrollHeight ?? 0) > (n.clientHeight ?? 0) + 1;
    if (n === parts.body) return (n.scrollTop ?? 0) <= 0;
    if (scrollable && (n.scrollTop ?? 0) > 0) {
      const oy = overflowY(n);
      if (oy === "auto" || oy === "scroll") return false;
    }
  }
  return false;
}

/** Desktop (lg, centred dialog) and mouse pointers never swipe. */
export function sheetSwipeAllowed(pointerType: string, viewportWidth: number): boolean {
  return pointerType !== "mouse" && viewportWidth < 1024;
}

/** Cancel the browser pan only while a locked sheet drag is in progress. */
export function shouldBlockPan(cancelable: boolean, gestureActive: boolean): boolean {
  return cancelable && gestureActive;
}
