"use client";

// TEMPORARY G458 design round. Only the notification treatment varies.
// ReconnectStrip is production through fixture props; the surrounding Home
// context is illustrative, not a second HomeBrief or a financial calculation.
// All actions stay local. No permissions, account data or native plugins.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import ReconnectStrip from "@/components/ReconnectStrip";
import NotificationIcon from "@/components/notifications/NotificationIcon";
import { STATES, VARIANTS, type StateId, type VariantId } from "./fixtures";

const STATE_IDS = Object.keys(STATES) as StateId[];
const VARIANT_IDS = Object.keys(VARIANTS) as VariantId[];
const secondary = "text-[13px] leading-5 text-slate-600 dark:text-slate-300";
const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900";
const control = `inline-flex min-h-11 touch-manipulation items-center justify-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold active:opacity-70 ${focus}`;
const action = `${control} border border-slate-200 bg-white text-indigo-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-indigo-300 dark:hover:bg-slate-700`;

function Theme({ dark }: { dark: boolean }) {
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    const scheme = document.querySelector('meta[name="color-scheme"]');
    const previousScheme = scheme?.getAttribute("content");
    const existingColour = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const themeColour = existingColour ?? document.createElement("meta");
    const previousColour = themeColour.getAttribute("content");
    if (!existingColour) {
      themeColour.name = "theme-color";
      document.head.appendChild(themeColour);
    }
    // The signed-out PreferencesProvider may run after this effect.
    const apply = () => root.classList.toggle("dark", dark);
    apply();
    const observer = new MutationObserver(() => {
      if (root.classList.contains("dark") !== dark) apply();
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    scheme?.setAttribute("content", dark ? "dark" : "only light");
    themeColour.content = dark ? "#0f172a" : "#f0f2f7";
    return () => {
      observer.disconnect();
      root.classList.toggle("dark", wasDark);
      if (previousScheme == null) scheme?.removeAttribute("content");
      else scheme?.setAttribute("content", previousScheme);
      if (!existingColour) themeColour.remove();
      else if (previousColour == null) themeColour.removeAttribute("content");
      else themeColour.content = previousColour;
    };
  }, [dark]);
  return null;
}

function NotificationPrompt({ variant, state, expanded }: { variant: VariantId; state: StateId; expanded: boolean }) {
  const copy = STATES[state];
  const [acted, setActed] = useState(false);
  const helpId = `notification-next-${variant}`;
  const nextStep = <p id={helpId} role="status" className={`mt-3 ${secondary}`}>{copy.next}</p>;
  const onAction = () => setActed(true);
  const icon = <NotificationIcon name={copy.icon} size={18} className="shrink-0 text-slate-500 dark:text-slate-400" />;
  const button = <button type="button" data-notification-demo-action onClick={onAction} aria-describedby={acted ? helpId : undefined} className={`${action} mt-3 w-full`}>{copy.action}</button>;

  if (variant === "a") {
    return (
      <section aria-label="Notification permission" data-notification-preview="a" className="border-b border-slate-200 pb-3 dark:border-slate-700">
        <button type="button" data-notification-demo-action onClick={onAction} aria-describedby={acted ? helpId : undefined} className={`flex min-h-11 w-full touch-manipulation items-center gap-3 rounded-xl px-1 py-2 text-left hover:bg-slate-100 active:opacity-70 dark:hover:bg-slate-800 ${focus}`}>
          {icon}
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold">{copy.title}</span>
            <span className={`mt-0.5 block ${secondary}`}>{copy.summary}</span>
            <span className="mt-1 block text-[13px] font-semibold text-indigo-700 dark:text-indigo-300">{copy.action}</span>
          </span>
          <NotificationIcon name="caret-right" size={16} className="shrink-0 text-slate-500 dark:text-slate-400" />
        </button>
        {acted && nextStep}
      </section>
    );
  }

  if (variant === "b") {
    return (
      <section aria-labelledby={`notification-title-${variant}`} data-notification-preview="b" className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center gap-2">{icon}<h3 id={`notification-title-${variant}`} className="text-pretty text-base font-bold">{copy.title}</h3></div>
        <p className={`mt-2 ${secondary}`}>{copy.summary}</p>
        {button}
        {acted && nextStep}
      </section>
    );
  }

  return (
    <details open={expanded || undefined} data-notification-preview="c" className="group border-y border-slate-200 dark:border-slate-700">
      <summary className={`flex min-h-16 cursor-pointer touch-manipulation list-none items-center gap-3 rounded-xl px-1 py-3 hover:bg-slate-100 active:opacity-70 dark:hover:bg-slate-800 [&::-webkit-details-marker]:hidden ${focus}`}>
        {icon}
        <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold">{copy.title}</span><span className={`mt-0.5 block ${secondary}`}>{copy.disclosure}</span></span>
        <NotificationIcon name="caret-right" size={16} className="shrink-0 text-slate-500 group-open:rotate-90 dark:text-slate-400" />
      </summary>
      <div className="px-1 pb-4">
        <p className={secondary}>{copy.explanation}</p>
        {button}
        {acted && nextStep}
      </div>
    </details>
  );
}

