// G272: approved C is the production default, not a preview-only graphic.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// CSS class identities and the portal shell do not affect this content test.
// Browser verification covers the real CSS and SheetFrame independently.
const stub = new URL("./_sheetframe-stub.mjs", import.meta.url).href;
register("data:text/javascript," + encodeURIComponent(`
  export async function resolve(s, c, next) {
    if (/(^|\\/)components\\/SheetFrame$/.test(s)) return {url: ${JSON.stringify(stub)}, shortCircuit: true};
    return next(s, c);
  }
  export async function load(url, c, next) {
    if (url.endsWith('/InvestmentFlow.module.css')) return {format: 'module', source: 'export default new Proxy({}, {get: (_, key) => key});', shortCircuit: true};
    return next(url, c);
  }
`));

const { default: InvestmentFlow } = await import("../components/InvestmentFlow.tsx");
const { default: InvestmentUpload } = await import("../components/InvestmentUpload.tsx");
const { STATEMENT_FLOW_STEPS, STATEMENT_PRIVACY_LINE, STAY_CURRENT_COPY } = await import("../lib/investmentFlow.ts");
const plain = html => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const html = renderToStaticMarkup(createElement(InvestmentFlow));
const text = plain(html);
assert.match(html, /<section[^>]+aria-label="How statement imports work"/);
assert.match(text, /From a PDF to your portfolio/);
assert.match(html, /<div class="bridge" aria-hidden="true">/, "decorative graphic does not repeat the explanation");
assert.match(html, /<p class="example">Illustrative example: 12 units \+ 2 bought = 14 units\.<\/p>/, "complete accessible calculation outside the hidden illustration");
assert.match(html, /<ol class="steps" role="list">/, "list semantics survive list-style:none on Safari");
assert.equal((html.match(/<li>/g) ?? []).length, 3);
for (const step of STATEMENT_FLOW_STEPS) {
  assert.ok(text.includes(step.label));
  assert.ok(text.includes(step.line));
}
assert.ok(text.includes(STATEMENT_PRIVACY_LINE), "same privacy truth as the design");
assert.ok(text.includes(STAY_CURRENT_COPY), "same statement replacement rules as the account card");
const statementSummary = html.match(/<details class="details">(<summary\b[^>]*>[\s\S]*?<\/summary>)/)?.[1];
assert.ok(statementSummary, "statement replacement rules remain in a native disclosure");
assert.equal(plain(statementSummary).trim(), "When you add a new statement", "the disclosure wording is unchanged");
assert.match(statementSummary, /class="[^"]*\bdisclosure-summary\b/, "the shared summary owns marker suppression");
assert.equal((statementSummary.match(/lucide-chevron-down/g) ?? []).length, 1, "exactly one shared disclosure icon");
assert.match(text, /Add contract notes when you trade\. Prices may be delayed\./);
assert.doesNotMatch(text, /\u2014/);

const noop = () => {};
const upload = renderToStaticMarkup(createElement(InvestmentUpload, { onSuccess: noop, onClose: noop }));
assert.equal((upload.match(/From a PDF to your portfolio/g) ?? []).length, 1, "real upload renders C once without any explainer prop");
assert.ok(upload.indexOf("Statement file") < upload.indexOf("From a PDF to your portfolio"), "graphic sits below the file picker");
assert.match(upload, /Import Statement/);
assert.match(upload, /disabled=""/, "empty file picker cannot submit");
const source = readFileSync(new URL("../components/InvestmentUpload.tsx", import.meta.url), "utf8");
assert.match(source, /uploadStatement = api\.uploadInvestmentStatement/, "production still uses its real uploader");
assert.doesNotMatch(source, /app\/design/);
const css = readFileSync(new URL("../components/InvestmentFlow.module.css", import.meta.url), "utf8");
assert.match(css, /:global\(\.dark\)/);
assert.match(css, /@media \(max-width: 360px\)/);
assert.match(css, /summary:focus-visible/);
assert.doesNotMatch(css, /gradient|animation:/, "no animation or Penny gradient added");
console.log("g272-investment-flow OK: approved C, default upload, shared copy, accessible example and list.");
