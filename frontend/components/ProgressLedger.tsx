"use client";

// Shared progress-ledger primitives (G202 sign-in panel, reused by G210's
// first-sync card): buttons, the polite status block, the ring/tick/hollow
// markers and the ledger rows. No red (The Red Is Risk Rule), no gradient
// (The Penny Gradient Rule); the ring goes static under reduced motion.

import { useEffect, useRef, type ReactNode } from "react";

export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-800";

export function Primary({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-11 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition-transform duration-150 ease-out active:scale-95 motion-reduce:transition-none ${focusRing}`}
    >
      {children}
    </button>
  );
}

export function Secondary({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-11 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition-transform duration-150 ease-out active:scale-95 motion-reduce:transition-none dark:border-slate-600 dark:text-slate-100 ${focusRing}`}
    >
      {children}
    </button>
  );
}

// The one polite live region. Content changes announce; nothing ticks.
export function Status({ title, line, focusOnMount }: { title: string; line: string; focusOnMount?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusOnMount) ref.current?.focus();
  }, [focusOnMount]);
  return (
    <div
      ref={ref}
      tabIndex={focusOnMount ? -1 : undefined}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="min-w-0 rounded-lg focus:outline-none"
    >
      <h2 className="text-lg font-bold leading-snug text-slate-900 dark:text-slate-100">{title}</h2>
      <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{line}</p>
    </div>
  );
}

// A calm in-progress ring. Static under reduced motion, and it never stands
// alone: the words beside it carry the state.
export function Ring() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-4 w-4 shrink-0 rounded-full border-2 border-indigo-600/25 border-t-indigo-600 animate-spin motion-reduce:animate-none dark:border-indigo-400/25 dark:border-t-indigo-400"
      style={{ animationDuration: "1.1s" }}
    />
  );
}

export function Check() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" className="shrink-0 text-indigo-600 dark:text-indigo-400">
      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Hollow() {
  return <span aria-hidden="true" className="inline-block h-4 w-4 shrink-0 rounded-full border-2 border-slate-300 dark:border-slate-600" />;
}

export const whisper = "text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-600 dark:text-slate-300";

export function Row({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <li className="flex items-center gap-3 py-3.5">
      {icon}
      <span className="min-w-0 flex-1 text-sm text-slate-900 dark:text-slate-100">{label}</span>
      <span className={whisper}>{value}</span>
    </li>
  );
}

export const ledger =
  "divide-y divide-slate-200 rounded-2xl border border-slate-200 px-4 dark:divide-slate-700 dark:border-slate-600";
