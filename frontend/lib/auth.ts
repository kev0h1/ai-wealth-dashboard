import { Capacitor } from "@capacitor/core";

// A123: where the session token lives.
//   web / PWA: localStorage, exactly as before.
//   native (Capacitor iOS / Android): iOS Keychain / Android Keystore-backed
//   storage via @aparajita/capacitor-secure-storage. On native the token is
//   NEVER written to localStorage (the Android WebView backs that with an
//   append-only leveldb log that keeps deleted values on disk).
//
// getToken() stays synchronous over an in-memory cache so the ~100 sync
// authHeaders() call sites are untouched. On native the cache is filled by
// hydrateToken(), which AuthProvider awaits while `checking` is true.
//
// This is the ONLY file allowed to name the storage key (guarded by
// scripts/auth-token-store.test.mjs).
const TOKEN_KEY = "wealth_session_token";

// iOS Keychain class 1 = WhenUnlockedThisDeviceOnly (KeychainAccess enum in
// the plugin). Kevin-approved 2026-09-29; iCloud sync off. Ignored on Android.
const KEYCHAIN_WHEN_UNLOCKED_THIS_DEVICE_ONLY = 1;
const HYDRATE_TIMEOUT_MS = 3000;

// Minimal shape of the plugin we use. Declared locally (no `declare module`)
// so tsc passes whether or not the package is installed, and the real
// package types are never shadowed.
export interface SecureStore {
  get(key: string, convertDate?: boolean, sync?: boolean): Promise<unknown>;
  set(key: string, data: string, convertDate?: boolean, sync?: boolean, access?: number): Promise<void>;
  remove(key: string, sync?: boolean): Promise<boolean>;
}

export interface TokenStoreEnv {
  isNative: () => boolean;
  loadSecure: () => Promise<SecureStore>;
  // A133: true when this binary has the native SecureStorage plugin compiled
  // in. See pluginMissing() below for why this is checked up front.
  pluginImplemented: () => boolean;
  storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  timeoutMs: number;
}

const defaultEnv: TokenStoreEnv = {
  isNative: () => {
    try { return Capacitor.isNativePlatform(); } catch { return false; }
  },
  loadSecure: async () => {
    // Dynamic import, only reached on native, so the web bundle never
    // executes it. @ts-ignore (not expect-error) so it is fine both before
    // the package is installed and after (real types then apply, we cast).
    // @ts-ignore
    const mod = await import("@aparajita/capacitor-secure-storage");
    return (mod as unknown as { SecureStorage: SecureStore }).SecureStorage;
  },
  pluginImplemented: () => {
    // Capacitor injects PluginHeaders (one entry per natively-registered
    // plugin) before any page JS runs. If the array is absent we cannot
    // tell, so assume implemented (the secure path is the safe default).
    try {
      const headers = (Capacitor as unknown as { PluginHeaders?: Array<{ name: string }> }).PluginHeaders;
      return Array.isArray(headers) ? headers.some((h) => h.name === "SecureStorage") : true;
    } catch { return true; }
  },
  storage: () => {
    try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
  },
  timeoutMs: HYDRATE_TIMEOUT_MS,
};

let env: TokenStoreEnv = defaultEnv;
let _memoryToken: string | null = null;
let _hydrating: Promise<void> | null = null;
// Bumped by every set/clear so a slow hydrate can never overwrite a newer write.
let _epoch = 0;
// Serialises secure-storage writes so set-then-clear (or reverse) lands in order.
let _writeChain: Promise<unknown> = Promise.resolve();

function legacyGet(): string | null {
  try { return env.storage()?.getItem(TOKEN_KEY) ?? null; } catch { return null; }
}
function legacyRemove() {
  try { env.storage()?.removeItem(TOKEN_KEY); } catch {}
}

// A133 (Kevin to confirm, remove once every installed binary has the plugin):
// the ONE place that decides whether to fall back to the pre-A123
// localStorage token store. True only when the native SecureStorage plugin is
// genuinely absent from this binary (or a call surfaced the UNIMPLEMENTED
// error); a timeout or any other error is NOT a reason to fall back.
//
// Checked up front rather than only from the error, because with Capacitor
// 8 and @aparajita/capacitor-secure-storage 8.0.1 a call to a plugin the
// native side does not implement never rejects: registerPlugin's wrapper
// re-invokes itself in an endless microtask loop (the JS impl's methods are
// the proxy's own wrappers), which freezes the JS thread and starves every
// setTimeout, so withTimeout could not rescue it either.
let _pluginWarned = false;
function pluginMissing(err?: unknown): boolean {
  let missing = false;
  try { missing = !env.pluginImplemented(); } catch {}
  if (!missing && err !== undefined) {
    const e = err as { code?: unknown; message?: unknown } | null;
    missing = !!e && (e.code === "UNIMPLEMENTED" || /not implemented/i.test(String(e.message ?? "")));
  }
  if (missing && !_pluginWarned) {
    _pluginWarned = true;
    console.warn("[auth] A123/A133: native secure-storage plugin not implemented in this binary; using localStorage token store until the app is updated");
  }
  return missing;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("secure storage timeout")), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

function queueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = _writeChain.then(fn, fn);
  _writeChain = run.catch(() => {});
  return run;
}

export function getToken(): string | null {
  if (_memoryToken) return _memoryToken;
  if (env.isNative()) return null; // native: memory only, filled by hydrateToken()
  return legacyGet(); // web: unchanged lazy localStorage read
}

async function doHydrate(): Promise<void> {
  const startEpoch = _epoch;
  const assign = (t: string | null) => { if (_epoch === startEpoch) _memoryToken = t; };

  if (!env.isNative() || pluginMissing()) {
    assign(legacyGet());
    return;
  }

  let secure: SecureStore | undefined;
  let stored: unknown;
  try {
    // loadSecure() (a dynamic import) is inside the timeout too, so a hung
    // import can never leave AuthProvider's `checking` true forever.
    stored = await withTimeout(
      (async () => {
        secure = await env.loadSecure();
        return secure.get(TOKEN_KEY, false, false);
      })(),
      env.timeoutMs,
    );
  } catch (err) {
    if (pluginMissing(err)) { assign(legacyGet()); return; }
    // Read error or timeout: signed out. Deliberately NO localStorage
    // fallback here, and the legacy value is left alone for a later launch.
    console.warn("[auth] secure token read failed", err);
    assign(null);
    return;
  }

  if (typeof stored === "string" && stored) {
    assign(stored);
    legacyRemove(); // stale plaintext copy from a pre-A123 build
    return;
  }

  // Nothing in secure storage: migrate a pre-A123 localStorage token.
  const legacy = legacyGet();
  if (!legacy) {
    assign(null);
    return;
  }
  assign(legacy); // usable in memory even if the write below fails
  // The migration write goes through the same ordered queue as
  // setTokenAsync/clearToken, and is abandoned if either ran since hydrate
  // began, so a slow migration can never re-save a signed-out token or
  // overwrite a fresh login. Deliberately not awaited: memory is already
  // set, and the queue keeps any later clear/set behind it.
  const store = secure as SecureStore;
  void queueWrite(async () => {
    if (_epoch !== startEpoch) return;
    try {
      await withTimeout(store.set(TOKEN_KEY, legacy, false, false, KEYCHAIN_WHEN_UNLOCKED_THIS_DEVICE_ONLY), env.timeoutMs);
      if (_epoch !== startEpoch) return; // a later clear/set is queued behind us and owns the store
      const back = await withTimeout(store.get(TOKEN_KEY, false, false), env.timeoutMs);
      if (_epoch !== startEpoch) return;
      if (back === legacy) legacyRemove(); // only after a verified write
      else console.warn("[auth] token migration read-back mismatch; legacy copy kept");
    } catch (err) {
      console.warn("[auth] token migration failed; legacy copy kept", err);
    }
  });
}

// Idempotent: every caller shares one promise. Never rejects.
export function hydrateToken(): Promise<void> {
  if (!_hydrating) _hydrating = doHydrate().catch(() => {});
  return _hydrating;
}

// Resolves true once the token is durably stored (or trivially on web), false
// if the durable write failed or timed out. NEVER rejects and never blocks
// sign-in: the token is in memory before anything is awaited (A133), so a
// stuck Keychain write only costs persistence across launches, not the login.
export function setTokenAsync(token: string): Promise<boolean> {
  _epoch++;
  _memoryToken = token;
  if (!env.isNative() || pluginMissing()) {
    try { env.storage()?.setItem(TOKEN_KEY, token); } catch {}
    return Promise.resolve(true);
  }
  return queueWrite(async () => {
    try {
      await withTimeout(
        (async () => {
          const secure = await env.loadSecure();
          await secure.set(TOKEN_KEY, token, false, false, KEYCHAIN_WHEN_UNLOCKED_THIS_DEVICE_ONLY);
        })(),
        env.timeoutMs,
      );
      return true;
    } catch (err) {
      if (pluginMissing(err)) {
        try { env.storage()?.setItem(TOKEN_KEY, token); } catch {}
        return true;
      }
      console.warn("[auth] secure token write failed or timed out; token kept in memory only", err);
      return false;
    }
  });
}

export function setToken(token: string) {
  void setTokenAsync(token);
}

export function clearToken() {
  _epoch++;
  _memoryToken = null;
  legacyRemove();
  if (env.isNative() && !pluginMissing()) {
    void queueWrite(async () => {
      try {
        await withTimeout(
          (async () => {
            const secure = await env.loadSecure();
            await secure.remove(TOKEN_KEY, false);
          })(),
          env.timeoutMs,
        );
      } catch (err) {
        console.warn("[auth] secure token remove failed", err);
      }
    });
  }
}

// Test seams only (scripts/auth-token-store.test.mjs).
export function __configureTokenStoreForTests(next: Partial<TokenStoreEnv> | null) {
  env = next ? { ...defaultEnv, ...next } : defaultEnv;
  _memoryToken = null;
  _hydrating = null;
  _epoch = 0;
  _writeChain = Promise.resolve();
  _pluginWarned = false;
}
export function __tokenWritesSettled(): Promise<unknown> {
  return _writeChain;
}
