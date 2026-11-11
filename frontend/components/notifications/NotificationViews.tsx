"use client";

import { useEffect, useRef } from "react";
import NotificationIcon, { type NotificationIconName } from "./NotificationIcon";
import type { NotificationState } from "@/lib/notificationPermissionController";
import type { NotificationPrefs } from "@/lib/api";
import { notificationTopics } from "@/lib/notificationTopics";

export const notificationActionClass = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 active:opacity-80 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900";
const quiet = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-100 active:opacity-70 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-200 dark:hover:bg-slate-700";
const secondary = "text-[13px] leading-5 text-slate-600 dark:text-slate-300";

/** Approved G409 A: a short explanation on the canvas, one Continue action. */
export function NotificationIntroduction({ native, busy, onContinue }: { native: boolean; busy: boolean; onContinue: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  return <main data-notification-introduction className="min-h-dvh bg-[#f0f2f7] px-4 text-slate-900 dark:bg-slate-900 dark:text-slate-100" style={{ paddingTop: "max(20px, env(safe-area-inset-top, 0px))", paddingBottom: "max(20px, env(safe-area-inset-bottom, 0px))" }}>
    <section className="mx-auto flex min-h-[520px] max-w-[558px] flex-col px-1" aria-labelledby="notification-introduction-heading">
      <NotificationIcon name="bell" size={28} className="mb-6 text-slate-600 dark:text-slate-300" />
      <h1 ref={heading} tabIndex={-1} id="notification-introduction-heading" className="max-w-[14ch] text-balance text-[28px] font-bold leading-tight tracking-tight outline-none">Keep up with your money</h1>
      <p className="mt-3 max-w-[42ch] text-sm leading-6 text-slate-600 dark:text-slate-300">Sorted can notify you when something needs a look, so you can check it in the app.</p>
      <ul className="mt-6 space-y-4">
        {([
          { icon: "calendar-dots", title: "Bills and account shortfalls", copy: "A heads-up when a payment may not clear." },
          { icon: "list-checks", title: "Payments to check", copy: "When a payment needs a category or a closer look." },
          { icon: "bell", title: "Updates about your money", copy: "New transactions, goal milestones and your pay-period digest." },
        ] as const).map(item => <li key={item.title} className="flex items-start gap-3"><NotificationIcon name={item.icon} className="mt-0.5 shrink-0 text-slate-500 dark:text-slate-400" /><div><p className="text-sm font-semibold">{item.title}</p><p className={`mt-0.5 ${secondary}`}>{item.copy}</p></div></li>)}
      </ul>
      <div className="mt-auto pt-8">
        <p className={`mb-3 ${secondary}`}>Alert topics start on. You can choose which ones you receive in Settings.</p>
        <button type="button" onClick={onContinue} disabled={busy} className={`${notificationActionClass} w-full`}>{busy ? "Checking permission…" : "Continue"}</button>
        <p className="mt-3 text-center text-xs leading-5 text-slate-600 dark:text-slate-400">{native ? "Your phone will ask you to allow notifications." : "Your browser will ask you to allow notifications."}</p>
      </div>
    </section>
  </main>;
}

export function notificationPresentation(state: NotificationState): { title: string; detail: string; action: string | null; icon: NotificationIconName } {
  const native = state.platform !== "web";
  if (state.busy && state.permission === "granted" && state.registration !== "ready") return { title: "Setting up notifications…", detail: "Permission is allowed. This device is finishing registration.", action: null, icon: "arrow-clockwise" };
  if (state.permission === "unavailable") {
    if (state.unavailable === "install") return { title: "How to turn on notifications", detail: "On iPhone, web notifications need a Home Screen app. In Safari, open Share, choose Add to Home Screen, then open Sorted there.", action: null, icon: "bell-slash" };
    if (state.unavailable === "old-app") return { title: "Notification settings unavailable", detail: "Update Sorted to check notification settings, or open your phone’s Settings, find Sorted and choose Notifications.", action: null, icon: "bell-slash" };
    return { title: "Notifications are unavailable here", detail: "This browser does not support push notifications. Use a supported browser or the Sorted app.", action: null, icon: "bell-slash" };
  }
  if (state.permission === "checking") return { title: "Checking notifications…", detail: "Your notification permission is being checked.", action: null, icon: "arrow-clockwise" };
  if (state.permission === "unknown") {
    if (state.requestUncertain) return { title: "Check notification permission", detail: "The permission request did not finish. Check whether Sorted is allowed to send alerts in your notification settings.", action: native ? "Open notification settings" : "How to allow notifications", icon: "bell-slash" };
    return { title: "Notification status unavailable", detail: "We could not check your permission. Try again.", action: "Try again", icon: "arrow-clockwise" };
  }
  if (state.permission === "denied") return { title: "Turn on notifications", detail: native ? "Allow alerts for Sorted in your phone’s notification settings." : "Allow notifications for Sorted in your browser’s site settings.", action: native ? "Open notification settings" : "How to allow notifications", icon: "bell-slash" };
  if (state.permission === "prompt") return { title: "Turn on notifications", detail: "Get bill alerts and updates about your money.", action: "Turn on notifications", icon: "bell" };
  if (state.registration === "checking") return { title: "Checking notification setup…", detail: "Permission is allowed. We are checking this device’s registration.", action: null, icon: "arrow-clockwise" };
  if (state.registration === "off") return { title: "Turn on notifications", detail: "Alerts are turned off in Sorted for this browser.", action: "Turn on notifications", icon: "bell-slash" };
  if (state.registration === "unknown") return { title: "Notification setup status unavailable", detail: "Permission is allowed. We could not confirm that this device is registered.", action: "Try again", icon: "arrow-clockwise" };
  if (state.registration !== "ready") return { title: "Finish notification setup", detail: "Permission is allowed. This device still needs to finish registering.", action: "Try again", icon: "sliders-horizontal" };
  return { title: "Notifications allowed", detail: native ? "Your phone allows alerts from Sorted." : "This browser allows alerts from Sorted.", action: native ? "Manage in phone settings" : null, icon: "bell" };
}

/** Never dismissable. The existing reconnect and transfer rows stay above it. */
export function NotificationPermissionRowView({ state, onAction }: { state: NotificationState; onAction: () => void }) {
  if (state.startup || state.permission === "checking" || (state.permission === "granted" && ["ready", "checking"].includes(state.registration))) return null;
  const view = notificationPresentation(state);
  const content = <><NotificationIcon name={view.icon} className="shrink-0 text-slate-500 dark:text-slate-400" /><span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold">{view.title}</span><span className={`mt-0.5 block ${secondary}`}>{view.detail}</span></span>{view.action && <NotificationIcon name="caret-right" size={16} className="shrink-0 text-indigo-600 dark:text-indigo-400" />}</>;
  return <section data-notification-reminder aria-label="Notification permission" className="border-y border-slate-200 text-slate-900 dark:border-slate-700 dark:text-slate-100">
    {view.action ? <button type="button" data-notification-action onClick={onAction} disabled={state.busy} aria-busy={state.busy} className="flex min-h-16 w-full items-center gap-3 rounded-lg px-1 py-3 text-left hover:bg-slate-100 active:opacity-70 disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-slate-800">{content}</button> : <div className="flex min-h-16 items-center gap-3 py-3">{content}</div>}
    {state.error && <p role="status" className={`px-1 pb-3 ${secondary}`}>{state.error}</p>}
  </section>;
}

export function DeviceNotificationSettingsView({ state, onAction, onBrowserToggle }: { state: NotificationState; onAction: () => void; onBrowserToggle: () => void }) {
  const view = notificationPresentation(state);
  const browserToggle = state.platform === "web" && state.permission === "granted" && !["checking", "unknown"].includes(state.registration);
  return <div data-device-notification-settings className="p-4 text-slate-900 dark:text-slate-100">
    <div className="flex items-start gap-3"><NotificationIcon name={view.icon} className="mt-0.5 shrink-0 text-slate-500 dark:text-slate-400" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{view.title}</p><p className={`mt-1 ${secondary}`}>{view.detail}</p></div>
      {browserToggle && <button type="button" role="switch" aria-label="Push notifications in this browser" aria-checked={state.registration === "ready"} disabled={state.busy} onClick={onBrowserToggle} className="flex min-h-11 min-w-12 shrink-0 items-center justify-center rounded-xl disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"><span aria-hidden="true" className={`flex h-6 w-12 items-center rounded-full px-0.5 ${state.registration === "ready" ? "bg-indigo-600" : "bg-slate-500"}`}><span className={`size-5 rounded-full bg-white ${state.registration === "ready" ? "translate-x-6" : ""}`} /></span></button>}
    </div>
    {view.action && !browserToggle && <button type="button" onClick={onAction} disabled={state.busy} className={`${state.permission === "granted" && state.registration === "ready" ? quiet : notificationActionClass} mt-3 w-full`}>{state.busy ? "Checking…" : view.action}{!state.busy && <NotificationIcon name="caret-right" size={16} />}</button>}
    {state.error && <p role="status" className={`mt-3 ${secondary}`}>{state.error}</p>}
  </div>;
}

export function NotificationTopicsView({ preferences, tipsEnabled, onToggle }: { preferences: NotificationPrefs; tipsEnabled: boolean; onToggle: (key: keyof NotificationPrefs) => void }) {
  return <div className="divide-y divide-slate-100 dark:divide-slate-700">
    {notificationTopics(tipsEnabled).map(topic => <button type="button" key={topic.key} role="switch" aria-checked={!!preferences[topic.key]} aria-label={topic.title} data-notification-topic={topic.key} onClick={() => onToggle(topic.key)} className="flex min-h-16 w-full items-center gap-4 px-4 py-3 text-left text-slate-900 hover:bg-slate-50 active:opacity-80 focus-visible:relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:text-slate-100 dark:hover:bg-slate-700">
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{topic.title}</span><span className={`mt-0.5 block ${secondary}`}>{topic.description}</span></span>
      <span aria-hidden="true" className={`flex h-6 w-12 shrink-0 items-center rounded-full px-0.5 ${preferences[topic.key] ? "bg-indigo-600" : "bg-slate-500"}`}><span className={`size-5 rounded-full bg-white ${preferences[topic.key] ? "translate-x-6" : ""}`} /></span>
    </button>)}
  </div>;
}
