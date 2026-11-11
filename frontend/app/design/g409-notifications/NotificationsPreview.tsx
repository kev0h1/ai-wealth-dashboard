"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Bell, BellOff, CalendarDays, ChevronRight, ListChecks, RefreshCw, Settings2 } from "lucide-react";
import HomeGreetingHeader from "@/components/HomeGreetingHeader";
import ReconnectStrip from "@/components/ReconnectStrip";
import SafeToSpendCard from "@/components/SafeToSpendCard";
import { SheetFrame } from "@/components/SheetFrame";
import { FIGURE_DATA, spendFromForPool } from "../safe-to-spend-figure/fixtures";
import { defaultTopics, initialState, PLATFORMS, SCENARIOS, TOPICS, type Permission, type Platform, type Scenario, type Surface } from "./fixtures";
import styles from "./preview.module.css";

const primary = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 active:opacity-80 disabled:opacity-60";
const quiet = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-100 active:opacity-70 dark:text-slate-200 dark:hover:bg-slate-800";
const control = `${quiet} border border-slate-300 dark:border-slate-600`;
const secondary = "text-[13px] leading-5 text-slate-600 dark:text-slate-300";
const card = "rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none";

export default function NotificationsPreview() {
  const params = useSearchParams();
  const variant = params.get("variant") === "b" ? "b" : "a";
  const scenario = SCENARIOS.find(item => item.value === params.get("state"))?.value ?? "first-launch";
  const platform = PLATFORMS.find(item => item.value === params.get("platform"))?.value ?? "ios";
  const dark = params.get("mode") === "dark";
  const tips = params.get("tips") === "1";
  const clean = params.get("clean") === "1";
  return <Preview key={`${variant}-${scenario}-${platform}-${dark}-${tips}`} {...{ variant, scenario, platform, dark, tips, clean }} />;
}

