"use client";

// TEMPORARY PREVIEW — F23, skill: impeccable.
//
// Fictional fixture only. This is deliberately separate from the F22 consent
// contract: F22 currently accepts an optional `granted_scopes` subset on an
// approval decision, but it does not yet supply an independently verified
// assistant identity. F24 owns that trust decision. No request, persistence,
// connector activation or redirect happens in this preview.

import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

type Variant = "a" | "b";
type Mode = "light" | "dark";
type PreviewState = "ready" | "none" | "all" | "long" | "submitting" | "denied" | "error";

type Scope = {
  id: "accounts:read" | "plans:read" | "insights:read";
  title: string;
  description: string;
};

const SCOPES: Scope[] = [
  {
    id: "accounts:read",
    title: "Account information and balances",
    description: "For example, account names, balances, account activity, investment positions, your money overview and today’s brief. It does not include raw transaction rows.",
  },
  {
    id: "plans:read",
    title: "Upcoming bills, plans and tax figures",
    description: "For example, upcoming bills, recurring payments, savings goals, debt and savings positions, affordability checks, and your tax position figures.",
  },
  {
    id: "insights:read",
    title: "Spending analysis by category and merchant",
    description: "For example, spending totals by category, merchant-based insights, your spending verdict and trends. It does not include raw transaction rows.",
  },
];

const READY_SCOPES = ["accounts:read", "plans:read"];

function PreviewControl({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex min-h-11 touch-manipulation items-center rounded-xl px-3 text-xs font-semibold [-webkit-tap-highlight-color:transparent] transition active:scale-95 motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950 ${active ? "bg-white text-slate-950 shadow-sm dark:bg-slate-700 dark:text-white" : "text-slate-300 hover:bg-white/10 hover:text-white"}`}
    >
      {children}
    </a>
  );
}

function PreviewControls({ variant, mode, state }: { variant: Variant; mode: Mode; state: PreviewState }) {
  const href = (next: Partial<{ variant: Variant; mode: Mode; state: PreviewState }>) => {
    const params = new URLSearchParams({
      variant: next.variant ?? variant,
      mode: next.mode ?? mode,
      state: next.state ?? state,
    });
    return `?${params.toString()}`;
  };

  return (
    <nav aria-label="Design preview controls" className="mx-auto mb-5 flex w-fit max-w-[calc(100vw-24px)] flex-wrap justify-center gap-1 rounded-xl bg-slate-950 p-1.5 shadow-xl">
      <PreviewControl href={href({ variant: "a" })} active={variant === "a"}>A · Decision ledger</PreviewControl>
      <PreviewControl href={href({ variant: "b" })} active={variant === "b"}>B · Permission editor</PreviewControl>
      <span className="my-1 w-px bg-white/15" aria-hidden="true" />
      {(["ready", "none", "all", "long", "submitting", "denied", "error"] as PreviewState[]).map((item) => (
        <PreviewControl key={item} href={href({ state: item })} active={state === item}>
          {item === "ready" ? "Subset" : item === "none" ? "None" : item[0].toUpperCase() + item.slice(1)}
        </PreviewControl>
      ))}
      <span className="my-1 w-px bg-white/15" aria-hidden="true" />
      <PreviewControl href={href({ mode: mode === "light" ? "dark" : "light" })} active={false}>
        {mode === "light" ? "Dark" : "Light"}
      </PreviewControl>
    </nav>
  );
}

function ScopeRow({ scope, checked, disabled, onChange, variant }: {
  scope: Scope;
  checked: boolean;
  disabled: boolean;
  onChange: (id: Scope["id"]) => void;
  variant: Variant;
}) {
  const inputId = `scope-${scope.id}`;
  return (
    <label
      htmlFor={inputId}
      data-mcp-scope={scope.id}
      className={`group flex min-h-16 cursor-pointer items-start gap-3 px-4 py-3 transition active:opacity-75 motion-reduce:active:opacity-100 ${variant === "a" ? "border-b border-slate-200 last:border-b-0 dark:border-slate-700" : "rounded-xl border border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600"} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
    >
      <input
        id={inputId}
        type="checkbox"
        name="granted_scopes"
        autoComplete="off"
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(scope.id)}
        className="mt-0.5 size-5 shrink-0 rounded border-slate-400 text-indigo-600 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:border-slate-500 dark:bg-slate-950 dark:focus:ring-offset-slate-900"
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-5 text-slate-900 dark:text-slate-100">{scope.title}</span>
        <span className="mt-1 block text-sm leading-5 text-slate-600 dark:text-slate-300">{scope.description}</span>
      </span>
    </label>
  );
}

