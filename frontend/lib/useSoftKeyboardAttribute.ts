"use client";

import { useEffect } from "react";
import { usePennyKeyboard } from "@/lib/usePennyKeyboard";

type Root = { setAttribute(n: string, v: string): void; removeAttribute(n: string): void };

/** G198: `html[data-soft-keyboard="true"]` while a software keyboard is
 * measured as up, absent otherwise. The app-wide nav hide keys on this instead
 * of input focus, so a retained focus with the keyboard dismissed (or a
 * hardware keyboard) never leaves an empty band where the nav should be. */
export function setSoftKeyboardAttribute(root: Root, visible: boolean): void {
  if (visible) root.setAttribute("data-soft-keyboard", "true");
  else root.removeAttribute("data-soft-keyboard");
}

/** Mount once, in Providers. Reuses the Penny keyboard measurement (layout or
 * visual viewport shrink over 100px, never pinch zoom). */
export function useSoftKeyboardAttribute(): void {
  const keyboard = usePennyKeyboard(true);
  const visible = Boolean(keyboard?.keyboardVisible);
  useEffect(() => {
    const root = document.documentElement;
    setSoftKeyboardAttribute(root, visible);
    return () => setSoftKeyboardAttribute(root, false);
  }, [visible]);
}
