import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { api } from "../lib/api.ts";
import { onEndpointsInvalidated } from "../lib/endpointCache.ts";
import { insightCategoryIcon } from "../lib/insightIcons.ts";
import { CATEGORY_ICONS, getCategoryIcon, ICON_CATALOG, ICON_LIBRARY, normaliseIconKey, suggestIcon } from "../lib/categoryIcons.ts";

const backend = readFileSync(new URL("../../backend/app/services/categories.py", import.meta.url), "utf8");
const table = backend.split("BUILTIN_CATEGORY_KINDS: dict[str, str] = {", 2)[1]?.split("\n}", 1)[0];
assert(table, "The authoritative builtin taxonomy must be readable");
const builtins = [...table.matchAll(/^\s*"([^"]+)":/gm)].map(match => match[1]);
assert(builtins.length >= 22);
for (const name of builtins) {
  assert(Object.hasOwn(CATEGORY_ICONS, name), `Missing explicit mapping for ${name}`);
  assert.equal(getCategoryIcon(name), ICON_LIBRARY[CATEGORY_ICONS[name]]);
}

const keys = new Set(ICON_CATALOG.map(icon => icon.key));
assert.equal(keys.size, ICON_CATALOG.length, "Catalogue keys must be unique");
for (const key of keys) {
  const markup = renderToStaticMarkup(createElement(ICON_LIBRARY[key], { size: 16, strokeWidth: 8, absoluteStrokeWidth: true, style: { color: "#34d399" } }));
  assert(markup.includes(`data-phosphor-icon="${key}"`));
  assert(markup.includes('data-phosphor-weight="regular"'));
  assert(markup.includes('viewBox="0 0 256 256"'));
  assert(markup.includes('width="16"') && markup.includes('height="16"'));
  assert(!markup.includes("stroke-width"), "Lucide stroke controls must not alter regular Phosphor geometry");
}

assert.equal(normaliseIconKey("ShoppingCart"), "shopping-cart");
assert.equal(normaliseIconKey("toString"), null);
assert.equal(normaliseIconKey("__proto__"), null);
assert.equal(getCategoryIcon("  iNvestment  "), ICON_LIBRARY["trend-up"]);
assert.equal(getCategoryIcon("Golf", { Golf: "racquet" }), ICON_LIBRARY.racquet);
assert.equal(getCategoryIcon("golf", { Golf: "Dumbbell" }), ICON_LIBRARY.barbell);
assert.equal(getCategoryIcon("Zorbital", { Zorbital: "not-bundled" }), ICON_LIBRARY.tag);
assert.equal(suggestIcon("Golf"), "golf");
assert.equal(suggestIcon("Padel"), "racquet");
assert.equal(suggestIcon("Café"), "coffee");
assert.equal(suggestIcon("Holiday fund", "movement"), "piggy-bank");
assert.equal(suggestIcon("Zorbital"), "tag");
assert.equal(insightCategoryIcon("constructor"), ICON_LIBRARY.tag);
assert.equal(insightCategoryIcon("__proto__"), ICON_LIBRARY.tag);
assert.equal(insightCategoryIcon("energy", { Energy: "racquet" }), ICON_LIBRARY.racquet);

const requests = [];
// Two fresh module lifetimes model a page reload with retained browser history.
const previousPage = await import("../lib/sheetHistoryId.ts?previous-page");
const reloadedPage = await import("../lib/sheetHistoryId.ts?reloaded-page");
const staleHistoryId = previousPage.createSheetHistoryId();
assert.notEqual(reloadedPage.createSheetHistoryId(), staleHistoryId, "Reloaded sheets must not match stale history entries");
assert.notEqual(previousPage.createSheetHistoryId(), staleHistoryId, "Nested sheets need distinct IDs within one page");
const originalFetch = globalThis.fetch;
let financialInvalidations = 0;
onEndpointsInvalidated(() => { financialInvalidations += 1; });
globalThis.fetch = async (url, options) => {
  requests.push({ url: String(url), method: options.method, body: JSON.parse(options.body) });
  return new Response(JSON.stringify({ builtin: [], custom: ["Golf"], all: ["Golf"], kinds: { Golf: "discretionary" }, icons: { Golf: "golf" }, icon_sources: { Golf: "auto" } }), { status: 200, headers: { "Content-Type": "application/json" } });
};
try {
  await api.addCategory("Golf", "discretionary", "racquet");
  assert(financialInvalidations > 0, "Category creation must still refresh financial data");
  const invalidationsAfterCreate = financialInvalidations;
  await api.saveCategoryIcon("Golf", "soccer-ball");
  await api.saveCategoryIcon("Golf", null);
  assert.equal(financialInvalidations, invalidationsAfterCreate, "Icon-only saves must preserve financial endpoint caches");
  assert.deepEqual(requests[0].body, { name: "Golf", kind: "discretionary", icon_key: "racquet" });
  assert.deepEqual(requests[1].body, { name: "Golf", icon_key: "soccer-ball" });
  assert.deepEqual(requests[2].body, { name: "Golf", icon_key: null });
  assert.equal(requests[1].method, "PATCH");
  assert(requests[1].url.endsWith("/categories/icon"));
} finally { globalThis.fetch = originalFetch; }
console.log(`G450: ${builtins.length} builtins, ${keys.size} regular vectors, canonical/legacy/saved resolution and explicit category icon writes passed`);
