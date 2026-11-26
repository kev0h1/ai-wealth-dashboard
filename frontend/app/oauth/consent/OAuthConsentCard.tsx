"use client";

import { useState } from "react";
import type { OAuthScopeDetail } from "@/lib/api";
import { grantedScopesFor, scopeDisclosure, toggleScope } from "@/lib/oauthScopes";

// F28: the production consent screen, folded in from F23 variant A
// ("Decision ledger", approved by Kevin 2026-11-24, with the two rules above
// "Before you share" removed). Presentational: no fetching, no
// sessionStorage, no navigation; OAuthConsentClient.tsx owns those.
//
// Plain indigo only. DESIGN.md's Penny Gradient Rule reserves indigo to
// violet for Penny, and red is reserved for genuine financial risk, so the
// provider warning is ink on the surface, not a red alert.
//
// The redirect host and the assistant name both come from the server. Since
// F24 the name is taken from Sorted's allowlist of assessed assistants (the
// assistant's own reported name is never shown), so it is shown plainly.
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
  onApprove: (grantedScopes: string[]) => void;
  onDeny: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  const requested = scopes.map((s) => s.scope);
  const [selected, setSelected] = useState<string[]>(requested);
  const granted = grantedScopesFor(requested, selected);
  const summary =
    granted.length === 0
      ? "No data will be shared."
      : `${granted.length} permission${granted.length === 1 ? "" : "s"} selected.`;

  return (
    <main className="min-h-dvh px-3 py-3 text-slate-900 dark:text-slate-100 sm:px-6 sm:py-6">
      <div className="mx-auto max-w-xl">
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white px-5 pb-5 pt-6 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:shadow-none sm:px-8 sm:pt-8">
          <header>
            <h1 className="text-balance text-2xl font-bold tracking-[-0.025em] text-slate-950 dark:text-white sm:text-3xl">
              Choose what to share
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
              Pick the financial information this assistant can read. It cannot change your bank accounts or make payments.
            </p>
          </header>

          <section
            data-mcp-identity
            aria-label="Assistant and redirect host"
            className="mt-6 border-y border-slate-200 py-4 dark:border-slate-700"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
              Redirect host
            </p>
            <h2 className="mt-1 [overflow-wrap:anywhere] text-lg font-bold leading-6 text-slate-950 dark:text-white">
              {redirectHost}
            </h2>
            <p className="mt-3 text-sm leading-5 text-slate-600 dark:text-slate-300">
              Assistant:{" "}
              <span className="font-semibold text-slate-800 [overflow-wrap:anywhere] dark:text-slate-200">{clientName}</span>
            </p>
          </section>

          <section className="pt-6" aria-labelledby="permissions-title">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 id="permissions-title" className="text-base font-bold text-slate-950 dark:text-white">
                Your permissions
              </h2>
              <p aria-live="polite" className="text-sm text-slate-600 dark:text-slate-300">
                {summary}
              </p>
            </div>
            <p className="mt-1.5 text-sm leading-5 text-slate-600 dark:text-slate-300">
              This can include bank data received through Finexer, information Sorted derives and details you add. Select only what you are comfortable sharing. You can deny the request instead.
            </p>
            <div className="mt-4 border-t border-slate-200 dark:border-slate-700">
              {scopes.map((s) => {
                const d = scopeDisclosure(s.scope, s.description);
                const inputId = `scope-${s.scope}`;
                return (
                  <label
                    key={s.scope}
                    htmlFor={inputId}
                    data-mcp-scope={s.scope}
                    className={`flex min-h-16 items-start gap-3 border-b border-slate-200 px-4 py-3 transition last:border-b-0 active:opacity-75 motion-reduce:active:opacity-100 dark:border-slate-700 ${busy ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                  >
                    <input
                      id={inputId}
                      type="checkbox"
                      name="granted_scopes"
                      autoComplete="off"
                      checked={selected.includes(s.scope)}
                      disabled={busy}
                      onChange={() => setSelected((cur) => toggleScope(cur, s.scope))}
                      className="mt-0.5 size-5 shrink-0 rounded border-slate-400 text-indigo-600 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:border-slate-500 dark:bg-slate-950 dark:focus:ring-offset-slate-900"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold leading-5 text-slate-900 dark:text-slate-100">{d.title}</span>
                      <span className="mt-1 block text-sm leading-5 text-slate-600 dark:text-slate-300">{d.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </section>

          <section data-mcp-warning className="mt-6" aria-labelledby="provider-warning-title">
            <h2 id="provider-warning-title" className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Before you share
            </h2>
            <p className="mt-1.5 text-sm leading-5 text-slate-700 dark:text-slate-200">
              This assistant provider has not been assessed by Sorted or Finexer. Its retention, training and international processing rules are its own. Data shared with it cannot be recalled.
            </p>
          </section>

          <details data-mcp-disclosure className="group mt-6 border-y border-slate-200 py-4 dark:border-slate-700">
            <summary className="flex min-h-11 cursor-pointer touch-manipulation items-center justify-between gap-3 text-sm font-semibold text-slate-900 marker:content-none [-webkit-tap-highlight-color:transparent] active:opacity-70 motion-reduce:active:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:text-slate-100 dark:focus-visible:ring-offset-slate-900 [&::-webkit-details-marker]:hidden">
              <span>What happens if I allow this?</span>
              <span className="shrink-0 text-xs font-bold text-indigo-700 group-open:hidden dark:text-indigo-300">Show details</span>
              <span className="hidden shrink-0 text-xs font-bold text-indigo-700 group-open:inline dark:text-indigo-300">Hide details</span>
            </summary>
            <p className="pb-1 pt-2 text-sm leading-5 text-slate-600 dark:text-slate-300">
              The selected information is sent to the assistant provider after you continue. Use its privacy information to decide whether its own rules are right for you.
            </p>
          </details>

          {error && (
            <p
              role="alert"
              className="mt-5 flex gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-5 text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400" />
              {error}
            </p>
          )}

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => onApprove(granted)}
              disabled={busy || granted.length === 0}
              className="min-h-12 touch-manipulation rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white [-webkit-tap-highlight-color:transparent] transition hover:bg-indigo-700 active:scale-95 motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-slate-900"
            >
              {busy ? "Preparing secure redirect…" : "Allow selected data"}
            </button>
            <button
              type="button"
              onClick={onDeny}
              disabled={busy}
              className="min-h-12 touch-manipulation rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-800 [-webkit-tap-highlight-color:transparent] transition hover:bg-slate-50 active:scale-95 motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 dark:focus-visible:ring-offset-slate-900"
            >
              Deny
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
