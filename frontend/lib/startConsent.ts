// A191: the one place a bank consent is launched. BankPickerSheet (new connect)
// and the Home and Accounts reconnect handlers all call startConsent, so a
// reconnect gets the same A108 in-app browser hand-off as a fresh connect.
// Before this, the reconnect handlers sent no `native` flag and navigated the
// WebView straight to the consent, so an app-to-app bank (Chase UK) could never
// complete. The return is handled app-wide by components/DeepLinkHandler.tsx
// (wd:deeplink -> lib/bankConnectReturn.ts), so a surface that does not mount
// the picker still gets the A108 return page's deep link handled.
import { launchMode, buildLinkQuery, type LaunchMode } from "@/lib/bankConsentLaunch";
import { consentToolbarColor, isDarkPreferenceOn } from "@/lib/consentToolbar";
import { markPendingConsent } from "@/lib/pendingConsent";

export interface ConsentDeps {
  isNative(): boolean;
  rnBridge(): { postMessage(s: string): void } | null;
  /** The provider's link call; `native` is sent only for the in-app browser flow. */
  link(legacy: boolean, providerId: string | undefined, native: boolean): Promise<{ auth_url: string; connection_id?: string }>;
  /** A193: remember the consent just created so a relaunch can ask the server how it ended. */
  rememberPending?(connectionId: string | undefined, providerId: string | undefined): void;
  openBrowser(url: string, toolbarColor: string): Promise<void>;
  navigate(url: string): void;
  toolbarColor(): string;
}

export interface StartConsentOptions {
  providerId?: string;
  /** The UAT-only legacy provider; always false in a production build. */
  legacy?: boolean;
  /** Called after the link is created and before the hand-off starts. */
  beforeLaunch?: () => void;
  /** Called for the web and RN modes just before leaving; the in-app browser flow
   *  reports its return through the deep link instead. */
  onConnecting?: () => void;
  /** RN mode only: called after the external browser was requested. */
  onHandedOff?: () => void;
}

export type StartConsentResult =
  | { ok: true; mode: LaunchMode }
  /** busy: another start is already in flight (a double tap); the caller does nothing. */
  | { ok: false; message: string; rejected: boolean; busy?: boolean };

const GENERIC_FAILURE = "Failed to connect. Please try again.";

function isApiError(err: unknown): err is { status: number; detail: unknown; message: string } {
  return !!err && typeof err === "object" && (err as { name?: string }).name === "ApiError"
    && typeof (err as { status?: unknown }).status === "number";
}

/** A178: the server sends plain copy for a link it could not start (502), a bank
 *  Finexer rejected outright (422) or a plan limit (402). Anything else is generic. */
export function consentErrorMessage(err: unknown): { message: string; rejected: boolean } {
  const rejected = isApiError(err) && err.status === 422
    && (err.detail as { code?: string } | null)?.code === "BANK_PROVIDER_REJECTED";
  const message = isApiError(err) && (err.status === 402 || err.status === 422 || err.status === 502)
    ? err.message
    : GENERIC_FAILURE;
  return { message, rejected };
}

/** The real wiring. api and nativeAuth load lazily so runConsent stays testable in plain Node. */
async function appDeps(): Promise<ConsentDeps> {
  const [{ api }, { isNativePlatform }] = await Promise.all([import("@/lib/api"), import("@/lib/nativeAuth")]);
  return {
    isNative: () => isNativePlatform(),
    rnBridge: () => (window as unknown as { ReactNativeWebView?: { postMessage(s: string): void } }).ReactNativeWebView ?? null,
    link: (legacy, providerId, native) => legacy
      ? api.legacyBankConnectLink(providerId, native)
      : api.finexerConnectLink(providerId, native),
    openBrowser: async (url, toolbarColor) => {
      // A139: destructure and call inline, never return the plugin proxy.
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url, toolbarColor });
    },
    // The marker is only needed where the OS can kill the app at the bank (in-app browser).
    rememberPending: (id, providerId) => markPendingConsent(window.localStorage, id, providerId),
    navigate: (url) => { window.location.href = url; },
    toolbarColor: () => consentToolbarColor(isDarkPreferenceOn()),
  };
}

// A193: one consent start at a time. A double tap, or a resume handler that
// re-runs a start, must not create two consents: only the last bank URL stays
// valid, and a bank rejects the earlier one as "invalid request".
let startInFlight = false;
export function consentStartInFlight(): boolean {
  return startInFlight;
}

export async function startConsent(
  opts: StartConsentOptions,
  loadDeps: () => Promise<ConsentDeps> = appDeps,
): Promise<StartConsentResult> {
  if (startInFlight) return { ok: false, message: "", rejected: false, busy: true };
  startInFlight = true;
  try {
    return await startConsentOnce(opts, loadDeps);
  } finally {
    startInFlight = false;
  }
}

async function startConsentOnce(
  opts: StartConsentOptions,
  loadDeps: () => Promise<ConsentDeps>,
): Promise<StartConsentResult> {
  let deps: ConsentDeps;
  try {
    deps = await loadDeps();
  } catch (err) {
    // A failed dynamic import resolves to the generic error, never a rejection,
    // so callers (the picker) still clear their connecting state.
    const { message, rejected } = consentErrorMessage(err);
    return { ok: false, message, rejected };
  }
  return runConsent(opts, deps);
}

/** The launch logic with injected dependencies (tested directly). */
export async function runConsent(
  opts: StartConsentOptions,
  deps: ConsentDeps,
): Promise<StartConsentResult> {
  const rn = deps.rnBridge();
  const mode = launchMode(deps.isNative(), !!rn);
  const { native } = buildLinkQuery(mode === "browser");
  try {
    // Every call asks the server for a NEW consent; the URL is used once, here,
    // and never stored or reopened by the client.
    const { auth_url, connection_id } = await deps.link(!!opts.legacy, opts.providerId, native);
    opts.beforeLaunch?.();
    if (mode === "browser") {
      deps.rememberPending?.(connection_id, opts.providerId);
      // A108: the in-app browser, not full Chrome and not the WebView. The
      // caller stays alive; the hand-off page returns by deep link.
      await deps.openBrowser(auth_url, deps.toolbarColor());
    } else if (mode === "rn") {
      // React Native WebView: external browser so bank apps (e.g. Starling) work.
      opts.onConnecting?.();
      rn!.postMessage(JSON.stringify({ type: "open_external", url: auth_url }));
      opts.onHandedOff?.();
    } else {
      opts.onConnecting?.();
      deps.navigate(auth_url);
    }
    return { ok: true, mode };
  } catch (err) {
    const { message, rejected } = consentErrorMessage(err);
    return { ok: false, message, rejected };
  }
}
