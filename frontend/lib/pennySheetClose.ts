// G244: the two pure decisions behind closing the full-screen Penny sheet
// without its X button. History (Back) is useSheetA11y's backToClose, reused
// as is; the swipe is G205's controller and gate, reused with Penny's parts.

import { canStartSheetSwipe, sheetSwipeAllowed, type SwipeNode } from "./sheetSwipe";

/** Below this the sheet is the phone full-screen takeover (lg keeps the
 * floating window, which has no scrim and must not own a history entry). */
export const PENNY_PHONE_QUERY = "(max-width: 1023px)";

export interface PennySwipeInput {
  target: SwipeNode | null;
  /** The sheet header (title row, links row, divider). */
  header: SwipeNode | null;
  /** The conversation scroller ([data-penny-scroll]). */
  scroller: SwipeNode | null;
  pointerType: string;
  viewportWidth: number;
  /** The software keyboard is up (data-penny-typing): never drag then. */
  keyboardUp: boolean;
  /** An overlay sheet (More messages) is open on top of the panel. */
  overlayOpen: boolean;
}

/** May a pointer-down start the swipe-down close? Yes on the header; yes on
 * the conversation only when it is scrolled to the top (and no nested
 * scroller under the finger is mid-scroll); never on the composer, chip row,
 * inputs, with the keyboard up, with an overlay open, on desktop or a mouse. */
export function pennySwipeGate(input: PennySwipeInput, overflowY?: (node: SwipeNode) => string): boolean {
  if (input.keyboardUp || input.overlayOpen) return false;
  if (!sheetSwipeAllowed(input.pointerType, input.viewportWidth)) return false;
  return canStartSheetSwipe(input.target, { handle: null, header: input.header, body: input.scroller }, overflowY);
}

// G247: the sheet panel is mounted for the whole session and only its ref is
// toggled (`ref={isOpen ? panelRef : undefined}`). A swipe-dismiss leaves
// translateY(height+20px) inline on that node (swipeController.ts), and the
// controller's own restoreAfterMs reset finds no element once the ref has been
// nulled by the close, so the next open slid in off-screen: a blank sheet. The
// style is reset whenever the node attaches (open) or detaches (close, hidden
// by then so nothing flashes).
export interface PennyPanelStyleNode {
  style: { transform: string; opacity: string; transition: string };
}

export function resetPennyPanelStyle(node: PennyPanelStyleNode | null | undefined): void {
  if (!node) return;
  node.style.transform = "";
  node.style.opacity = "";
  node.style.transition = "";
}

/** Ref callback factory: tracks the last node and clears swipe residue on
 * every attach and detach, then hands the node on. */
export function createPennyPanelRef<T extends PennyPanelStyleNode>(onNode: (node: T | null) => void) {
  let last: T | null = null;
  return (node: T | null) => {
    resetPennyPanelStyle(node ?? last);
    last = node;
    onNode(node);
  };
}
