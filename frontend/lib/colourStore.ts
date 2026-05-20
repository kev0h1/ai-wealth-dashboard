import { CATEGORY_COLOURS } from "./categories";

const KEY = "cat_colours";

export function loadColours(): Record<string, string> {
  if (typeof window === "undefined") return { ...CATEGORY_COLOURS };
  try {
    const raw = localStorage.getItem(KEY);
    const overrides: Record<string, string> = raw ? JSON.parse(raw) : {};
    return { ...CATEGORY_COLOURS, ...overrides };
  } catch {
    return { ...CATEGORY_COLOURS };
  }
}

export function persistColour(cat: string, hex: string): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(KEY);
    const overrides: Record<string, string> = raw ? JSON.parse(raw) : {};
    overrides[cat] = hex;
    localStorage.setItem(KEY, JSON.stringify(overrides));
  } catch {}
}

export function clearColour(cat: string): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(KEY);
    const overrides: Record<string, string> = raw ? JSON.parse(raw) : {};
    delete overrides[cat];
    localStorage.setItem(KEY, JSON.stringify(overrides));
  } catch {}
}

export function isCustomColour(cat: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(KEY);
    const overrides: Record<string, string> = raw ? JSON.parse(raw) : {};
    return cat in overrides;
  } catch {
    return false;
  }
}
