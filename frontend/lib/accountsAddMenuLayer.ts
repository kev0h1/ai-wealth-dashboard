// G478: layering and dismissal rules for the Accounts "+ Add" menu.
//
// On iPhone nothing in the menu responded. The menu used to live inside the
// header (`relative z-30`) inside #app-shell (overflow-x hidden, a scroll
// container), underneath the fixed shell layers (safe-top frost z-40 with a
// backdrop-filter, BottomNav z-50). It is now portalled to document.body at
// a z-index above every shell layer, positioned from the trigger's rect.
//
// Dismissal is `pointerup` on the document, ignoring anything inside the menu
// or the trigger. It never relies on blur: iOS WebKit does not focus a
// button on tap, so focus and relatedTarget are unreliable there, and iOS
// does not bubble `click` from non-interactive elements to the document.

/** Above BottomNav (50), the safe-top frost (40), PennySheet (56); below the tour overlay (60) and SheetFrame/ConfirmDialog (70). */
export const ADD_MENU_Z = 58;
export const ADD_MENU_ATTR = "data-accounts-add-menu";
export const ADD_MENU_ITEM_SELECTOR = `[${ADD_MENU_ATTR}] [role="menuitem"]:not(:disabled)`;

export interface AnchorRect { top: number; bottom: number; left: number; right: number }

/** Fixed-position offsets for the menu: 8px under the trigger, right edges aligned, never closer than 8px to the right edge. */
export function addMenuPosition(rect: AnchorRect, viewportWidth: number): { top: number; right: number } {
  return { top: Math.round(rect.bottom + 8), right: Math.max(8, Math.round(viewportWidth - rect.right)) };
}

interface ClosestLike { closest?: (sel: string) => unknown; }
interface ContainsLike { contains(n: unknown): boolean }

/** True when a tap landed outside the menu, outside the trigger, and not on the tour card. */
export function isOutsideAddMenu(target: unknown, trigger: ContainsLike | null | undefined): boolean {
  const t = target as ClosestLike | null;
  if (t?.closest?.("[data-tutorial-overlay]")) return false;
  if (t?.closest?.(`[${ADD_MENU_ATTR}]`)) return false;
  if (trigger && target && trigger.contains(target)) return false;
  return true;
}

interface DocLike {
  addEventListener(type: string, fn: (e: { target: unknown }) => void, capture?: boolean): void;
  removeEventListener(type: string, fn: (e: { target: unknown }) => void, capture?: boolean): void;
}

/** Closes on a pointerup outside the menu and trigger. Returns the detach function. */
export function attachAddMenuOutsideClose(doc: DocLike, getTrigger: () => ContainsLike | null | undefined, onClose: () => void): () => void {
  const handler = (e: { target: unknown }) => { if (isOutsideAddMenu(e.target, getTrigger())) onClose(); };
  doc.addEventListener("pointerup", handler, true);
  return () => doc.removeEventListener("pointerup", handler, true);
}
