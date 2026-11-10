import { createElement, forwardRef } from "react";
import type { LucideIcon, LucideProps } from "lucide-react";
import manifest from "../../shared/category-icons.json" with { type: "json" };
import { ICON_GEOMETRY } from "./category-icons/iconGeometry";

export type CategoryIconKey = keyof typeof ICON_GEOMETRY;
export const ICON_CATALOG = manifest.icons;
export const CATEGORY_ICONS: Record<string, string> = manifest.categories;
export const RELATED_ICON_KEYS: Record<string, readonly string[]> = manifest.related;

const iconKeys = new Set<string>(manifest.icons.map(icon => icon.key));
const normalisedCategories = new Map(Object.entries(CATEGORY_ICONS).map(([name, key]) => [normaliseName(name), key]));
const keywords = manifest.keywords.map(({ pattern, key, kind }) => ({ pattern: new RegExp(pattern, "i"), key, kind }));

function normaliseName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB");
}

/** Resolves an old device-local Lucide key to its durable Phosphor key. */
export function normaliseIconKey(key?: string | null): string | null {
  if (!key || typeof key !== "string") return null;
  return iconKeys.has(key) ? key : Object.hasOwn(manifest.legacyKeys, key) ? manifest.legacyKeys[key as keyof typeof manifest.legacyKeys] : null;
}

export function getIconLabel(key?: string | null): string {
  const normalised = normaliseIconKey(key);
  return manifest.icons.find(icon => icon.key === normalised)?.label ?? "Tag";
}

/** Deterministic local first pass. Rendering never fetches an icon. */
export function suggestIcon(name: string, kind?: string): string {
  const source = (name ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  for (const rule of keywords) if ((!rule.kind || rule.kind === kind) && rule.pattern.test(source)) return rule.key;
  return kind === "income" ? "money" : manifest.fallback;
}

function makeIcon(key: CategoryIconKey): LucideIcon {
  const CategoryIcon = forwardRef<SVGSVGElement, LucideProps>(function CategoryIcon({ size = 24, color, className, style, ...props }, ref) {
    // Original regular Phosphor vectors are filled contours. Existing callers
    // can pass Lucide stroke controls without visually changing that geometry.
    const svgProps = { ...props };
    delete svgProps.strokeWidth;
    delete svgProps.absoluteStrokeWidth;
    const paths: readonly { d: string; opacity?: number }[] = ICON_GEOMETRY[key];
    return createElement("svg", { ...svgProps, ref, width: size, height: size, viewBox: "0 0 256 256", fill: "currentColor", "aria-hidden": svgProps["aria-label"] ? undefined : true, focusable: false, className, style: { color, ...style }, "data-phosphor-icon": key, "data-phosphor-weight": "regular" },
      paths.map((path, index) => createElement("path", { key: index, d: path.d, opacity: path.opacity })),
    );
  });
  CategoryIcon.displayName = `CategoryIcon(${key})`;
  return CategoryIcon;
}

export const ICON_LIBRARY: Record<string, LucideIcon> = Object.fromEntries(
  manifest.icons.map(icon => [icon.key, makeIcon(icon.key as CategoryIconKey)]),
);

const fallbackIcon = ICON_LIBRARY[manifest.fallback];

/** One canonical resolution path for every category surface. */
export function getCategoryIcon(category?: string, overrides?: Record<string, string>): LucideIcon {
  if (!category) return fallbackIcon;
  const directOverride = overrides?.[category];
  const folded = normaliseName(category);
  const matchingOverride = directOverride ?? Object.entries(overrides ?? {}).find(([name]) => normaliseName(name) === folded)?.[1];
  const key = normaliseIconKey(matchingOverride) ?? normalisedCategories.get(folded) ?? suggestIcon(category);
  return ICON_LIBRARY[key] ?? fallbackIcon;
}
