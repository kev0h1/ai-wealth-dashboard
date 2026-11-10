// Per-category icon overrides, persisted the same way as colourStore
// (device-local; the defaults in categoryIcons.ts cover the common case).

const KEY = "cat_icons";

export function loadIcons(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === "string"));
  } catch {
    return {};
  }
}

export function persistIcon(cat: string, icon: string): void {
  if (typeof window === "undefined") return;
  try {
    const overrides = loadIcons();
    overrides[cat] = icon;
    localStorage.setItem(KEY, JSON.stringify(overrides));
  } catch {}
}

export function clearIcon(cat: string): void {
  if (typeof window === "undefined") return;
  try {
    const overrides = loadIcons();
    delete overrides[cat];
    localStorage.setItem(KEY, JSON.stringify(overrides));
  } catch {}
}
