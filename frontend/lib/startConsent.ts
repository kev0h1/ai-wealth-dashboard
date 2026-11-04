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

export interface ConsentDeps {
  isNative(): boolean;
  rnBridge(): { postMessage(s: string): void } | null;
  /** The provider's link call; `native` is sent only for the in-app browser flow. */
  link(legacy: boolean, providerId: string | undefined, native: boolean): Promise<{ auth_url: string }>;
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
  | { ok: false; message: string; rejected: boolean };

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
    navigate: (url) => { window.location.href = url; },
    toolbarColor: () => consentToolbarColor(isDarkPreferenceOn()),
  };
}

export async function startConsent(opts: StartConsentOptions): Promise<StartConsentResult> {
  return runConsent(opts, await appDeps());
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
    const { auth_url } = await deps.link(!!opts.legacy, opts.providerId, native);
    opts.beforeLaunch?.();
    if (mode === "browser") {
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
