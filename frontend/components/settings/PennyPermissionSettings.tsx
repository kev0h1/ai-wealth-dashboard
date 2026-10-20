"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import { ConsentCard } from "@/components/PennyConversation";
import { api } from "@/lib/api";
import { savePennyPermission, type PermissionSnapshot } from "@/lib/pennyPermission";

export type PennyPermissionPhase = "ready" | "loading" | "unavailable";

/** Approved G296 A: the current state stays visible while consent opens
 * in place. This view has no persistence or deployment-channel branch. */
export function PennyPermissionView({ checked, phase, busy, intent, error, notice, switchRef, confirmationRef, onRequest, onConfirm, onCancel, onRetry }: {
  checked: boolean; phase: PennyPermissionPhase; busy: boolean; intent: boolean | null;
  error: string; notice: string; switchRef?: Ref<HTMLButtonElement>; confirmationRef?: Ref<HTMLDivElement>;
  onRequest: () => void; onConfirm: () => void; onCancel: () => void; onRetry: () => void;
}) {
  const status = phase === "loading" ? "Checking…" : phase === "unavailable" ? "Unavailable" : checked ? "On" : "Off";
  const action = "inline-flex min-h-11 touch-manipulation items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60";
  return <section aria-labelledby="penny-permission-heading" className="mt-8">
    <h2 id="penny-permission-heading" className="text-base font-bold text-slate-900 dark:text-slate-100">Penny</h2>
    <p className="mt-1 text-[13px] leading-5 text-slate-600 dark:text-slate-400">Choose whether Penny can draft changes inside Sorted.</p>
    <div className="glass-card mt-3 overflow-hidden rounded-2xl">
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1 py-1"><h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Setting things up</h3><p id="penny-permission-help" className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400">{phase === "loading" ? "We are checking your saved permission." : phase === "unavailable" ? "We could not check your saved permission. You can still ask Penny questions." : "Draft envelopes, goals and one-offs for you to review."}</p></div>
        <div className="flex shrink-0 flex-col items-center gap-0.5">
          <button ref={switchRef} type="button" role={phase === "ready" ? "switch" : undefined} aria-checked={phase === "ready" ? checked : undefined} aria-label={phase === "ready" ? "Setting things up" : `Setting things up: ${status}`} aria-describedby="penny-permission-help penny-permission-boundary" disabled={phase !== "ready" || busy || intent !== null} onClick={onRequest} data-permission-switch className="inline-flex min-h-11 min-w-12 shrink-0 touch-manipulation items-center justify-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 active:opacity-70 disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:ring-offset-slate-800">
            <span aria-hidden="true" className={`relative block h-6 w-12 rounded-full transition-colors duration-150 motion-reduce:transition-none ${checked && phase === "ready" ? "bg-indigo-600" : "bg-slate-200 dark:bg-slate-600"}`}><span className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform duration-150 motion-reduce:transition-none ${checked && phase === "ready" ? "translate-x-6" : "translate-x-0"}`} /></span>
          </button><span aria-hidden="true" data-permission-state className="text-[11px] font-medium text-slate-600 dark:text-slate-400">{status}</span>
        </div>
      </div>
      <p id="penny-permission-boundary" className="border-t border-slate-100 px-4 py-3 text-xs leading-5 text-slate-600 dark:border-slate-700 dark:text-slate-400">Every change needs your confirmation. Penny cannot move money or make bank payments.</p>
      {phase === "unavailable" && <button type="button" disabled={busy} onClick={onRetry} className={`${action} mb-2 ml-2 px-2 text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-900/20`}>Try again</button>}
    </div>
    {intent !== null && <div ref={confirmationRef} role="region" aria-label="Penny permission confirmation" tabIndex={-1} aria-busy={busy} className="mt-3 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
      <fieldset disabled={busy} className="min-w-0 border-0 p-0">{intent ? <ConsentCard msg={{ id: 296, role: "assistant", kind: "consent", status: "pending" }} onAccept={onConfirm} onDecline={onCancel} /> : <div className="glass-card rounded-2xl p-4">
        <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Turn off setting things up?</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Penny will stop proposing changes and any proposals you have not confirmed will be cancelled. Your existing plans stay as they are.</p>
        <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-400">You can turn this back on here at any time.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" onClick={onConfirm} className={`${action} min-w-0 flex-1 bg-indigo-600 text-white hover:bg-indigo-700`}>{busy ? "Turning off…" : "Turn off"}</button><button type="button" onClick={onCancel} className={`${action} text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700`}>Keep on</button></div>
      </div>}</fieldset>
      {busy && <p role="status" className="mt-2 text-xs text-slate-600 dark:text-slate-300">{intent ? "Turning on…" : "Turning off…"}</p>}
    </div>}
    {error && <p role="alert" className="mt-3 flex items-start gap-2 text-sm leading-5 text-slate-700 dark:text-slate-200"><span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" />{error}</p>}
    <p aria-live="polite" aria-atomic="true" className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">{notice}</p>
  </section>;
}

export default function PennyPermissionSettings({ ready, snapshot, refresh }: { ready: boolean; snapshot: PermissionSnapshot; refresh: () => Promise<PermissionSnapshot> }) {
  const [intent, setIntent] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const saving = useRef(false), switchRef = useRef<HTMLButtonElement>(null), confirmationRef = useRef<HTMLDivElement>(null);
  const phase: PennyPermissionPhase = !ready ? "loading" : uncertain || !snapshot ? "unavailable" : "ready";
  useEffect(() => { if (intent !== null) { confirmationRef.current?.focus({ preventScroll: true }); confirmationRef.current?.scrollIntoView({ block: "nearest" }); } }, [intent]);
  const restore = () => requestAnimationFrame(() => switchRef.current?.focus({ preventScroll: true }));
  const cancel = () => { if (saving.current) return; setIntent(null); setError(""); restore(); };
  const confirmPermission = async () => {
    if (intent === null || saving.current || phase !== "ready") return;
    const desired = intent;
    saving.current = true; setBusy(true); setError(""); setNotice("");
    const result = await savePennyPermission(desired, { grant: api.grantPennyAgentConsent, revoke: api.revokePennyAgentConsent, refresh });
    saving.current = false; setBusy(false);
    if (result.kind === "unknown") { setUncertain(true); setIntent(null); setError("We could not verify the saved permission. Try again to check it before making another change."); return; }
    setUncertain(false);
    if (result.kind === "rejected") { setError(`Could not turn this ${desired ? "on" : "off"}. Try again.`); return; }
    setIntent(null); setNotice(desired ? "Setting things up is on. Every proposal still needs confirmation." : "Setting things up is off."); restore();
  };
  const retry = async () => {
    if (saving.current) return;
    saving.current = true; setBusy(true);
    let current: PermissionSnapshot = null;
    try { current = await refresh(); } catch { /* Keep the unknown state. */ }
    setUncertain(!current); setError(current ? "" : "Could not check permission. Try again.");
    saving.current = false; setBusy(false); if (current) restore();
  };
  return <PennyPermissionView checked={Boolean(snapshot?.penny_agent_consent)} phase={phase} busy={busy} intent={intent} error={error} notice={notice} switchRef={switchRef} confirmationRef={confirmationRef} onRequest={() => { setError(""); setNotice(""); setIntent(!snapshot?.penny_agent_consent); }} onConfirm={() => void confirmPermission()} onCancel={cancel} onRetry={() => void retry()} />;
}