function HomeContext({ variant, state, expanded }: { variant: VariantId; state: StateId; expanded: boolean }) {
  const [reconnecting, setReconnecting] = useState(false);
  return (
    <div data-home-context={variant} className="min-w-0 bg-[#f0f2f7] px-4 pb-5 pt-5 dark:bg-slate-900">
      <div className="mb-3 flex min-h-11 items-center gap-2">
        <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-indigo-500/15 text-[13px] font-semibold text-indigo-700 dark:text-indigo-300">A</span>
        <h2 className="text-pretty text-xl font-bold leading-tight tracking-tight">Good evening, Alex</h2>
      </div>
      <div className="space-y-3">
        <div className="[&_.truncate]:whitespace-normal">
          <ReconnectStrip providers={[{ provider: "Barclays" }]} onReconnect={() => setReconnecting(true)} />
          {reconnecting && <p role="status" className={`mt-2 ${secondary}`}>In the app, this starts reconnecting Barclays. This preview does not connect to your bank.</p>}
        </div>
        <NotificationPrompt variant={variant} state={state} expanded={expanded} />
        <p data-penny-line className="text-pretty text-[15px] leading-relaxed text-slate-700 dark:text-slate-200">Barclays needs reconnecting, so your estimate is not counting it yet.</p>
      </div>
      <section aria-labelledby={`estimate-title-${variant}`} className="mt-5 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`estimate-title-${variant}`} className="text-sm font-semibold">Left to spend</h3>
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-semibold text-amber-800 dark:bg-slate-700 dark:text-amber-200"><span aria-hidden="true" className="size-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />No headroom</span>
        </div>
        <p className="mt-5 font-mono text-[30px] font-bold leading-tight tabular-nums">£0</p>
        <p className={`mt-2 ${secondary}`}>Estimated until payday, 23 November.</p>
        <p className={`mt-3 ${secondary}`}>After the bills, plans and buffer Sorted knows about. Barclays is not counted.</p>
        <p className="mt-4 border-t border-slate-100 pt-3 text-xs leading-5 text-slate-600 dark:border-slate-700 dark:text-slate-300">An estimate from your bank data. It can be wrong, so check your bank for your latest balance. Not financial advice.</p>
      </section>
    </div>
  );
}

