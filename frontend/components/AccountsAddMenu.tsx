"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Landmark, Plus, TrendingUp, Upload } from "@/lib/phosphorIcons";
import { LEGACY_BANK_AVAILABLE, LEGACY_BANK_MENU_LABEL } from "@/lib/legacyBankProvider";
import { RESUBSCRIBE_HREF } from "@/lib/billingCopy";
import { ADD_MENU_ATTR, ADD_MENU_Z, addMenuPosition } from "@/lib/accountsAddMenuLayer";
import { runAddMenuProbe } from "@/lib/accountsAddProbeClient"; // G478 TEMPORARY probe

export interface AccountsAddMenuProps {
  allowed: boolean;
  ready: boolean;
  /** G477: the access read failed or timed out. Shows a retry line instead of a silent disabled row. */
  error?: boolean;
  onRetry?: () => void;
  onBank: (provider: "finexer" | "legacy") => void;
  onStatement: () => void;
  onInvestment: () => void;
  onOffline: () => void;
  /** G478: the trigger wrapper. The menu is portalled to document.body and positioned from its rect. */
  anchorRef?: RefObject<HTMLElement | null>;
}

const rowClass = "flex w-full min-h-11 items-center gap-2.5 rounded-lg px-3 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 disabled:text-slate-500 dark:text-slate-200 dark:hover:bg-white/5 dark:active:bg-white/10 dark:disabled:text-slate-400";

/** G389 F6: actions name what happens next; restrictions have a way forward. */
export function AccountsAddMenuContent({ allowed, ready, error = false, onRetry, onBank, onStatement, onInvestment, onOffline, style, menuRef }: Omit<AccountsAddMenuProps, "anchorRef"> & { style?: React.CSSProperties; menuRef?: RefObject<HTMLDivElement | null> }) {
  return <div ref={menuRef} {...{ [ADD_MENU_ATTR]: "" }} style={style} role="menu" aria-label="Add an account" className="w-[min(290px,calc(100vw-64px))] rounded-2xl border border-slate-200 bg-white p-1 shadow-xl dark:border-white/10 dark:bg-slate-800">
    <button type="button" role="menuitem" data-tutorial-id="tutorial-add-bank" disabled={error ? false : !allowed || !ready} aria-describedby={!allowed || error ? "accounts-bank-access" : undefined} className={rowClass} onClick={() => onBank("finexer")}><Landmark size={16} aria-hidden="true" className="shrink-0" />Connect a bank</button>
    {/* A67: a failed read never locks anyone out; the server's 402 is the real gate (B10 message in startConsent). */}
    {error && <div className="px-3 pb-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
      <p id="accounts-bank-access" role="status">We could not check bank connection access. You can still try to connect, or check your connection and try again.</p>
      {onRetry && <button type="button" role="menuitem" onClick={onRetry} className="mt-1 inline-flex min-h-11 items-center rounded-lg px-1 font-semibold text-indigo-700 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">Try again</button>}
    </div>}
    {!allowed && !error && <div className="px-3 pb-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
      <p id="accounts-bank-access" role="status">{ready ? "Bank connection is not included in your plan. Upload a statement or manage your subscription to connect a bank." : "Checking bank connection access…"}</p>
      {ready && <Link href={RESUBSCRIBE_HREF} role="menuitem" className="mt-1 inline-flex min-h-11 items-center rounded-lg px-1 font-semibold text-indigo-700 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">Manage subscription</Link>}
    </div>}
    {allowed && ready && !error && LEGACY_BANK_AVAILABLE && <button type="button" role="menuitem" className={rowClass} onClick={() => onBank("legacy")}><Landmark size={16} aria-hidden="true" />{LEGACY_BANK_MENU_LABEL}</button>}
    <button type="button" role="menuitem" data-tutorial-id="tutorial-add-statement" className={rowClass} onClick={onStatement}><Upload size={16} aria-hidden="true" />Upload a statement</button>
    <button type="button" role="menuitem" data-tutorial-id="tutorial-add-investment" className={rowClass} onClick={onInvestment}><TrendingUp size={16} aria-hidden="true" />Add an investment</button>
    <button type="button" role="menuitem" data-tutorial-id="tutorial-add-offline" className={rowClass} onClick={onOffline}><Plus size={16} aria-hidden="true" />Add an offline account</button>
  </div>;
}

/** G478: portalled to document.body above every fixed shell layer (see lib/accountsAddMenuLayer.ts). */
export default function AccountsAddMenu({ anchorRef, ...props }: AccountsAddMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const place = () => {
    const rect = anchorRef?.current?.getBoundingClientRect();
    return rect ? addMenuPosition(rect, document.documentElement.clientWidth) : { top: 0, right: 8 };
  };
  // First paint is already positioned: the trigger is mounted before the menu opens.
  const [pos, setPos] = useState(() => (typeof document === "undefined" ? { top: 0, right: 8 } : place()));
  useLayoutEffect(() => {
    const update = () => setPos(place());
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorRef]);
  // G478 TEMPORARY probe: runs on open, independent of any tap reaching a button.
  useEffect(() => {
    const id = requestAnimationFrame(() => runAddMenuProbe(menuRef.current));
    return () => cancelAnimationFrame(id);
  }, []);
  if (typeof document === "undefined") return <AccountsAddMenuContent {...props} />;
  const style: React.CSSProperties = {
    position: "fixed",
    zIndex: ADD_MENU_Z,
    top: pos.top,
    right: `max(${pos.right}px, calc(env(safe-area-inset-right, 0px) + 8px))`,
  };
  return createPortal(<AccountsAddMenuContent {...props} style={style} menuRef={menuRef} />, document.body);
}
