import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { App } from "@capacitor/app";
import { API_BASE, api, gatedFetch } from "./api";
import { getToken, setTokenAsync, clearToken } from "./auth";
import {
  RELAY_SEND_CODE_PATH, RELAY_VERIFY_CODE_PATH, classifyAppleRefusal, classifyVerifyStatus,
  type ClaimVerifyOutcome,
} from "./relayClaim";
import { runMobileLoginLoop, type LoginResult } from "./mobileLoginLoop";
import {
  PENDING_LOGIN_TTL_MS,
  clearPendingLogin,
  createSharedPoller,
  loadPendingLogin,
  newPendingLogin,
  savePendingLogin,
  sha256Hex,
  type PendingLogin,
  type PollReply,
} from "./pendingLogin";

export function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

// B26: Apple's guideline 3.1.1 forbids any button, external link, or copy
// pointing at a purchase mechanism other than in-app purchase, outside the
// US storefront, and this app has no in-app-purchase integration on either
// platform (Android isn't enrolled in Play's billing-choice programme
// either), so no native build can ever legally start Stripe Checkout or
// open the Stripe customer portal. Every purchase-adjacent surface
// (PlanPicker, MoreMessagesSheet, YourPlanCard, ConnectedAssistantsCard)
// gates on this single check rather than repeating isNativePlatform() and
// letting the App Store reasoning drift out of sync between call sites.
//
// Deliberately does NOT just call isNativePlatform() above: that function
// fails *open* to web (returns false, i.e. "treat as not native") on any
// detection error, which is the right failure direction for its own
// callers — biometrics, push registration and native Apple sign-in all
// want to fall back to the ordinary web flow rather than break if the
// platform check itself throws. A purchase gate needs the opposite
// failure direction. If detection is uncertain, this treats the platform
// as native and hides checkout, because the two ways this can go wrong
// are not equally bad: a false positive (detection throws on a real web
// user) costs one lost sale, a false negative (detection throws on a real
// native user and checkout shows anyway) risks an App Store rejection
// under guideline 3.1.1. The rejection is the worse outcome, so this
// fails closed even though isNativePlatform() itself deliberately doesn't.
export function canPurchaseInApp(): boolean {
  try {
    return !Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

// B26 follow-up: one sentence and one short trailing-label form for "you
// cannot buy anything from inside this app", so every purchase-adjacent
// surface reads identically instead of each inventing its own phrasing
// (PlanPicker, YourPlanCard, MoreMessagesSheet and ConnectedAssistantsCard
// previously had three different sentences for the same fact). "in this
// app" is the natural British register; "on this app" reads as American
// app-store marketing copy, which PRODUCT.md's anti-references steer away
// from. Plain factual unavailability is fine under guideline 3.1.1, which
// forbids buttons, links and calls to action, not statements of fact, so
// this says the thing plainly rather than softening it into something
// vague.
export const PURCHASE_UNAVAILABLE_SENTENCE = "Paid plans are not available in this app.";
export const PURCHASE_UNAVAILABLE_LABEL = "Not available in this app";

// B40: canPurchaseInApp() above resolves to "web" (purchasable) during
// server-side rendering — not via its own catch block (SSR never throws
// here), but because there is no Capacitor bridge in the Node build, so
// `Capacitor.isNativePlatform()` cleanly returns false there, which is
// indistinguishable, from inside that function, from a genuine web
// visitor. That has been safe in practice only because every purchase
// surface (PlanPicker, YourPlanCard, MoreMessagesSheet,
// ConnectedAssistantsCard) happens to gate its purchase UI behind an
// async fetch that has not resolved by the time React hydrates in the
// browser, so the wrong SSR value was never the one a user could act
// on — an accident of the current code, not a guarantee a future
// surface that renders synchronously would inherit.
//
// usePurchaseAvailability() is the render-safe replacement for calling
// canPurchaseInApp() directly inside a component body: it starts at
// "unknown" on both the server render and the first client render (so
// there is no hydration mismatch and no race), and only resolves to
// "web" or "native" inside an effect. Effects never run during SSR, and
// by the time this one does run, the real Capacitor bridge — injected
// synchronously by the native WebView before any app JS executes — is
// already there. Every purchase surface must treat "unknown" the same
// as "native" (hidden/disabled), never the same as "web": that is what
// makes a synchronously-rendered future surface fail closed instead of
// inheriting this bug.
//
// This is belt-and-braces alongside B31's server-side backstop
// (`_reject_native_platform` in backend/app/routers/billing.py, applied
// via `platformHeaders()` in lib/api.ts): that check runs fresh at fetch
// time, always after mount and always in response to a real user
// action, so it was never exposed to this SSR race and already refuses
// a native client's checkout call regardless of what the UI showed.
// This fix stops the UI from ever offering that call in the first
// place; B31 is what stops it if some future surface offers it anyway.
export type PurchaseAvailability = "unknown" | "web" | "native";

export function usePurchaseAvailability(): PurchaseAvailability {
  const [availability, setAvailability] = useState<PurchaseAvailability>("unknown");
  useEffect(() => {
    setAvailability(canPurchaseInApp() ? "web" : "native");
  }, []);
  return availability;
}

// Sign in with Apple is only offered on iOS native builds — there's no
// Google-style cross-platform web fallback worth building for a single-user
// app, and Apple's own guidelines are for the native ASAuthorization flow
// on iOS specifically.
export function isIOSNative(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
  } catch {
    return false;
  }
}

// This app's Capacitor appId (see capacitor-spike/capacitor.config.json) —
// on iOS native, Sign in with Apple uses ASAuthorizationAppleIDProvider
// directly, so `clientId` here just needs to match the bundle id; it plays
// no OAuth-redirect role the way a web "Services ID" flow would.
const APPLE_CLIENT_ID = "co.uk.auriqltd.sorted";

/**
 * Serialises a non-string value for a diagnostic report, mirroring
 * `safeSerialize` in `lib/capacitorPush.ts` (not exported from there, so
 * duplicated here rather than reaching into that module's internals).
 */
function safeSerialize(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Reports a native Apple sign-in failure to the backend's
 * `/push/client-diagnostic` sink, so it lands in journalctl — a release
 * TestFlight build has no Safari Web Inspector, so this is the only way
 * these failures are observable. Never logs the identity token or any
 * response body. Deliberately swallows its own errors, best-effort only.
 */
function reportAppleSignInDiagnostic(stage: string, detail: unknown): void {
  const message = typeof detail === "string" ? detail : safeSerialize(detail);
  api.reportPushDiagnostic(stage, message, "ios").catch(() => {
    /* best-effort, there is nothing more useful to do if the report itself fails */
  });
}

// Runs the native ASAuthorizationAppleIDProvider flow via the Capacitor
// plugin and returns the raw identity token (plus whatever name Apple
// handed back), or null on any failure or cancellation — the existing
// `appleSignInAuthorize` diagnostic still fires on failure, exactly as it
// did when this was inlined into `nativeAppleLogin`. Shared by both the
// sign-in flow (nativeAppleLogin) and the account-linking flow
// (linkAppleIdentity) below, since both need the same plugin call and the
// same failure reporting.
export async function nativeAppleAuthorize(): Promise<{ identityToken: string; fullName?: string } | null> {
  try {
    // Dynamic import so a web build (which never calls this function,
    // gated by isIOSNative() at the call site) doesn't need the plugin's
    // native-only code paths resolved eagerly.
    const { SignInWithApple } = await import("@capacitor-community/apple-sign-in");
    const { response } = await SignInWithApple.authorize({
      clientId: APPLE_CLIENT_ID,
      // Unused by the native iOS flow (no redirect happens), but required
      // by the plugin's TypeScript signature.
      redirectURI: `${API_BASE}/auth/apple/native`,
      scopes: "email name",
    });
    const identityToken = response.identityToken;
    if (!identityToken) return null;
    // Apple only ever sends the name on the very first authorization for
    // this app + Apple ID pair — pass along whatever we got so the backend
    // can use it, and it'll fall back to the email local-part after that.
    const fullName = [response.givenName, response.familyName].filter(Boolean).join(" ") || undefined;
    return { identityToken, fullName };
  } catch (err) {
    reportAppleSignInDiagnostic("appleSignInAuthorize", err instanceof Error ? err.message : err);
    return null;
  }
}

// G202: one live native sign-in at a time. Cancel aborts it (stops the poll
// loop, closes the sheet), drops the persisted pending login, and discards any
// token that raced in, so a cancelled attempt can never sign the user in later
// (including after a relaunch).
export type NativeLoginResult = "ok" | "invite_only" | "relay_claim" | "failed" | "timeout" | "cancelled";
// D9: the signed claim a refused Hide My Email sign-in handed back. Held in
// memory only (it is short-lived and useless without the emailed code).
let relayClaim: { claimToken: string; prompt: string; emailClaimAvailable: boolean } | null = null;
export function getRelayClaim(): { claimToken: string; prompt: string; emailClaimAvailable: boolean } | null {
  return relayClaim;
}
export function clearRelayClaim(): void {
  relayClaim = null;
}
let loginAbort: AbortController | null = null;
let applySuppressed = false;
// Set when THIS attempt stored a token, so Cancel never clears a session that
// came from anywhere else.
let attemptMintedToken = false;

function beginLogin(): AbortController {
  loginAbort?.abort();
  applySuppressed = false;
  attemptMintedToken = false;
  const ctrl = new AbortController();
  loginAbort = ctrl;
  return ctrl;
}

function endLogin(ctrl: AbortController) {
  if (loginAbort === ctrl) loginAbort = null;
}

export function cancelNativeLogin(): void {
  applySuppressed = true;
  loginAbort?.abort();
  clearPendingLogin();
  if (attemptMintedToken) {
    attemptMintedToken = false;
    clearToken();
  }
}

// D5: distinguishes an allow-list refusal (backend 403 detail
// {code: "INVITE_ONLY"}) from every other failure, same "ok" | <specific
// reason> | "failed" shape as linkAppleIdentity below, so LoginScreen can
// show the calm "Sorted is invite-only right now" screen instead of the
// generic "Sign-in failed" alert.
export async function nativeAppleLogin(): Promise<NativeLoginResult> {
  const ctrl = beginLogin();
  try {
    return await appleLoginInner(ctrl.signal);
  } finally {
    endLogin(ctrl);
  }
}

async function appleLoginInner(signal: AbortSignal): Promise<NativeLoginResult> {
  const authResult = await nativeAppleAuthorize();
  if (signal.aborted) return "cancelled";
  if (!authResult) return "failed";
  const { identityToken, fullName } = authResult;

  try {
    const res = await gatedFetch(`${API_BASE}/auth/apple/native`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identityToken, fullName }),
      signal,
    });
    if (!res.ok) {
      if (res.status === 403) {
        const body = await res.json().catch(() => null);
        const refusal = classifyAppleRefusal(res.status, body);
        if (refusal?.kind === "invite_only") return "invite_only";
        if (refusal?.kind === "relay_claim") {
          relayClaim = { claimToken: refusal.claimToken, prompt: refusal.prompt, emailClaimAvailable: refusal.emailClaimAvailable };
          return "relay_claim";
        }
      }
      reportAppleSignInDiagnostic("appleSignInExchange", `status ${res.status}`);
      return "failed";
    }
    const data = await res.json();
    if (signal.aborted) return "cancelled"; // Cancel: the token is never kept
    if (data.ok && data.session_token) {
      attemptMintedToken = true;
      await setTokenAsync(data.session_token);
      return "ok";
    }
    return "failed";
  } catch (err) {
    if (signal.aborted) return "cancelled";
    reportAppleSignInDiagnostic("appleSignInExchange", err instanceof Error ? err.message : err);
    return "failed";
  }
}

