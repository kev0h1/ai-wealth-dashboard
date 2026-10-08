"use client";

import { useEffect, useRef } from "react";
import { attachBankReturnReset, type BankReturnGuard } from "@/lib/bankReturnReset";
import { isNativePlatform } from "@/lib/nativeAuth";

/** A149: one shared reset for every connecting surface (the picker row and the
 *  A155 review step both read the picker's `connecting` state). Call `begin()`
 *  just before the hand-off starts and `end()` if it fails to start; the hook
 *  calls `onReset` when the user comes back without a completed consent. */
export function useBankReturnReset(onReset: () => void): { begin(): number; end(): void } {
  const guardRef = useRef<BankReturnGuard | null>(null);
  const resetRef = useRef(onReset);
  resetRef.current = onReset;
  useEffect(() => {
    let disposed = false;
    let offBrowser: (() => void) | null = null;
    const guard = attachBankReturnReset({
      win: window,
      doc: document,
      storage: window.sessionStorage,
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (id) => window.clearTimeout(id as number),
      onReset: () => resetRef.current(),
      onBrowserFinished: (fn) => {
        if (isNativePlatform()) {
          // A139: destructure and call inline, never return the plugin proxy.
          void import("@capacitor/browser").then(({ Browser }) => Browser.addListener("browserFinished", fn)).then((h) => {
            if (disposed) void h.remove();
            else offBrowser = () => void h.remove();
          }).catch(() => {});
        }
        return () => { offBrowser?.(); };
      },
    });
    guardRef.current = guard;
    return () => { disposed = true; guard.detach(); guardRef.current = null; };
  }, []);
  return {
    begin: () => guardRef.current?.begin() ?? 0,
    end: () => guardRef.current?.end(),
  };
}
