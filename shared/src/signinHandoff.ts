// Renders the mobile sign-in hand-off page (G199) from the shared template
// shared/signin-handoff/template.html, the same markup the backend serves
// (backend/app/core/signin_handoff.py). Keep the copy and slot values in step
// with that Python module; scripts/check-signin-handoff.mjs guards the template.
import { SIGNIN_HANDOFF_TEMPLATE } from "./signinHandoffTemplate";

export type SigninHandoffVariant = "a" | "b" | "c";
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

export function renderSigninHandoffTemplate(template: string, slots: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    if (!(key in slots)) throw new Error(`signin handoff: missing slot ${key}`);
    return escapeHtml(slots[key]);
  });
}

export function signinHandoffHtml(
  ok: boolean,
  variant: SigninHandoffVariant,
  opts: { scheme?: SigninHandoffScheme; autoReturn?: boolean; message?: string } = {},
): string {
  const defaultMessage = ok
    ? "Taking you back to Sorted."
    : "Close this window and try again in Sorted.";
  return renderSigninHandoffTemplate(SIGNIN_HANDOFF_TEMPLATE, {
    state: ok ? "ok" : "error",
    variant,
    scheme: opts.scheme ?? "auto",
    heading: ok ? "Signed in" : "Sign-in didn’t complete",
    message: opts.message ?? defaultMessage,
    success_hint: SIGNIN_HANDOFF_SUCCESS_HINT,
    ledger_status: ok ? "Signed in" : "Not signed in",
    ok_flag: ok ? "true" : "false",
    auto_return: opts.autoReturn === false ? "false" : "true",
  });
}
