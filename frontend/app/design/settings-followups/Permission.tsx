"use client";

import { forwardRef, type Ref } from "react";
import { ConsentCard } from "@/components/PennyConversation";
import styles from "./preview.module.css";

export type PermissionPhase = "ready" | "loading" | "unavailable";
export const PermissionSwitch = forwardRef<HTMLButtonElement, { checked: boolean; disabled: boolean; phase: PermissionPhase; onChange: () => void }>(function PermissionSwitch({ checked, disabled, phase, onChange }, ref) {
  return <button ref={ref} type="button" role="switch" aria-checked={checked} aria-label="Setting things up" aria-describedby="penny-permission-help penny-permission-boundary" disabled={disabled} onClick={onChange} data-permission-switch className="inline-flex min-h-11 min-w-12 shrink-0 touch-manipulation items-center justify-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 active:opacity-70 disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:ring-offset-slate-800">
    <span aria-hidden="true" className={`relative block h-6 w-12 rounded-full transition-colors duration-150 motion-reduce:transition-none ${checked ? "bg-indigo-600" : "bg-slate-200 dark:bg-slate-600"}`}><span className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform duration-150 motion-reduce:transition-none ${checked ? "translate-x-6" : "translate-x-0"}`} /></span>
    <span className="sr-only">{phase === "ready" ? checked ? "On" : "Off" : phase === "loading" ? "Checking permission" : "Unavailable"}</span>
  </button>;
});

export function PermissionRow({ checked, phase, pending, onChange, onRetry, switchRef }: { checked: boolean; phase: PermissionPhase; pending: boolean; onChange: () => void; onRetry: () => void; switchRef: Ref<HTMLButtonElement> }) {
  const status = phase === "loading" ? "Checking…" : phase === "unavailable" ? "Unavailable" : checked ? "On" : "Off";
  return <section aria-labelledby="penny-permission-heading" className="mt-8">
    <h2 id="penny-permission-heading" className="text-base font-bold text-slate-900 dark:text-slate-100">Penny</h2>
    <p className="mt-1 text-[13px] leading-5 text-slate-600 dark:text-slate-400">Choose whether Penny can draft changes inside Sorted.</p>
    <div className="glass-card mt-3 overflow-hidden rounded-2xl">
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1 py-1"><h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Setting things up</h3><p id="penny-permission-help" className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400">{phase === "loading" ? "We are checking your saved permission." : phase === "unavailable" ? "Setting things up is unavailable right now. You can still ask Penny questions." : "Draft envelopes, goals and one-offs for you to review."}</p></div>
        <div className="flex shrink-0 flex-col items-center gap-0.5"><PermissionSwitch ref={switchRef} checked={checked} phase={phase} disabled={phase !== "ready" || pending} onChange={onChange} /><span aria-hidden="true" data-permission-state className="text-[11px] font-medium text-slate-600 dark:text-slate-400">{status}</span></div>
      </div>
      <p id="penny-permission-boundary" className="border-t border-slate-100 px-4 py-3 text-xs leading-5 text-slate-600 dark:border-slate-700 dark:text-slate-400">Every change needs your confirmation. Penny cannot move money or make bank payments.</p>
      {phase !== "ready" && <button type="button" onClick={onRetry} className="mb-2 ml-2 inline-flex min-h-11 touch-manipulation items-center rounded-xl px-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300 dark:hover:bg-indigo-900/20">Try again</button>}
    </div>
  </section>;
}

export function ConsentExplanation({ inSheet, onAccept, onDecline }: { inSheet: boolean; onAccept: () => void; onDecline: () => void }) {
  return <div data-consent-explanation className={inSheet ? styles.sheetConsent : ""}><ConsentCard msg={{ id: 296, role: "assistant", kind: "consent", status: "pending" }} onAccept={onAccept} onDecline={onDecline} /></div>;
}

export function RevokeExplanation() {
  return <><h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Turn off setting things up?</h3><p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Penny will stop proposing changes and any proposals you have not confirmed will be cancelled. Your existing plans stay as they are.</p><p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-400">You can turn this back on here at any time.</p></>;
}

export function DecisionActions({ onConfirm, onCancel, revoke, busy }: { onConfirm: () => void; onCancel: () => void; revoke: boolean; busy: boolean }) {
  const base = "inline-flex min-h-11 touch-manipulation items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60";
  return <div className="flex flex-wrap items-center gap-2"><button type="button" onClick={onConfirm} disabled={busy} className={`${base} min-w-0 flex-1 bg-indigo-600 text-white hover:bg-indigo-700`}>{busy ? revoke ? "Turning off…" : "Turning on…" : revoke ? "Turn off" : "Yes, set things up"}</button><button type="button" onClick={onCancel} disabled={busy} className={`${base} text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700`}>{revoke ? "Keep on" : "Not now"}</button></div>;
}