// D9 path 2, step 1: ask the backend to email a one-time code to the invited
// address. The backend answers ok whether or not the address is invited (no
// oracle), so "sent" only means the request went through.
export async function sendRelayClaimCode(email: string): Promise<"sent" | "limited" | "failed"> {
  const claim = relayClaim;
  if (!claim) return "failed";
  try {
    const res = await gatedFetch(`${API_BASE}${RELAY_SEND_CODE_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claim_token: claim.claimToken, email }),
    });
    if (res.status === 429) return "limited";
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

// D9 path 2, step 2: verify the code. On success the backend has linked the
// Apple sub to the invited identity and returns a session token, which is
// stored exactly like a normal native sign-in; the caller then establishes
// the session.
export async function verifyRelayClaimCode(email: string, code: string): Promise<ClaimVerifyOutcome> {
  const claim = relayClaim;
  if (!claim) return "failed";
  try {
    const res = await gatedFetch(`${API_BASE}${RELAY_VERIFY_CODE_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claim_token: claim.claimToken, email, code }),
    });
    const outcome = classifyVerifyStatus(res.status);
    if (outcome !== "ok") return outcome;
    const data = await res.json();
    if (data?.ok && data.session_token) {
      await setTokenAsync(data.session_token);
      relayClaim = null;
      return "ok";
    }
    return "failed";
  } catch {
    return "failed";
  }
}

