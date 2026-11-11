// The permission journey is independent of React and native plugins so account
// changes, concurrent resume events and declined requests can be tested directly.
export type NotificationPermission = "checking" | "prompt" | "granted" | "denied" | "unavailable" | "unknown";
export type NotificationRegistration = "checking" | "ready" | "needed" | "off" | "unknown";
export type NotificationPlatform = "ios" | "android" | "web";
export type NotificationUnavailable = "old-app" | "install" | "browser" | null;

export interface NotificationReading {
  platform: NotificationPlatform;
  permission: Exclude<NotificationPermission, "checking">;
  registration: NotificationRegistration;
  unavailable: NotificationUnavailable;
}

export interface NotificationState extends Omit<NotificationReading, "permission"> {
  permission: NotificationPermission;
  startup: boolean;
  introduction: boolean;
  busy: boolean;
  error: string | null;
  browserGuidance: boolean;
  requestUncertain: boolean;
}

export const INITIAL_NOTIFICATION_STATE: NotificationState = {
  platform: "web", permission: "checking", registration: "checking", unavailable: null,
  startup: true, introduction: false, busy: false, error: null, browserGuidance: false, requestUncertain: false,
};

export interface NotificationDependencies {
  active: () => boolean;
  wasAsked: () => boolean;
  markAsked: () => void;
  requestOutcomeUnknown?: () => boolean;
  markRequestCompleted?: () => void;
  read: () => Promise<NotificationReading>;
  checkRegistration?: () => Promise<NotificationRegistration>;
  // request() is invoked synchronously from the user's action, preserving the
  // browser gesture. No data fetch or await may be inserted before that call.
  request: () => Promise<"granted" | "denied">;
  register: () => Promise<void>;
  unsubscribe: () => Promise<void>;
  openSettings: () => Promise<void>;
}

export function createNotificationPermissionController(deps: NotificationDependencies) {
  let state = INITIAL_NOTIFICATION_STATE;
  let running = false;
  let revision = 0;
  let inFlight: Promise<void> | null = null;
  let refreshQueued = false;
  const listeners = new Set<() => void>();
  const valid = (version: number) => running && version === revision && deps.active();
  const current = (version: number) => running && version === revision;
  const publish = (patch: Partial<NotificationState>) => {
    if (!running) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  async function refresh() {
    if (!running || !deps.active() || state.busy) return;
    if (inFlight) { refreshQueued = true; return inFlight; }
    refreshQueued = false;
    const version = revision;
    const task = (async () => {
      try {
        const reading = await deps.read();
        if (!valid(version)) return;
        const asked = deps.wasAsked();
        const requestUncertain = reading.permission === "prompt" && asked && !!deps.requestOutcomeUnknown?.();
        const permission = reading.permission === "prompt" && asked ? requestUncertain ? "unknown" : "denied" : reading.permission;
        publish({ ...reading, permission, requestUncertain, startup: false,
          introduction: permission === "prompt" && !asked,
          error: permission === "granted" && reading.registration === "ready" ? null : state.error,
        });
        // Permission decides the first-launch gate. Delivery verification
        // must not hold the product behind a slow backend status request.
        if (permission === "granted" && deps.checkRegistration) {
          let registration: NotificationRegistration = "unknown";
          try { registration = await deps.checkRegistration(); } catch {}
          if (valid(version)) publish({ registration, error: registration === "ready" ? null : state.error });
        }
      } catch {
        if (valid(version)) publish({ permission: "unknown", startup: false, introduction: false,
          error: "We could not check your notification permission. Try again.",
        });
      }
    })();
    inFlight = task;
    try { await task; } finally {
      if (inFlight === task) {
        inFlight = null;
        if (refreshQueued) { refreshQueued = false; await refresh(); }
      }
    }
  }

  async function enable() {
    if (!running || !deps.active() || state.busy) return;
    if (state.permission !== "prompt" && state.permission !== "granted") return;
    const version = ++revision;
    inFlight = null;
    const needsRequest = state.permission === "prompt";
    publish({ busy: true, error: null });
    try {
      if (needsRequest) {
        deps.markAsked();
        // Keep this before the first await in this action.
        const request = deps.request();
        const permission = await request;
        deps.markRequestCompleted?.();
        if (!valid(version)) return;
        publish({ permission, requestUncertain: false, introduction: false, startup: false });
        if (permission !== "granted") return;
      }
      if (!valid(version)) return;
      await deps.register();
      if (valid(version)) publish({ registration: "ready", introduction: false, startup: false });
    } catch {
      if (valid(version)) publish({ introduction: false, startup: false,
        error: needsRequest && state.permission === "prompt" ? "The permission request did not finish. Check your notification settings." : "Notification setup did not finish. Check your connection and try again.",
      });
    } finally {
      if (current(version)) { publish({ busy: false }); await refresh(); }
    }
  }

  async function openSettings() {
    if (!running || !deps.active() || state.busy) return;
    if (state.platform === "web") { publish({ browserGuidance: true, error: null }); return; }
    const version = ++revision;
    inFlight = null;
    publish({ busy: true, error: null });
    try { await deps.openSettings(); }
    catch {
      if (valid(version)) publish({ error: "We could not open your phone’s settings. Open Settings, find Sorted, then choose Notifications." });
    } finally { if (current(version)) { publish({ busy: false }); await refresh(); } }
  }

  async function disableBrowser() {
    if (!running || !deps.active() || state.busy || state.platform !== "web") return;
    const version = ++revision;
    inFlight = null;
    publish({ busy: true, error: null });
    try {
      await deps.unsubscribe();
      if (valid(version)) publish({ registration: "off" });
    } catch {
      if (valid(version)) publish({ error: "We could not turn off alerts in this browser. Try again." });
    } finally { if (current(version)) { publish({ busy: false }); await refresh(); } }
  }

  return {
    getSnapshot: () => state,
    getServerSnapshot: () => INITIAL_NOTIFICATION_STATE,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start() { running = true; return refresh(); },
    stop() { running = false; revision += 1; inFlight = null; refreshQueued = false; state = { ...state, busy: false }; },
    refresh, enable, openSettings, disableBrowser,
    closeBrowserGuidance() { publish({ browserGuidance: false }); void refresh(); },
    async recheckBrowser() { publish({ browserGuidance: false }); await refresh(); },
  };
}

export type NotificationController = ReturnType<typeof createNotificationPermissionController>;
