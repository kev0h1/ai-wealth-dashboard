// Renders the mobile sign-in hand-off page (G199) from the shared template
// shared/signin-handoff/template.html, the same markup the backend serves
// (backend/app/core/signin_handoff.py). Keep the copy and slot values in step
// with that Python module; scripts/check-signin-handoff.mjs guards the template.
import { SIGNIN_HANDOFF_TEMPLATE } from "./signinHandoffTemplate";

export type SigninHandoffScheme = "auto" | "light" | "dark";

export const SIGNIN_HANDOFF_SUCCESS_HINT =
  "Signed in. You can close this window and return to Sorted.";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

const DEEP_LINK_SCHEME = "wealthdash";

function rawJsonSlot(name: string, value: string): string {
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    throw new Error(`signin handoff: slot ${name} is not valid JSON`);
  }
  if (typeof decoded !== "string" || !decoded.startsWith(`${DEEP_LINK_SCHEME}://`)) {
    throw new Error(`signin handoff: slot ${name} must be a JSON string starting with ${DEEP_LINK_SCHEME}://`);
  }
  return value.replace(/<\//g, "<\\/");
}

/** Slots ending in _json are pre-serialised JSON string literals inserted
 * unescaped (they sit inside the hashed <script>); everything else is HTML-escaped. */
export function renderSigninHandoffTemplate(template: string, slots: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    if (!(key in slots)) throw new Error(`signin handoff: missing slot ${key}`);
    return key.endsWith("_json") ? rawJsonSlot(key, slots[key]) : escapeHtml(slots[key]);
  });
}

export function signinHandoffHtml(
  ok: boolean,
  opts: { scheme?: SigninHandoffScheme; autoReturn?: boolean; message?: string } = {},
): string {
  const defaultMessage = ok
    ? "Taking you back to Sorted."
    : "Close this window and try again in Sorted.";
  return renderSigninHandoffTemplate(SIGNIN_HANDOFF_TEMPLATE, {
    title: "Sorted | Sign-in",
    return_url_json: JSON.stringify(`${DEEP_LINK_SCHEME}://auth-done`),
    state: ok ? "ok" : "error",
    scheme: opts.scheme ?? "auto",
    heading: ok ? "Signed in" : "Sign-in didn’t complete",
    message: opts.message ?? defaultMessage,
    success_hint: SIGNIN_HANDOFF_SUCCESS_HINT,
    ok_flag: ok ? "true" : "false",
    auto_return: opts.autoReturn === false ? "false" : "true",
  });
}

export const BANK_HANDOFF_SUCCESS_HINT =
  "Bank connected. You can close this window and return to Sorted.";

export function bankReturnUrl(provider: string, connectionId: string, status: "ok" | "error" = "ok"): string {
  const q = new URLSearchParams({ provider, connection: connectionId, status });
  return `${DEEP_LINK_SCHEME}://auth-complete?${q.toString()}`;
}

export function bankHandoffHtml(
  ok: boolean,
  opts: {
    provider: string;
    connectionId: string;
    scheme?: SigninHandoffScheme;
    autoReturn?: boolean;
    message?: string;
  },
): string {
  const defaultMessage = ok
    ? "Taking you back to Sorted. Your transactions are on their way."
    : "No accounts were linked. Close this window and try again in Sorted.";
  return renderSigninHandoffTemplate(SIGNIN_HANDOFF_TEMPLATE, {
    title: "Sorted | Bank connection",
    return_url_json: JSON.stringify(bankReturnUrl(opts.provider, opts.connectionId, ok ? "ok" : "error")),
    state: ok ? "ok" : "error",
    scheme: opts.scheme ?? "auto",
    heading: ok ? "Bank connected" : "Connection didn’t complete",
    message: opts.message ?? defaultMessage,
    success_hint: BANK_HANDOFF_SUCCESS_HINT,
    ok_flag: ok ? "true" : "false",
    auto_return: opts.autoReturn === false ? "false" : "true",
  });
}