// Links the signed-in user's Apple identity to their existing account
// (Phase 1 of linked identities, Settings → "Sign-in methods"). iOS native
// only — there's no web fallback for Sign in with Apple in this app (see
// isIOSNative() above). Distinguishes a 409 (that Apple ID is already
// linked to a different account) from every other failure so the Settings
// UI can show a specific message; api.linkAppleIdentity throws an Error
// whose message starts with "409" for that case (mirrors the 429 handling
// in api.sendTestPush).
export async function linkAppleIdentity(): Promise<"ok" | "conflict" | "cancelled" | "failed"> {
  if (!isIOSNative()) return "failed";

  const authResult = await nativeAppleAuthorize();
  if (!authResult) return "cancelled";

  try {
    await api.linkAppleIdentity(authResult.identityToken);
    return "ok";
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("409")) return "conflict";
    reportAppleSignInDiagnostic("appleLink", err instanceof Error ? err.message : err);
    return "failed";
  }
}

// D5: same "ok" | "invite_only" | "failed" shape as nativeAppleLogin above
// — the mobile browser flow's refusal reason travels back through
// google_mobile_callback's finish("error:invite_only") (see
// backend/app/routers/auth.py) and /auth/mobile/poll's {status: "error",
// error: "invite_only"} body.
const BROWSER_OPEN_TIMEOUT_MS = 10_000;