function AssistantIdentity({ long }: { long: boolean }) {
  const name = long ? "Northstar Household Planning and Financial Coaching Assistant for Families" : "Northstar Assist";
  const host = long ? "consent.northstar-household-planning.example.co.uk" : "connect.northstar.example";
  return (
    <section data-mcp-identity className="border-y border-slate-200 py-4 dark:border-slate-700" aria-label="Fictional verified assistant and redirect example">
      <div className="flex items-start justify-between gap-4">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">Fictional verification fixture</p>
        <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200">Verified host</span>
      </div>
      <p className="mt-3 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">Redirect host</p>
      <h2 className="mt-1 [overflow-wrap:anywhere] text-lg font-bold leading-6 text-slate-950 dark:text-white">{host}</h2>
      <p className="mt-3 text-sm leading-5 text-slate-600 dark:text-slate-300">Assistant name: <span className="font-semibold text-slate-800 dark:text-slate-200">{name}</span></p>
    </section>
  );
}

function WarningBlock({ variant }: { variant: Variant }) {
  return (
    <section data-mcp-warning className={variant === "a" ? "border-t border-slate-200 pt-4 dark:border-slate-700" : "rounded-xl bg-slate-100 px-4 py-4 dark:bg-slate-800"} aria-labelledby="provider-warning-title">
      <h2 id="provider-warning-title" className="text-sm font-bold text-slate-900 dark:text-slate-100">Before you share</h2>
      <p className="mt-1.5 text-sm leading-5 text-slate-700 dark:text-slate-200">
        This assistant provider has not been assessed by Sorted or Finexer. Its retention, training and international processing rules are its own. Data shared with it cannot be recalled.
      </p>
    </section>
  );
}

