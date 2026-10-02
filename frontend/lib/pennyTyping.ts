/** When Penny's composer docks on the keyboard (G196, superseding the G191
 * takeover). Pure, so the touch and keyboard-dismissal sequences are testable
 * without a device. Docking needs two facts together: the composer is engaged
 * (it holds focus) and a software keyboard is actually measured as visible.
 * Focus alone never moves anything: moving on touch-down shifts the input
 * before touch-up, and a hardware keyboard shows no software keyboard. */
export type PennyTypingInput = {
  isOpen: boolean;
  proposed: boolean;
  mobile: boolean;
  engaged: boolean;
  keyboardVisible: boolean;
};

export function pennyTypingActive(s: PennyTypingInput): boolean {
  return s.isOpen && s.proposed && s.mobile && s.engaged && s.keyboardVisible;
}

export type PennyEngageEvent =
  | { type: "composer-focus" }
  | { type: "blur"; toOutsideDialog: boolean }
  | { type: "close" };

/** Engagement follows the composer's focus. Keyboard dismissal that leaves
 * DOM focus on the input keeps it engaged, so a second tap (which fires no new
 * focus event) can reopen typing from the next measured keyboard. A null blur
 * is ambiguous (dismissal), so only moving focus out of the dialog clears it. */
export function pennyNextEngaged(engaged: boolean, event: PennyEngageEvent): boolean {
  if (event.type === "composer-focus") return true;
  if (event.type === "close") return false;
  return event.toOutsideDialog ? false : engaged;
}

/** Marks the root as typing (hides the mobile nav) and returns a cleanup that
 * restores whatever value was there before, or removes the attribute. */
export function applyPennyTypingAttribute(root: { getAttribute(n: string): string | null; setAttribute(n: string, v: string): void; removeAttribute(n: string): void }): () => void {
  const previous = root.getAttribute("data-penny-typing");
  root.setAttribute("data-penny-typing", "true");
  return () => {
    if (previous == null) root.removeAttribute("data-penny-typing");
    else root.setAttribute("data-penny-typing", previous);
  };
}
