"use client";

import { ShieldCheck, Check } from "lucide-react";
import type { OAuthScopeDetail } from "@/lib/api";

// F2: the actual consent UI, kept presentational (no fetching, no
// sessionStorage, no navigation) so both the live page
// (OAuthConsentClient.tsx) and the /design/oauth-consent fixture preview
// render the exact same markup. Deliberately plain indigo, no gradient —
// DESIGN.md's Penny Gradient Rule reserves indigo→violet for the AI
// adviser; this is a plain authorisation screen, styled like LoginScreen.
export default function OAuthConsentCard({
  clientName,
  redirectHost,
  scopes,
  onApprove,
  onDeny,
  busy = false,
  error = null,
}: {
  clientName: string;
  redirectHost: string;
  scopes: OAuthScopeDetail[];
  onApprove: () => void;
  onDeny: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  return (
    <div className="min-h-dvh flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl shadow-lg mb-5 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-192.png" alt="Sorted" width={64} height={64} className="w-full h-full object-cover" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
            {clientName} wants to read your Sorted data
          </h1>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-sm p-6">
          <ul className="space-y-3 mb-5">
            {scopes.map((s) => (
              <li key={s.scope} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">
                  <Check size={13} strokeWidth={3} />
                </span>
                <span className="text-sm text-slate-700 dark:text-slate-200 leading-snug">{s.description}</span>
              </li>
            ))}
          </ul>

          <div className="flex items-start gap-2 rounded-2xl bg-slate-50 dark:bg-slate-700/40 px-4 py-3 mb-5">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-slate-400 dark:text-slate-500" />
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              It cannot see individual transactions or bank details, and it cannot make changes.
            </p>
          </div>

          <p className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500 text-center mb-5">
            Redirects to {redirectHost}
          </p>

          {error && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-100">
              <p className="text-sm text-red-600 text-center">{error}</p>
            </div>
          )}

          <button
            type="button"
            onClick={onApprove}
            disabled={busy}
            className="w-full min-h-11 py-3 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition font-semibold text-white text-sm shadow-sm disabled:opacity-60"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={onDeny}
            disabled={busy}
            className="mt-3 w-full min-h-11 py-3 px-4 rounded-2xl text-slate-500 dark:text-slate-400 font-medium text-sm hover:text-slate-700 dark:hover:text-slate-200 transition disabled:opacity-60"
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}
