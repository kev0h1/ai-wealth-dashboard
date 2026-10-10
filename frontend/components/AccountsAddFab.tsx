"use client";

// G236 fold-in of variant A: the 56px floating Add action. Fixed bottom right,
// above the BottomNav rail and to the right of the raised Penny button. Offsets
// are the approved preview's: BottomNav is a 64px rail at max(inset, 10px) from
// the bottom (top edge about 74px up), so the action sits 80px above that base,
// 16px clear of the rail. z-45 sits above the nav scrim (z-40, 116px tall) so the
// button never fades into the scrim gradient, and below sheets (z-50).
// The Add menu is the existing production menu rows, passed in as children,
// opening upward from the button. Hidden (not unmounted, so the tutorial ref and
// state survive) while a sheet or the Find keyboard is open.

import type { ReactNode, RefObject, KeyboardEvent } from "react";
import { Plus } from "lucide-react";

export const ADD_FAB_OFFSET = "bottom-[calc(max(env(safe-area-inset-bottom,0px),10px)+80px)] lg:bottom-8";

// G250: the list ends clear of the button. Its top edge is the nav base offset
// (max(inset, 10px)) + 80px + 56px, so the list's bottom padding is that plus a
// 24px margin: the last row and its amount stop above the button, never under it.
// Desktop has no nav: the button is 32px up, so 32 + 56 + 24.
export const ADD_FAB_LIST_CLEARANCE =
  "pb-[calc(max(env(safe-area-inset-bottom,0px),10px)+160px)] lg:pb-28";

export interface AccountsAddFabProps {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  menuRef: RefObject<HTMLDivElement | null>;
  /** The menu rows, rendered inside the role="menu" container. */
  menuItems: ReactNode;
  /** A sheet is open or the Find field has focus: step aside. */
  suppressed: boolean;
}

export default function AccountsAddFab({ open, onToggle, onClose, menuRef, menuItems, suppressed }: AccountsAddFabProps) {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      onClose();
      menuRef.current?.querySelector<HTMLElement>("[data-add-control]")?.focus();
    }
  };
  return (
    <div
      ref={menuRef}
      onKeyDown={onKeyDown}
      className={`fixed right-5 z-[45] ${ADD_FAB_OFFSET}${suppressed ? " hidden" : ""}`}
    >
      {open && (
        <div
          role="menu"
          aria-label="Add an account"
          className="absolute bottom-[calc(100%+8px)] right-0 z-30 w-56 overflow-hidden rounded-2xl border border-slate-100 bg-white py-1 shadow-xl divide-y divide-slate-100 dark:border-white/10 dark:bg-slate-800 dark:divide-white/5"
        >
          {menuItems}
        </div>
      )}
      <button
        type="button"
        data-add-control
        data-tutorial-id="tutorial-add-account"
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Add account"
        className="inline-flex size-14 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold text-white shadow-xl transition-transform hover:bg-indigo-700 active:scale-95 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f0f2f7] dark:focus-visible:ring-offset-[#0f172a]"
      >
        <Plus size={22} aria-hidden="true" />
      </button>
    </div>
  );
}