function Preview({ variant, scenario, platform, dark, tips, clean }: { variant: "a" | "b"; scenario: Scenario; platform: Platform; dark: boolean; tips: boolean; clean: boolean }) {
  const initial = initialState(scenario, platform);
  const [surface, setSurface] = useState<Surface>(initial.surface);
  const [permission, setPermission] = useState<Permission>(initial.permission);
  const [registered, setRegistered] = useState(initial.registered);
  const [topics, setTopics] = useState(() => defaultTopics(scenario === "saved-choices"));
  const [sheet, setSheet] = useState<"request" | "settings" | "browser" | null>(null);
  const [notice, setNotice] = useState("");
  const [settingsFailed, setSettingsFailed] = useState(false);
  const [openWillFail, setOpenWillFail] = useState(scenario === "settings-error");
  const [ready, setReady] = useState(false);
  const headingRef = useRef<HTMLDivElement>(null);
  const previousSurface = useRef(surface);
  const native = platform === "ios" || platform === "android" || platform === "android-legacy";
  const ScreenHeading = clean ? "h1" : "h2";
  const platformLabel = PLATFORMS.find(item => item.value === platform)!.label;
  const visibleTopics = TOPICS.filter(item => tips || item.key !== "insights");

  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    const oldScheme = root.style.colorScheme;
    root.classList.toggle("dark", dark);
    root.style.colorScheme = dark ? "dark" : "light";
    setReady(true);
    return () => { root.classList.toggle("dark", wasDark); root.style.colorScheme = oldScheme; };
  }, [dark]);

  useEffect(() => {
    if (previousSurface.current === surface) return;
    previousSurface.current = surface;
    headingRef.current?.focus();
  }, [surface]);

  const href = (patch: Record<string, string>) => `/design/g409-notifications?${new URLSearchParams({ variant, state: scenario, platform, mode: dark ? "dark" : "light", tips: tips ? "1" : "0", ...patch })}`;
  const go = (next: Surface) => { setSurface(next); setNotice(""); };
  const request = () => { setNotice(""); setSheet("request"); };
  const decide = (allow: boolean) => {
    setPermission(allow ? "granted" : "denied");
    setRegistered(allow);
    setSurface("home");
    setNotice(allow ? "Preview: permission allowed and this example device registered." : "Preview: permission declined. The Home reminder stays available.");
  };
  const openSettings = () => {
    setNotice("");
    if (openWillFail) { setOpenWillFail(false); setSettingsFailed(true); return; }
    setSettingsFailed(false);
    setSheet("settings");
  };
  const retrySetup = () => {
    setRegistered(true);
    setNotice("Preview: device setup retried. Permission was already allowed; no permission request was shown.");
  };

  const permissionAction = () => {
    if (permission === "prompt") request();
    else if (permission === "denied") native ? openSettings() : setSheet("browser");
    else if (permission === "granted" && !registered) retrySetup();
    else if (permission === "unknown" || permission === "checking") {
      setPermission("denied");
      setNotice("Preview: the permission check completed. Notifications are off.");
    }
  };

  const blockedCopy = native
    ? "Allow alerts for Sorted in your phone’s notification settings."
    : "Allow notifications for Sorted in your browser’s site settings.";

  const unavailable = platform === "ios-web"
    ? { title: "Add Sorted to your Home Screen", copy: "On iPhone, web notifications need a Home Screen app. In Safari, open Share, choose Add to Home Screen, then open Sorted there.", action: "How to turn on notifications" }
    : platform === "old-app"
      ? { title: "Update Sorted to manage notifications", copy: "This version cannot check notification settings. Update Sorted, or check its notification permission in your phone’s Settings.", action: "Notification settings unavailable" }
      : { title: "Notifications are unavailable here", copy: "This browser does not support push notifications. Use a supported browser or the Sorted app.", action: "Notification settings unavailable" };

  const reminderTitle = permission === "granted" ? "Finish notification setup" : permission === "unknown" ? "Notification status unavailable" : permission === "checking" ? "Checking notifications…" : permission === "unavailable" ? unavailable.action : "Turn on notifications";
  const reminderCopy = permission === "granted" ? "Permission is allowed. This device still needs to finish registering." : permission === "unknown" ? "We could not check your permission. Try again." : permission === "checking" ? "Your notification permission is being checked." : permission === "unavailable" ? unavailable.copy : permission === "prompt" ? "Get bill alerts and updates about your money." : blockedCopy;
  const actionLabel = permission === "granted" || permission === "unknown" || permission === "checking" ? "Try again" : permission === "prompt" ? "Turn on notifications" : native ? "Open notification settings" : "How to allow notifications";
  const needsReminder = permission !== "granted" || !registered;

  function permissionReminder() {
    if (!needsReminder) return null;
    const unavailableStatus = permission === "unavailable";
    const Icon = permission === "unknown" || permission === "checking" ? RefreshCw : permission === "granted" ? Settings2 : BellOff;
    return <section data-notification-reminder className={variant === "a" ? "border-y border-slate-200 dark:border-slate-700" : card} aria-label="Notification permission">
      {variant === "a" && !unavailableStatus ? <button type="button" data-permission-action onClick={permissionAction} disabled={permission === "checking"} className="flex min-h-16 w-full items-center gap-3 px-1 py-3 text-left hover:bg-slate-100 active:opacity-70 disabled:opacity-70 dark:hover:bg-slate-800">
        <Icon size={18} aria-hidden="true" className="shrink-0 text-slate-500 dark:text-slate-400" />
        <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold">{reminderTitle}</span><span className={`mt-0.5 block ${secondary}`}>{reminderCopy}</span></span>
        <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-indigo-600 dark:text-indigo-400" />
      </button> : <div className={variant === "a" ? "py-3" : "p-4"}>
        <div className="flex items-start gap-3"><Icon size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-slate-500 dark:text-slate-400" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{reminderTitle}</p><p className={`mt-1 ${secondary}`}>{reminderCopy}</p></div></div>
        {!unavailableStatus && permission !== "checking" && <button type="button" data-permission-action onClick={permissionAction} className={`${quiet} mt-2 w-full justify-between text-indigo-700 dark:text-indigo-300`}>{actionLabel}<ChevronRight size={16} aria-hidden="true" /></button>}
      </div>}
      {settingsFailed && <div role="status" className="px-4 pb-4"><p className={secondary}>We could not open your phone’s settings. Open Settings, find Sorted, then choose Notifications.</p><button type="button" onClick={openSettings} className={quiet}>Try opening settings again</button></div>}
    </section>;
  }

  function permissionStatus() {
    const title = permission === "granted" ? "Notifications allowed" : permission === "prompt" ? "Turn on notifications" : permission === "denied" ? "Notifications are off" : permission === "unknown" ? "Notification status unavailable" : permission === "checking" ? "Checking notifications…" : unavailable.title;
    const copy = permission === "granted" ? registered ? native ? "Your phone allows alerts from Sorted." : "This browser allows alerts from Sorted." : "Permission is allowed, but this device has not finished registering." : permission === "prompt" ? "Get bill alerts and updates about your money." : permission === "denied" ? blockedCopy : permission === "unknown" ? "We could not check your permission. Try again." : permission === "checking" ? "Your notification permission is being checked." : unavailable.copy;
    return <div className="p-4"><div className="flex items-start gap-3"><Bell size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-slate-500 dark:text-slate-400" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{title}</p><p className={`mt-1 ${secondary}`}>{copy}</p></div></div>
      {permission === "granted" && registered ? native && <button type="button" onClick={openSettings} className={`${quiet} mt-3 w-full justify-between`}>Manage in phone settings<ChevronRight size={16} aria-hidden="true" /></button> : !["unavailable", "checking"].includes(permission) && <button type="button" data-permission-action onClick={permissionAction} className={`${primary} mt-3 w-full`}>{actionLabel}</button>}
      {settingsFailed && <p role="status" className={`mt-3 ${secondary}`}>We could not open your phone’s settings. Open Settings, find Sorted, then choose Notifications.</p>}
    </div>;
  }

  return <div data-g409-preview data-ready={ready} data-variant={variant} data-surface={surface} data-permission={permission} data-registered={registered} className={`${styles.preview} min-h-dvh bg-[#f0f2f7] text-slate-900 dark:bg-slate-900 dark:text-slate-100`}>
    <a href="#notification-example" className="sr-only focus:not-sr-only focus:inline-flex focus:min-h-11 focus:items-center focus:px-4">Skip to the example</a>
    <div className={`mx-auto px-4 pb-10 ${clean ? "max-w-[590px]" : "max-w-[1080px] lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-12"}`}>
      {!clean && <aside className="border-b border-slate-300 py-5 dark:border-slate-700 lg:self-start lg:border-b-0">
        <Link href="/design" className={`${quiet} -ml-3`}><ArrowLeft size={16} aria-hidden="true" />All previews</Link>
        <h1 className="mt-1 text-xl font-bold">Notifications</h1>
        <p className={`mt-2 ${secondary}`}>G409 design preview. Try both introductions, the Home reminder and Settings.</p>
        <nav aria-label="Design variants" className="mt-3 flex flex-wrap gap-2">{[["a", "A · Quiet introduction"], ["b", "B · Example first"]].map(([value, label]) => <Link key={value} href={href({ variant: value })} aria-current={variant === value ? "page" : undefined} className={`${control} ${variant === value ? "bg-indigo-600 text-white hover:bg-indigo-700 dark:text-white dark:hover:bg-indigo-700" : ""}`}>{label}</Link>)}</nav>
        <p className={`mt-3 ${secondary}`}>{variant === "a" ? "A explains the alert topics on the canvas. Home uses one quiet, fully tappable row." : "B starts with one example alert. Home gives the explanation and settings action their own space."}</p>
        <details className="mt-2"><summary className="flex min-h-11 cursor-pointer items-center text-[13px] font-semibold">Examples and display</summary>
          <nav aria-label="Example states" className="flex flex-wrap gap-2 py-2">{SCENARIOS.map(item => <Link key={item.value} href={href({ state: item.value })} aria-current={scenario === item.value ? "page" : undefined} className={control}>{item.label}</Link>)}</nav>
          <nav aria-label="Example device" className="mt-3 flex flex-wrap gap-2">{PLATFORMS.map(item => <Link key={item.value} href={href({ platform: item.value })} aria-current={platform === item.value ? "page" : undefined} className={control}>{item.label}</Link>)}</nav>
          <nav aria-label="Example display" className="mt-3 flex flex-wrap gap-2"><Link href={href({ mode: dark ? "light" : "dark" })} className={control}>{dark ? "Light theme" : "Dark theme"}</Link><Link href={href({ tips: tips ? "0" : "1" })} className={control}>{tips ? "Hide optional tips topic" : "Show optional tips topic"}</Link></nav>
        </details>
        <p className="mt-3 text-xs leading-5 text-slate-600 dark:text-slate-400">Local examples only. The permission request and phone settings are simulated. This page never changes your device permission or saved choices.</p>
      </aside>}

      <main id="notification-example" className={`${styles.surface} mx-auto w-full min-w-0 max-w-[590px] scroll-mt-5`}>
        {!clean && <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400"><span>{platformLabel}</span><span>Fictional account and alerts</span></div>}
        <div ref={headingRef} tabIndex={-1} className="rounded-xl outline-none" data-example-heading>
          {surface === "intro" ? <section aria-labelledby="intro-heading" className={`${styles.intro} ${variant === "b" ? `${card} p-5 sm:p-6` : "px-1"}`}>
            {variant === "a" ? <>
              <Bell size={28} aria-hidden="true" className="mb-6 text-slate-600 dark:text-slate-300" />
              <ScreenHeading id="intro-heading" className="max-w-[14ch] text-balance text-[28px] font-bold leading-tight tracking-tight">Keep up with your money</ScreenHeading>
              <p className={`mt-3 max-w-[42ch] text-sm leading-6 text-slate-600 dark:text-slate-300`}>Sorted can notify you when something needs a look, so you can check it in the app.</p>
              <ul className="mt-6 space-y-4">
                {[
                  { Icon: CalendarDays, title: "Bills and account shortfalls", copy: "A heads-up when a payment may not clear." },
                  { Icon: ListChecks, title: "Payments to check", copy: "When a payment needs a category or a closer look." },
                  { Icon: Bell, title: "Updates about your money", copy: "New transactions, goal milestones and your pay-period digest." },
                ].map(({ Icon, title, copy }) => <li key={title} className="flex items-start gap-3"><Icon size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-slate-500 dark:text-slate-400" /><div><p className="text-sm font-semibold">{title}</p><p className={`mt-0.5 ${secondary}`}>{copy}</p></div></li>)}
              </ul>
            </> : <>
              <ScreenHeading id="intro-heading" className="max-w-[16ch] text-balance text-[28px] font-bold leading-tight tracking-tight">A heads-up when it matters</ScreenHeading>
              <p className={`mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300`}>Get bill alerts and updates about your money, even when Sorted is closed.</p>
              <div className="my-6 border-y border-slate-200 py-5 dark:border-slate-600" aria-label="Example notification">
                <div className="flex items-center gap-2"><Bell size={16} aria-hidden="true" className="text-slate-500 dark:text-slate-400" /><span className="text-xs font-semibold">Sorted</span><span className="ml-auto text-xs text-slate-600 dark:text-slate-400">Example</span></div>
                <p className="mt-3 text-sm font-semibold">A bill needs a look</p><p className={`mt-1 ${secondary}`}>An upcoming payment may not clear. Open Sorted to check.</p>
              </div>
              <p className={secondary}>You can also hear about new transactions, payments to check, goal milestones and your pay period.</p>
            </>}
            <div className={styles.introFooter}>
              <p className={`mb-3 ${secondary}`}>Alert topics start on. You can choose which ones you receive in Settings.</p>
              <button type="button" data-intro-continue onClick={request} className={`${primary} w-full`}>Continue</button>
              <p className="mt-3 text-center text-xs leading-5 text-slate-600 dark:text-slate-400">{native ? "Your phone will ask you to allow notifications." : "Your browser will ask you to allow notifications."}</p>
            </div>
          </section> : surface === "home" ? <>
            <div onClickCapture={event => { const link = (event.target as HTMLElement).closest("a"); if (link) { event.preventDefault(); event.stopPropagation(); if (link.getAttribute("href") === "/settings") go("settings"); else setNotice("Preview only. No connected account is opened."); } }}><HomeGreetingHeader greeting="Hi, Alex" avatarInitials="AT" /></div>
            <div className="space-y-3" data-home-attention>
              <div data-reconnect-context><ReconnectStrip providers={[{ provider: "Monzo", provider_id: "monzo", account_count: 1 }]} onReconnect={() => setNotice("Preview only. No bank connection is opened.")} /></div>
              <div data-transfer-context className={`${card} flex items-center gap-3 px-4 py-3`}><ListChecks size={18} aria-hidden="true" className="shrink-0 text-slate-500 dark:text-slate-400" /><p className="min-w-0 flex-1 text-[13px]">2 payments need a look</p><button type="button" onClick={() => setNotice("Preview only. No payment record is opened.")} className={quiet}>Check</button></div>
              {permissionReminder()}
            </div>
            <div className="mt-5" data-home-hero onClickCapture={event => { if ((event.target as HTMLElement).closest("a,button")) { event.preventDefault(); event.stopPropagation(); setNotice("Preview only. This is the existing Home hero with fictional figures."); } }}>
              <SafeToSpendCard data={FIGURE_DATA["on-track"]} spendFrom={spendFromForPool(105)} previewBalancesVisible />
            </div>
            <button type="button" data-show-settings onClick={() => go("settings")} className={`${quiet} mt-3 w-full`}>Notification preferences<ChevronRight size={16} aria-hidden="true" /></button>
          </> : <>
            <button type="button" onClick={() => go("home")} className={`${quiet} -ml-3`}><ArrowLeft size={16} aria-hidden="true" />Home</button>
            <ScreenHeading className="mt-1 text-xl font-bold">Notifications</ScreenHeading>
            <section aria-labelledby="device-heading" className="mt-5"><h3 id="device-heading" className="mb-2 text-[13px] font-semibold">Device permission and delivery</h3><div className={card}>{permissionStatus()}</div></section>
            <section aria-labelledby="topics-heading" className="mt-5"><h3 id="topics-heading" className="mb-2 text-[13px] font-semibold">Notify me about</h3><p className={`mb-3 ${secondary}`}>{permission !== "granted" || !registered ? "Your choices are saved and apply once notifications are allowed and this device is registered." : "These choices apply while notifications are on."}</p>
              <div className={`${card} divide-y divide-slate-100 dark:divide-slate-700`}>
                {visibleTopics.map(item => <button type="button" key={item.key} role="switch" aria-checked={topics[item.key]} aria-label={item.title} data-topic={item.key} onClick={() => { setTopics(current => ({ ...current, [item.key]: !current[item.key] })); setNotice("Preview: notification preference saved in this example only."); }} className="flex min-h-16 w-full items-center gap-4 px-4 py-3 text-left hover:bg-slate-50 active:opacity-80 first:rounded-t-2xl last:rounded-b-2xl dark:hover:bg-slate-700">
                  <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{item.title}</span><span className={`mt-0.5 block ${secondary}`}>{item.description}</span></span>
                  <span aria-hidden="true" className={`flex h-6 w-12 shrink-0 items-center rounded-full px-0.5 ${topics[item.key] ? "bg-indigo-600" : "bg-slate-500 dark:bg-slate-500"}`}><span className={`h-5 w-5 rounded-full bg-white ${topics[item.key] ? "translate-x-6" : ""}`} /></span>
                </button>)}
              </div>
            </section>
          </>}
        </div>
        <p role="status" aria-live="polite" className={`mt-3 min-h-5 ${secondary}`}>{notice}</p>
        {surface !== "intro" && !clean && <div className="mt-5 border-t border-slate-300 pt-3 dark:border-slate-700"><p className="text-xs leading-5 text-slate-600 dark:text-slate-400">Preview controls</p><div className="mt-1 flex flex-wrap gap-2"><button type="button" className={quiet} onClick={() => go(surface === "home" ? "settings" : "home")}>{surface === "home" ? "See Settings" : "See Home"}</button>{permission === "checking" && <button type="button" className={control} onClick={permissionAction}>Finish simulated check</button>}{permission === "granted" && native && <button type="button" className={control} onClick={() => { setPermission("denied"); setRegistered(false); setNotice("Preview: notification permission switched off while away. The app has checked again on return."); }}>Simulate permission switched off</button>}{permission === "granted" && <button type="button" className={control} onClick={() => { setRegistered(false); setNotice("Preview: permission stays allowed but device registration needs retry."); }}>Simulate incomplete setup</button>}</div></div>}
      </main>
    </div>

    {sheet && <SheetFrame variant="compact" title={sheet === "request" ? "Simulated permission request" : sheet === "settings" ? "Simulated phone settings" : "Allow notifications in your browser"} description="Design preview only. Your real permission is unchanged." themeClass={dark ? "dark" : undefined} onClose={() => setSheet(null)} footer={({ closeThen }) => sheet === "request" ? <div className="space-y-2"><button type="button" data-simulate-allow className={`${primary} w-full`} onClick={() => closeThen(() => decide(true))}>Simulate Allow</button><button type="button" data-simulate-deny className={`${quiet} w-full`} onClick={() => closeThen(() => decide(false))}>Simulate Don’t allow</button></div> : sheet === "settings" ? <div className="space-y-2"><button type="button" data-return-enabled className={`${primary} w-full`} onClick={() => closeThen(() => { setPermission("granted"); setRegistered(true); setNotice("Preview: notifications enabled in phone settings. Permission checked again and device registered on return."); if (surface === "intro") setSurface("home"); })}>Return with notifications on</button><button type="button" data-return-unchanged className={`${quiet} w-full`} onClick={() => closeThen(() => setNotice("Preview: returned with permission unchanged."))}>Return without changing permission</button></div> : <div className="space-y-2"><button type="button" data-browser-recheck className={`${primary} w-full`} onClick={() => closeThen(() => { setPermission("granted"); setRegistered(false); setNotice("Preview: browser permission rechecked and allowed. Finish setup to subscribe this browser."); })}>Simulate permission now allowed</button><button type="button" className={`${quiet} w-full`} onClick={() => closeThen(() => {})}>Keep permission off</button></div>}>
      {sheet === "request" ? <><p className="text-sm leading-6 text-slate-600 dark:text-slate-300">In the app, this is where {native ? "your phone" : "your browser"} asks whether Sorted may send notifications. This preview does not open the real permission request.</p><p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">Choose an outcome to see what happens next.</p></> : sheet === "settings" ? <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">{platform === "ios" ? "The app opens Sorted’s page in iPhone Settings. Choose Notifications, then turn on Allow Notifications." : "The app opens Sorted’s notification settings in Android Settings. Turn on notifications for Sorted."} On return, Sorted checks permission again.</p> : <ol className="list-decimal space-y-3 pl-5 text-sm leading-6 text-slate-600 dark:text-slate-300"><li>Open this site’s permissions from the controls beside its web address, or from your browser’s settings.</li><li>Find Notifications and allow them for Sorted.</li><li>Return to Sorted to check again and finish notification setup.</li></ol>}
    </SheetFrame>}
  </div>;
}
