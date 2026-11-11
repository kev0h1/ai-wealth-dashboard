import assert from "node:assert/strict";
import { api } from "../lib/api";
import { getToken, setToken } from "../lib/auth";
import { notificationDependencies, resyncWebPush } from "../lib/notificationPermissions";
import { postPushToken } from "../lib/capacitorPush";

const originals = new Map(["window", "navigator", "localStorage", "Notification"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const savedToken = getToken();
const apiNames = ["getVapidPublicKey", "subscribePush", "unsubscribePush", "registerFcmToken"];
const savedApi = Object.fromEntries(apiNames.map(key => [key, api[key]]));
const values = new Map();
const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
let subscription = null, permission = "default", requests = 0, subscriptions = 0, posts = 0, failPost = false;
const registration = {
  active: {},
  pushManager: {
    getSubscription: async () => subscription,
    subscribe: async () => {
      subscriptions++;
      subscription = { endpoint: "https://push.example.test/synthetic", toJSON: () => ({ endpoint: "https://push.example.test/synthetic" }), unsubscribe: async () => { subscription = null; return true; } };
      return subscription;
    },
  },
};
const win = Object.assign(new EventTarget(), { isSecureContext: true, localStorage: storage, matchMedia: () => ({ matches: false }) });
const notification = { get permission() { return permission; }, requestPermission() { requests++; permission = "granted"; return Promise.resolve(permission); } };
Object.assign(win, { Notification: notification, PushManager: function PushManager() {} });
Object.defineProperty(globalThis, "window", { configurable: true, value: win });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
Object.defineProperty(globalThis, "Notification", { configurable: true, value: notification });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "Synthetic desktop browser", platform: "Linux", maxTouchPoints: 0, serviceWorker: { getRegistration: async () => registration, register: async () => registration, ready: Promise.resolve(registration) } } });
api.getVapidPublicKey = async () => ({ public_key: "synthetic-public-key" });
api.subscribePush = async () => { posts++; if (failPost) throw Error("offline"); return {}; };
api.unsubscribePush = async () => ({});

try {
  setToken("g409-synthetic-session-a");
  const deps = notificationDependencies("synthetic@example.test");
  assert.equal((await deps.read()).permission, "prompt");
  assert.equal(requests, 0, "Permission reads never trigger the browser request");
  deps.markAsked(); assert.equal(deps.wasAsked(), true);
  const request = deps.request();
  assert.equal(requests, 1, "Actual browser adapter preserves the click stack");
  assert.equal(await request, "granted");

  failPost = true;
  await assert.rejects(deps.register(), /offline/);
  assert.equal(subscriptions, 1);
  assert.ok(subscription, "Local subscription exists even when the backend upload fails");
  assert.equal((await deps.read()).registration, "needed", "A local subscription is not false proof of a failed backend upload");
  const reload = notificationDependencies("synthetic@example.test");
  assert.equal((await reload.read()).registration, "needed", "Incomplete upload survives a controller/page reload");
  failPost = false; await reload.register();
  assert.equal(subscriptions, 1, "Retry reuses the existing browser subscription");
  assert.equal((await reload.read()).registration, "ready");
  await reload.unsubscribe();
  assert.equal((await reload.read()).registration, "off");
  assert.equal(posts, 2);
  assert.equal(requests, 1, "Registration retry and opt-out never re-prompt");

  // A server-confirmed opt-out must survive a browser cleanup failure and
  // the background repair that runs on the next sign-in.
  await reload.register();
  subscription.unsubscribe = async () => false;
  await assert.rejects(reload.unsubscribe(), /did not remove/);
  assert.ok(subscription);
  assert.equal((await reload.read()).registration, "off");
  const beforeRepair = posts;
  await resyncWebPush("synthetic@example.test");
  assert.equal(posts, beforeRepair, "Background repair respects an explicit browser opt-out");
  await reload.register();
  let finishRepair, deletes = 0;
  api.subscribePush = async () => { posts++; await new Promise(resolve => { finishRepair = resolve; }); return {}; };
  api.unsubscribePush = async () => { deletes++; return {}; };
  const repair = resyncWebPush("synthetic@example.test");
  // Reach the network request, then let the user turn alerts off.
  while (!finishRepair) await Promise.resolve();
  await assert.rejects(reload.unsubscribe(), /did not remove/);
  finishRepair(); await repair;
  assert.equal(deletes, 2, "Late background repair is removed after a concurrent explicit opt-out");
  assert.equal((await reload.read()).registration, "off");
  const postsBeforeSwitch = posts;

  let resolveKey;
  api.getVapidPublicKey = () => new Promise(resolve => { resolveKey = resolve; });
  setToken("g409-synthetic-session-old");
  const old = notificationDependencies("old@example.test");
  const pending = old.register();
  setToken("g409-synthetic-session-new");
  resolveKey({ public_key: "synthetic-public-key" });
  await assert.rejects(pending, /session changed/);
  assert.equal(posts, postsBeforeSwitch, "Account switch blocks the old operation before any new-user POST");
  assert.equal(subscriptions, 2, "Account switch also prevents creating a new local subscription");

  let tokenPosts = 0;
  api.registerFcmToken = async () => { tokenPosts++; return {}; };
  await postPushToken("synthetic-device", "android", "g409-synthetic-session-old");
  assert.equal(tokenPosts, 0, "Late native token events cannot upload with another signed-in session");
  const getStored = storage.getItem, setStored = storage.setItem;
  storage.getItem = () => { throw Error("storage unavailable"); };
  storage.setItem = () => { throw Error("storage unavailable"); };
  const mixedCase = notificationDependencies("Mixed.Case@example.test");
  mixedCase.markAsked();
  const lowerCase = notificationDependencies("mixed.case@example.test");
  assert.equal(lowerCase.wasAsked(), true, "The in-memory fallback uses the same normalised identity as storage");
  assert.equal(lowerCase.requestOutcomeUnknown(), true);
  lowerCase.markRequestCompleted();
  assert.equal(mixedCase.requestOutcomeUnknown(), false);
  storage.getItem = getStored; storage.setItem = setStored;
  console.log("G409 adapter: direct browser request, failed-upload recovery, opt-outs, reload and account/session boundaries passed");
} finally {
  for (const key of apiNames) api[key] = savedApi[key];
  setToken(savedToken);
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}
