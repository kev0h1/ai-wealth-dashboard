import { ICON_CATALOG } from "./icons";

export type PreviewCategory = { name: string; kind: string; iconKey: string; source: "auto" | "user" };
const KEY = "sorted.g450.category-icons.preview.v1";
const KINDS = ["discretionary", "commitment", "movement", "excluded"];

export const STARTING_CATEGORIES: PreviewCategory[] = [
  { name: "Golf", kind: "discretionary", iconKey: "golf", source: "auto" },
  { name: "Padel", kind: "discretionary", iconKey: "racquet", source: "user" },
  { name: "Energy", kind: "commitment", iconKey: "lightning", source: "auto" },
  { name: "Mobile", kind: "commitment", iconKey: "device-mobile", source: "auto" },
  { name: "Business", kind: "discretionary", iconKey: "briefcase", source: "auto" },
];

const storageKey = (namespace: string) => KEY + (namespace ? `.${namespace}` : "");

export function readPreviewCategories(seed = STARTING_CATEGORIES, namespace = ""): PreviewCategory[] {
  if (typeof window === "undefined") return seed;
  const raw = window.localStorage.getItem(storageKey(namespace));
  if (raw === null) return seed;
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length > 200) throw new Error("Invalid fictional category list");
  const names = new Set<string>();
  return parsed.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new Error("Invalid fictional category");
    const row = item as Partial<PreviewCategory>;
    if (typeof row.name !== "string" || !row.name.trim() || row.name.length > 40 || !KINDS.includes(row.kind ?? "") || !ICON_CATALOG.some(icon => icon.key === row.iconKey) || (row.source !== "auto" && row.source !== "user")) throw new Error("Invalid fictional category");
    const normalised = row.name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB");
    if (names.has(normalised)) throw new Error("Duplicate fictional category");
    names.add(normalised);
    return { name: row.name, kind: row.kind!, iconKey: row.iconKey!, source: row.source };
  });
}

export function writePreviewCategories(categories: PreviewCategory[], namespace = "") {
  if (typeof window !== "undefined") window.localStorage.setItem(storageKey(namespace), JSON.stringify(categories));
}

export function resetPreviewCategories(namespace = ""): void {
  if (typeof window !== "undefined") window.localStorage.removeItem(storageKey(namespace));
}
