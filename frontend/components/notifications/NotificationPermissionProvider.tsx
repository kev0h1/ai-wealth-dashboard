"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { getToken } from "@/lib/auth";
import { isAppLocked, subscribeAppLock } from "@/lib/appLock";
import { PUSH_REGISTRATION_EVENT } from "@/lib/capacitorPush";
import { notificationDependencies } from "@/lib/notificationPermissions";
import { createNotificationPermissionController, INITIAL_NOTIFICATION_STATE, type NotificationController, type NotificationState } from "@/lib/notificationPermissionController";
import { SheetFrame } from "@/components/SheetFrame";
import NotificationIcon from "./NotificationIcon";
import { DeviceNotificationSettingsView, NotificationIntroduction, NotificationPermissionRowView, notificationActionClass } from "./NotificationViews";

interface PermissionContext {
  state: NotificationState;
  controller: NotificationController | null;
  blocking: boolean;
}

const empty: PermissionContext = { state: { ...INITIAL_NOTIFICATION_STATE, permission: "unavailable", startup: false }, controller: null, blocking: false };
const Context = createContext<PermissionContext>(empty);
export const useNotificationPermission = () => useContext(Context);

export function NotificationPermissionProvider({ account, children }: { account: string; children: ReactNode }) {
  const session = getToken();
  const controller = useMemo(() => createNotificationPermissionController(notificationDependencies(account, session)), [account, session]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getServerSnapshot);
  const locked = useSyncExternalStore(subscribeAppLock, isAppLocked, () => false);
  const blocking = state.startup || state.introduction;
  const content = useRef<HTMLDivElement>(null);
  const wasBlocking = useRef(false);
  const wasLocked = useRef(locked);

  useEffect(() => {
    void controller.start();
    return () => controller.stop();
  }, [controller]);

  useEffect(() => {
    if (wasLocked.current && !locked) void controller.refresh();
    wasLocked.current = locked;
  }, [controller, locked]);

  useEffect(() => {
    if (!locked && !blocking && wasBlocking.current) content.current?.focus({ preventScroll: true });
    wasBlocking.current = blocking;
  }, [blocking, locked]);

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void controller.refresh(); };
    window.addEventListener("focus", refresh);
    window.addEventListener(PUSH_REGISTRATION_EVENT, refresh);
    document.addEventListener("visibilitychange", refresh);
    let cancelled = false;
    let removeResume: (() => void) | undefined;
    const headers = (Capacitor as unknown as { PluginHeaders?: Array<{ name: string }> }).PluginHeaders;
    if (Capacitor.isNativePlatform() && (!Array.isArray(headers) || headers.some(header => header.name === "App"))) {
      void import("@capacitor/app").then(async ({ App }) => {
        const handle = await App.addListener("resume", refresh);
        if (cancelled) void handle.remove();
        else removeResume = () => { void handle.remove(); };
      }).catch(() => {});
    }
    return () => {
      cancelled = true;
      removeResume?.();
      window.removeEventListener("focus", refresh);
      window.removeEventListener(PUSH_REGISTRATION_EVENT, refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [controller]);

  return <Context.Provider value={{ state, controller, blocking }}>
    {/* Keep the biometric gate mounted. Its native lock always precedes an
        introduction; hidden product content cannot receive taps or focus. */}
    <div ref={content} hidden={blocking} inert={blocking} tabIndex={-1} className="outline-none" aria-label="Sorted">{children}</div>
    {blocking && !locked && (state.introduction ? <NotificationIntroduction native={state.platform !== "web"} busy={state.busy} onContinue={() => { void controller.enable(); }} /> : <div className="min-h-dvh bg-[#f0f2f7] dark:bg-slate-900"><p role="status" className="sr-only">Checking notification permission…</p></div>)}
    {state.browserGuidance && !locked && <SheetFrame variant="compact" title="Allow notifications in your browser" onClose={controller.closeBrowserGuidance} closeIcon={<NotificationIcon name="x" size={20} />} footer={({ closeThen }) => <button type="button" className={`${notificationActionClass} w-full`} onClick={() => closeThen(() => { void controller.recheckBrowser(); })}>Check permission</button>}>
      <ol className="list-decimal space-y-3 pl-5 text-sm leading-6 text-slate-600 dark:text-slate-300"><li>Open this site’s permissions from the controls beside its web address, or from your browser’s settings.</li><li>Find Notifications and allow them for Sorted.</li><li>Return to Sorted to check again and finish notification setup.</li></ol>
    </SheetFrame>}
  </Context.Provider>;
}

function act({ state, controller }: PermissionContext) {
  if (!controller) return;
  if (state.permission === "prompt" || (state.permission === "granted" && state.registration !== "ready" && state.registration !== "unknown")) void controller.enable();
  else if (state.permission === "denied" || state.requestUncertain || (state.permission === "granted" && state.registration === "ready" && state.platform !== "web")) void controller.openSettings();
  else void controller.refresh();
}

export function HomeNotificationPermission() {
  const context = useNotificationPermission();
  if (!context.controller) return null;
  return <NotificationPermissionRowView state={context.state} onAction={() => act(context)} />;
}

export function DeviceNotificationSettings() {
  const context = useNotificationPermission();
  return <DeviceNotificationSettingsView state={context.state} onAction={() => act(context)} onBrowserToggle={() => {
    if (context.state.registration === "ready") void context.controller?.disableBrowser();
    else void context.controller?.enable();
  }} />;
}