export default function McpConsentJourneyClient() {
  const params = useSearchParams();
  const variant: Variant = params.get("variant") === "b" ? "b" : "a";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const rawState = params.get("state");
  const state: PreviewState = rawState === "none" || rawState === "all" || rawState === "long" || rawState === "submitting" || rawState === "denied" || rawState === "error" ? rawState : "ready";
  const initial = state === "all" ? SCOPES.map((scope) => scope.id) : state === "none" ? [] : READY_SCOPES;
  const [selected, setSelected] = useState<string[]>(initial);
  const [localState, setLocalState] = useState<PreviewState | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.documentElement.style.colorScheme = mode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", mode === "dark" ? "#0f172a" : "#f0f2f7");
    return () => {
      document.documentElement.classList.remove("dark");
      document.documentElement.style.colorScheme = "";
    };
  }, [mode]);

  useEffect(() => {
    setSelected(initial);
    setLocalState(null);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderedState = localState ?? state;
  const disabled = renderedState === "submitting" || renderedState === "denied";
  const toggle = (id: Scope["id"]) => {
    if (disabled) return;
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };
  const grants = selected.length === 0 ? "No data will be shared." : `${selected.length} permission${selected.length === 1 ? "" : "s"} selected.`;
  const isDenied = renderedState === "denied";
  const isSubmitting = renderedState === "submitting";
  const isError = renderedState === "error";
  const bodyWidth = variant === "a" ? "max-w-xl" : "max-w-2xl";

  return (
    <main className="min-h-dvh bg-[#f0f2f7] px-3 py-3 text-slate-900 selection:bg-indigo-100 selection:text-indigo-950 dark:bg-[#0f172a] dark:text-slate-100 dark:selection:bg-indigo-900 dark:selection:text-indigo-100 sm:px-6 sm:py-6">
      <a href="#mcp-consent-preview" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-10 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-slate-950 focus:outline-none focus:ring-2 focus:ring-indigo-500">Skip preview controls</a>
      <PreviewControls variant={variant} mode={mode} state={state} />
      <div id="mcp-consent-preview" className={`mx-auto ${bodyWidth}`}>
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
          <div className={variant === "a" ? "px-5 pb-5 pt-6 sm:px-8 sm:pt-8" : "grid lg:grid-cols-[0.82fr_1.18fr]"}>
            <header className={variant === "b" ? "border-b border-slate-200 bg-slate-50 px-5 py-6 dark:border-slate-700 dark:bg-slate-950/60 sm:px-8 lg:border-b-0 lg:border-r" : ""}>
              <a href="/design" className="inline-flex min-h-11 touch-manipulation items-center text-sm font-semibold text-indigo-700 underline decoration-indigo-300 underline-offset-4 [-webkit-tap-highlight-color:transparent] hover:text-indigo-900 active:opacity-70 motion-reduce:active:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:text-indigo-300 dark:hover:text-indigo-100 dark:focus-visible:ring-offset-slate-900">Design previews</a>
              <h1 className="mt-5 text-balance text-2xl font-bold tracking-[-0.025em] text-slate-950 dark:text-white sm:text-3xl">Choose what to share</h1>
              <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">Pick the financial information this assistant can read. It cannot change your bank accounts or make payments.</p>
              {variant === "b" && <div className="mt-6"><AssistantIdentity long={state === "long"} /></div>}
              {variant === "b" && <div className="mt-6"><WarningBlock variant={variant} /></div>}
            </header>
            <section className={variant === "b" ? "px-5 py-6 sm:px-8" : "mt-6"} aria-labelledby="permissions-title">
              {variant === "a" && <AssistantIdentity long={state === "long"} />}
              <div className={variant === "a" ? "pt-6" : ""}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h2 id="permissions-title" className="text-base font-bold text-slate-950 dark:text-white">Your permissions</h2>
                  <p aria-live="polite" className="text-sm text-slate-600 dark:text-slate-300">{grants}</p>
                </div>
                <p className="mt-1.5 text-sm leading-5 text-slate-600 dark:text-slate-300">This can include bank data received through Finexer, information Sorted derives and details you add. Select only what you are comfortable sharing. You can deny the request instead.</p>
                <div className={variant === "a" ? "mt-4 border-y border-slate-200 dark:border-slate-700" : "mt-4 space-y-3"}>
                  {SCOPES.map((scope) => <ScopeRow key={scope.id} scope={scope} checked={selected.includes(scope.id)} disabled={disabled} onChange={toggle} variant={variant} />)}
                </div>
              </div>
              {variant === "a" && <div className="mt-6"><WarningBlock variant={variant} /></div>}
              <details data-mcp-disclosure className="group mt-6 border-y border-slate-200 py-4 dark:border-slate-700">
                <summary className="flex min-h-11 cursor-pointer touch-manipulation items-center justify-between gap-3 text-sm font-semibold text-slate-900 marker:content-none [-webkit-tap-highlight-color:transparent] active:opacity-70 motion-reduce:active:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:text-slate-100 dark:focus-visible:ring-offset-slate-900 [&::-webkit-details-marker]:hidden"><span>What happens if I allow this?</span><span className="shrink-0 text-xs font-bold text-indigo-700 group-open:hidden dark:text-indigo-300">Show details</span><span className="hidden shrink-0 text-xs font-bold text-indigo-700 group-open:inline dark:text-indigo-300">Hide details</span></summary>
                <p className="pb-1 pt-2 text-sm leading-5 text-slate-600 dark:text-slate-300">The selected information is sent to the assistant provider after you continue. Use its privacy information to decide whether its own rules are right for you.</p>
              </details>
              {isError && <p role="alert" className="mt-5 flex gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-5 text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"><span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400" />We could not prepare this request. Check the assistant and try again.</p>}
              {isDenied && <p role="status" className="mt-5 rounded-xl bg-slate-100 px-4 py-3 text-sm leading-5 text-slate-800 dark:bg-slate-800 dark:text-slate-100">Request denied. No data was shared and no redirect will happen in this preview.</p>}
              {isSubmitting && <p role="status" aria-live="polite" className="sr-only">Preparing secure redirect. No data has been shared in this preview.</p>}
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <button type="button" onClick={() => setLocalState("submitting")} disabled={disabled || selected.length === 0} className="min-h-12 touch-manipulation rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white [-webkit-tap-highlight-color:transparent] transition hover:bg-indigo-700 active:scale-95 motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-slate-900">
                  {isSubmitting ? "Preparing secure redirect…" : "Allow selected data"}
                </button>
                <button type="button" onClick={() => setLocalState("denied")} disabled={isSubmitting} className="min-h-12 touch-manipulation rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-800 [-webkit-tap-highlight-color:transparent] transition hover:bg-slate-50 active:scale-95 motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 dark:focus-visible:ring-offset-slate-900">Deny</button>
              </div>
              <p className="mt-4 text-center text-xs leading-5 text-slate-500 dark:text-slate-400">Preview only. No data is shared, saved or redirected.</p>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