export default function HomeNotificationsClient() {
  const params = useSearchParams();
  const selectedVariant = params.get("variant");
  const variant: VariantId = VARIANT_IDS.find(id => id === selectedVariant) ?? "a";
  const state = STATE_IDS.find(id => id === params.get("state")) ?? "off";
  const dark = params.get("mode") === "dark";
  const compare = selectedVariant === "compare";
  const chrome = params.get("chrome") !== "0";
  const expanded = params.get("expanded") === "1";
  const variants = compare ? VARIANT_IDS : [variant];
  const href = (overrides: Record<string, string>) => `?${new URLSearchParams({ variant: compare ? "compare" : variant, state, mode: dark ? "dark" : "light", expanded: expanded ? "1" : "0", ...overrides })}`;

  return (
    <main lang="en-GB" className="min-h-dvh bg-[#f0f2f7] text-slate-900 dark:bg-slate-900 dark:text-slate-100" style={{ paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      <Theme dark={dark} />
      {chrome ? <Link href="#notification-previews" prefetch={false} scroll={false} onClick={() => document.getElementById("notification-previews")?.focus()} className={`sr-only focus:not-sr-only focus:mx-4 focus:mt-4 ${control}`}>Skip to previews</Link> : <h1 className="sr-only">Home notifications</h1>}
      {chrome && <header className="mx-auto max-w-[1360px] px-4 pb-5 pt-5 sm:px-6">
        <Link href="/design" prefetch={false} className={`${control} -ml-3 text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800`}><NotificationIcon name="arrow-left" size={16} />All design previews</Link>
        <h1 className="mt-3 text-balance text-2xl font-bold tracking-tight">Home notifications</h1>
        <p className={`mt-2 max-w-2xl ${secondary}`}>Three treatments below the bank reconnect prompt. Compare each with alerts off, permission denied and an older app.</p>
        <nav aria-label="Notification design" className="mt-4 flex flex-wrap gap-2">
          {VARIANT_IDS.map(id => <Link key={id} prefetch={false} scroll={false} href={href({ variant: id })} aria-current={!compare && variant === id ? "page" : undefined} className={`${control} ${!compare && variant === id ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "border border-slate-300 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"}`}>{id.toUpperCase()} · {VARIANTS[id].name}</Link>)}
          <Link prefetch={false} scroll={false} href={href({ variant: "compare" })} aria-current={compare ? "page" : undefined} className={`${control} ${compare ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "text-slate-700 hover:bg-slate-200 dark:text-slate-200 dark:hover:bg-slate-800"}`}>Compare all</Link>
        </nav>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <nav aria-label="Notification state" className="flex flex-wrap gap-1">
            {STATE_IDS.map(id => <Link key={id} prefetch={false} scroll={false} href={href({ state: id })} aria-current={state === id ? "page" : undefined} className={`${control} ${state === id ? "bg-indigo-600 text-white" : "text-slate-700 hover:bg-slate-200 dark:text-slate-200 dark:hover:bg-slate-800"}`}>{STATES[id].label}</Link>)}
          </nav>
          <Link prefetch={false} scroll={false} href={href({ mode: dark ? "light" : "dark" })} className={`${action} shrink-0`}>{dark ? "Use light theme" : "Use dark theme"}</Link>
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-600 dark:text-slate-300">Fictional Home context. Buttons demonstrate the next step without changing permissions or connecting to a bank.</p>
      </header>}

      <div id="notification-previews" tabIndex={-1} className={`mx-auto scroll-mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${chrome ? "max-w-[1360px] sm:px-6" : compare ? "max-w-[1360px]" : "max-w-[430px]"}`}>
        <div className={compare ? "grid items-start gap-5 lg:grid-cols-3" : chrome ? "grid items-start gap-5 lg:grid-cols-[minmax(0,430px)_minmax(0,1fr)]" : ""}>
          {variants.map(id => <section key={`${id}-${state}-${expanded}`} aria-label={`${id.toUpperCase()} · ${VARIANTS[id].name}`} className="min-w-0">
            {chrome && <h2 className="mb-2 px-4 text-base font-bold sm:px-0">{id.toUpperCase()} · {VARIANTS[id].name}</h2>}
            <div className={chrome ? "sm:overflow-hidden sm:rounded-3xl sm:border sm:border-slate-300 dark:sm:border-slate-700" : ""}><HomeContext variant={id} state={state} expanded={expanded} /></div>
            {chrome && compare && <p className={`mt-3 px-4 sm:px-0 ${secondary}`}>{VARIANTS[id].description}</p>}
          </section>)}
          {chrome && !compare && <section aria-label="About this direction" className="max-w-md px-4 pb-5 sm:px-0 lg:pt-8">
            <h2 className="text-base font-bold">What changes</h2>
            <p className={`mt-2 ${secondary}`}>{VARIANTS[variant].description}</p>
            <p className={`mt-3 ${secondary}`}>{VARIANTS[variant].benefit}</p>
            <h3 className="mt-5 text-sm font-semibold">The trade-off</h3>
            <p className={`mt-2 ${secondary}`}>{VARIANTS[variant].tradeoff}</p>
            <p className={`mt-5 ${secondary}`}>Reconnect stays first. Notification states stay neutral. The older app never claims alerts are off when it cannot check them.</p>
            {variant === "c" && <Link prefetch={false} scroll={false} href={href({ expanded: expanded ? "0" : "1" })} className={`${action} mt-4`}>{expanded ? "Show collapsed" : "Show expanded"}</Link>}
          </section>}
        </div>
      </div>
    </main>
  );
}
