"use client";

import { useLayoutEffect } from "react";
import { installPennyIosPanGuard, type PanGuardDocument, type PanGuardWindow } from "@/lib/pennyIosPanGuard";
import { acquireScrollLock } from "@/lib/useSheetA11y";

/** While `enabled` (iOS strategy: keyboard settled and up, layout viewport not
 * shrunk), stops the visual viewport panning over the full-height layout
 * viewport. All logic lives in installPennyIosPanGuard. */
export function usePennyIosPanGuard(enabled: boolean): void {
  useLayoutEffect(() => {
    if (!enabled) return;
    return installPennyIosPanGuard(window as unknown as PanGuardWindow, document as unknown as PanGuardDocument, { acquireLock: acquireScrollLock });
  }, [enabled]);
}