// A133: POST /auth/mobile/poll. The poll_secret is only ever in the JSON body.
async function postPoll(p: PendingLogin): Promise<PollReply | null> {
  // Bounded, so one stuck request can never wedge the serialised loop.
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const abortTimer = ctrl ? setTimeout(() => ctrl.abort(), 10_000) : undefined;
  try {
    const res = await gatedFetch(`${API_BASE}/auth/mobile/poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: p.state, poll_secret: p.pollSecret }),
      ...(ctrl ? { signal: ctrl.signal } : {}),
    });
    if (!res.ok) return null;
    return (await res.json()) as PollReply;
  } catch {
    return null;
  } finally {
    if (abortTimer !== undefined) clearTimeout(abortTimer);
  }
}

// One poller per process: the live login loop and a resumed one share a single
// in-flight request and a token is applied at most once per state. A133:
// setTokenAsync puts the token in memory before it awaits anything and never
// rejects or hangs (bounded write), so the server-released token cannot be
// lost to a storage failure.
const pollShared = createSharedPoller({
  post: postPoll,
  // G202: a poll that was already in flight when the user cancelled must not
  // store the token it gets back.
  applyToken: (t) => {
    if (applySuppressed) return Promise.resolve();
    attemptMintedToken = true;
    return setTokenAsync(t);
  },
});

function loopDeps(p: PendingLogin, timeoutMs?: number) {
  return {
    pollOnce: () => pollShared(p),
    closeBrowser: () => Browser.close(),
    timeoutMs,
    addListeners: (h: { onActive: () => void; onUrlOpen: (url?: string) => void; onBrowserFinished: () => void }) =>
      Promise.all([
        App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) h.onActive();
        }),
        App.addListener("appUrlOpen", ({ url }) => h.onUrlOpen(url)),
        Browser.addListener("browserFinished", () => h.onBrowserFinished()),
      ]),
  };
}

export async function nativeGoogleLogin(): Promise<NativeLoginResult> {
  const ctrl = beginLogin();
  try {
    return await googleLoginInner(ctrl.signal);
  } finally {
    endLogin(ctrl);
  }
}

async function googleLoginInner(signal: AbortSignal): Promise<NativeLoginResult> {
  // A133: state is 128 bits from the CSPRNG ("m" + 32 hex). It is NOT a
  // secret (it is in logged URLs); redemption needs the separate pollSecret,
  // whose sha256 is sent as `challenge`. The secret itself is never in a URL.
  const pending = newPendingLogin();
  const challenge = sha256Hex(pending.pollSecret);
  // Persisted BEFORE the browser opens so a WebView reload or process kill
  // while the sheet is up can still redeem the login (resumePendingLogin).
  savePendingLogin(pending);
  const url = `${API_BASE}/auth/google/mobile?state=${encodeURIComponent(pending.state)}&challenge=${challenge}`;
  // A133: Browser.open is bounded. A rejection is a failed sign-in; if it is
  // merely slow (>10s) the poll loop starts anyway rather than waiting on it.
  const opened = Browser.open({ url }).then(
    () => "opened" as const,
    () => "rejected" as const,
  );
  const openResult = await Promise.race([
    opened,
    new Promise<"slow">((r) => setTimeout(() => r("slow"), BROWSER_OPEN_TIMEOUT_MS)),
  ]);
  if (openResult === "rejected") {
    clearPendingLogin();
    return "failed";
  }
  if (signal.aborted) {
    // Cancelled while the sheet was still opening: close it, nothing to poll.
    clearPendingLogin();
    void Promise.resolve(Browser.close()).catch(() => {});
    return "cancelled";
  }
  const result: LoginResult = await runMobileLoginLoop(loopDeps(pending), signal);
  clearPendingLogin(); // success, failure, expiry and cancel all end here
  return result;
}

// A133 / A135: called once at app start (AuthProvider) when signed out. If a
// login was started and the app was reloaded or killed before the token was
// collected, redeem it now. Returns "ok" when a token was applied (the caller
// proceeds as signed in), "pending" when the login has not completed yet (a
// background loop keeps polling until the record expires, then calls
// onLateSuccess), "none" otherwise.
export async function resumePendingLogin(
  onLateSuccess?: () => void,
  // G202: called with how a background (late) resume ended, success included,
  // so the screen can stop saying "signing in" or say why it stopped.
  onLateSettled?: (result: LoginResult) => void,
): Promise<"ok" | "pending" | "none"> {
  if (!isNativePlatform()) return "none";
  const pending = loadPendingLogin();
  if (!pending) return "none";
  if (getToken()) {
    clearPendingLogin();
    return "none";
  }
  const ctrl = beginLogin();
  const first = await pollShared(pending);
  if (ctrl.signal.aborted) return "none"; // cancelled during the first poll
  if (first === "ok") {
    endLogin(ctrl);
    clearPendingLogin();
    return "ok";
  }
  if (first === "invite_only" || first === "err") {
    endLogin(ctrl);
    clearPendingLogin();
    return "none";
  }
  const remaining = Math.max(1000, PENDING_LOGIN_TTL_MS - (Date.now() - pending.startedAt));
  void runMobileLoginLoop(loopDeps(pending, remaining), ctrl.signal).then((r) => {
    endLogin(ctrl);
    // Only clear our own record: a newer login may have replaced it.
    if (loadPendingLogin()?.state === pending.state) clearPendingLogin();
    if (r === "ok") onLateSuccess?.();
    onLateSettled?.(r);
  });
  return "pending";
}
