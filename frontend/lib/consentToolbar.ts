// A150: colour the native in-app browser toolbar (Android Custom Tab) to the
// app canvas so the hand-off to Finexer does not start with a bright bar in
// dark mode. The page body is Finexer's own; only the toolbar is ours.
export const CONSENT_TOOLBAR_DARK = "#0f172a";
export const CONSENT_TOOLBAR_LIGHT = "#f0f2f7";

export function consentToolbarColor(dark: boolean): string {
  return dark ? CONSENT_TOOLBAR_DARK : CONSENT_TOOLBAR_LIGHT;
}

export function isDarkPreferenceOn(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}
