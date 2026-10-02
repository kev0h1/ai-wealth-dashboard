import { useEffect } from "react";
import { acquireScrollLock } from "@/lib/useSheetA11y";

/** Locks the page behind an open Penny window. A fixed body with the scroll
 * offset restored on release (shared with the other sheets) holds on Android
 * Chrome while an input is focused, where body overflow:hidden does not. */
export function useLockBodyScroll() {
  useEffect(() => acquireScrollLock(), []);
}
