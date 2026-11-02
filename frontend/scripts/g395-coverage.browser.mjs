// Manual G395 browser evidence. This uses the actual BankConnectionFlow and
// sheet stack, with only its API asset boundary replaced by fixture data.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { openBrowser } from "./_plan-browser.mjs";

const out = await mkdtemp(path.join(tmpdir(), "g395-coverage-"));
const evidence = path.resolve("../.impeccable/review/g395-foldin");
await mkdir(evidence, { recursive: true });

const entry = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import BankConnectionFlow from "./components/bank-connect/BankConnectionFlow";

const banks = [
  { id: "monzo", name: "Monzo", logo: "/banks/monzo.png", health_status: "degraded", supported_kinds: ["current"], coverage_captured_on: "2026-11-02" },
  { id: "amex", name: "American Express", logo: "/banks/amex.png", health_status: "operational", supported_kinds: ["card"], coverage_captured_on: "2026-11-02" },
  { id: "barclays_personal", name: "Barclays", logo: "/banks/barclays.png", health_status: "operational", supported_kinds: ["current", "savings", "card"], coverage_captured_on: "2026-11-02" },
  { id: "unknown", name: "Unknown Bank", logo: "", health_status: "operational", supported_kinds: [], coverage_captured_on: null },
];
function Harness({ state = "ready" }) {
  const [connecting, setConnecting] = useState(null);
  const loading = state === "loading";
  const loadError = state === "error" ? "Fixture bank list failed." : null;
  return <main data-ready className="min-h-dvh bg-[#f0f2f7] text-slate-900 dark:bg-[#0f172a] dark:text-slate-100">
    <BankConnectionFlow banks={banks} loading={loading} loadError={loadError} connectionError={null} connecting={connecting}
      onRetry={() => { window.retryCalls = (window.retryCalls || 0) + 1; }}
      onConnect={(bank) => { window.connectCalls = (window.connectCalls || 0) + 1; window.connectedBank = bank.id; setConnecting(bank.id); }}
      onClose={() => { window.closed = (window.closed || 0) + 1; }} />
  </main>;
}
const root = createRoot(document.getElementById("root"));
window.render = (state = "ready") => { window.connectCalls = 0; window.connectedBank = null; window.retryCalls = 0; window.closed = 0; root.render(<Harness key={state + ++window.renderCount} state={state} />); };
window.renderCount = 0;
window.render(new URLSearchParams(location.search).get("state") || "ready");
`;

const mocks = {
  "@/lib/api": `export const resolveApiAsset = value => value;`,
};
await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: "tsx" }, bundle: true,
  outfile: path.join(out, "bundle.js"), jsx: "automatic", define: { "process.env": "{}" },
  plugins: [{ name: "fixture-boundaries", setup(building) {
    building.onResolve({ filter: /^@\/lib\/api$/ }, args => ({ path: args.path, namespace: "fixture" }));
    building.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: mocks[args.path], loader: "tsx", resolveDir: process.cwd() }));
  } }],
});
const css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"), { from: path.resolve("app/globals.css") })).css;
await writeFile(path.join(out, "styles.css"), css);
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><style>@font-face{font-family:Figtree;src:url(/fonts/Figtree.ttf)}@font-face{font-family:JetBrains;src:url(/fonts/JetBrainsMono.ttf)}:root{--font-figtree:Figtree;--font-jbmono:JetBrains}body{margin:0;background:#f0f2f7}.dark body{background:#0f172a}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`;
const server = createServer(async (request, response) => {
  const url = request.url ?? "/";
  try {
    if (url === "/bundle.js" || url === "/styles.css") {
      response.setHeader("Content-Type", url.endsWith(".css") ? "text/css; charset=utf-8" : "application/javascript; charset=utf-8");
      return response.end(await readFile(path.join(out, url.slice(1))));
    }
    if (url.startsWith("/fonts/")) {
      response.setHeader("Content-Type", "font/ttf");
      return response.end(await readFile(path.join(process.cwd(), "public/design-media/c22/crafted/fonts", path.basename(url))));
    }
    if (url.startsWith("/banks/")) {
      response.setHeader("Content-Type", url.endsWith(".svg") ? "image/svg+xml" : "image/png");
      return response.end(await readFile(path.join(process.cwd(), "public", url)));
    }
    if (url !== "/" && !url.startsWith("/?")) { response.statusCode = 404; return response.end("missing"); }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(html);
  } catch { response.statusCode = 404; response.end("missing"); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await openBrowser({ origin: `http://127.0.0.1:${server.address().port}`, output: evidence });
const choose = id => `document.querySelector('[data-flow-focus="bank-${id}"]')`;
const render = async state => {
  const theme = await browser.evaluate("document.documentElement.className");
  await browser.navigate("/?state=" + state, "document.querySelector('[data-sheet-frame]')");
  await browser.evaluate(`document.documentElement.className = ${JSON.stringify(theme)}`);
  await browser.settle();
};

try {
  await browser.viewport(390, 844);
  await browser.navigate("/", "document.querySelector('[data-sheet-frame]')");
  assert.equal(await browser.evaluate("document.fonts.check('14px Figtree')"), true, "local Figtree loaded");

  for (const theme of ["light", "dark"]) {
    for (const width of [320, 390, 1280]) {
      await browser.viewport(width, 844);
      await browser.evaluate(`document.documentElement.className = ${JSON.stringify(theme === "dark" ? "dark" : "")}`);
      await render("ready");
      assert.equal(await browser.evaluate("document.documentElement.scrollWidth > innerWidth"), false, `${theme}/${width}: no horizontal overflow`);
      assert.equal(await browser.evaluate("document.body.textContent.includes('Current accounts only') && document.body.textContent.includes('Credit cards only')"), true, `${theme}/${width}: partial Monzo and Amex coverage are factual`);
      const controls = await browser.evaluate("[...document.querySelectorAll('[data-sheet-frame] button')].filter(button => button.getClientRects().length).map(button => ({ label: button.getAttribute('aria-label') || button.textContent.trim(), height: button.getBoundingClientRect().height }))");
      controls.forEach(control => assert.ok(control.height >= 44, `${theme}/${width}: ${control.label} is a 44px target`));
    }
  }

  await browser.viewport(390, 844);
  for (const theme of ["light", "dark"]) {
    await browser.evaluate(`document.documentElement.className = ${JSON.stringify(theme === "dark" ? "dark" : "")}`);
    await render("ready");
    await browser.activate(choose("monzo"));
    await browser.waitFor("document.body.textContent.includes('Review your connection') && document.body.textContent.includes('Monzo is having problems right now')");
    assert.equal(await browser.evaluate("document.body.textContent.includes('Current accounts only')"), true, "partial coverage reaches review");
    assert.equal(await browser.evaluate("document.body.textContent.includes('Finexer listing captured 2 Nov 2026. Coverage is not a guarantee.')"), true, "review source is dated from API fixture");
    await browser.shot(`review-health-${theme}-390`, { full: true });
  }

  await browser.viewport(320, 844);
  await browser.evaluate("document.documentElement.className = ''");
  await render("ready");
  await browser.activate(choose("unknown"));
  await browser.waitFor("document.body.textContent.includes('Coverage unavailable for this bank')");
  assert.equal(await browser.evaluate("document.body.textContent.includes('We cannot show the data available for this bank yet.')"), true, "unknown stays unavailable in review");
  await browser.shot("review-unknown-320", { full: true });

  await render("ready");
  await browser.type("document.querySelector('input[name=bank-search]')", "monzo");
  await browser.waitFor("document.querySelectorAll('[data-flow-focus]').length === 1");
  await browser.activate("document.querySelector('[aria-label=\"Clear search\"]')");
  assert.equal(await browser.evaluate("document.activeElement?.getAttribute('name')"), "bank-search", "clear returns focus to search");

  await browser.activate(choose("barclays_personal"));
  await browser.waitFor("document.body.textContent.includes('Review your connection')");
  assert.equal(await browser.evaluate("document.body.textContent.includes('Finexer listing captured 2 Nov 2026. Coverage is not a guarantee.')"), true, "full Barclays coverage keeps the dated advisory without an extra row line");
  await browser.key("Escape", "Escape", 27);
  await browser.waitFor("document.body.textContent.includes('Choose your bank')");
  await browser.waitFor("document.activeElement?.getAttribute('data-flow-focus') === 'bank-barclays_personal'");
  await browser.key("Enter", "Enter", 13);
  await browser.waitFor("document.querySelector('[aria-label=\"Change bank\"]')");
  await browser.activate("document.querySelector('[aria-label=\"Change bank\"]')");
  await browser.waitFor("document.activeElement?.getAttribute('data-flow-focus') === 'bank-barclays_personal'");

  await browser.settle();
  await browser.activate(choose("amex"));
  await browser.waitFor("document.body.textContent.includes('Continue to Finexer')");
  await browser.activate("document.querySelector('[data-sheet-footer] button')");
  await browser.settle();
  assert.equal(await browser.evaluate("window.connectCalls"), 1, "Continue is the explicit transport boundary");
  assert.equal(await browser.evaluate("window.connectedBank"), "amex");
  assert.equal(await browser.evaluate("document.querySelector('[data-sheet-footer] button').disabled"), true, "pending transport cannot submit again");
  await browser.evaluate("document.querySelector('[data-sheet-footer] button').click()");
  assert.equal(await browser.evaluate("window.connectCalls"), 1, "disabled Continue does not invoke transport twice");

  await render("loading");
  await browser.waitFor("document.body.textContent.includes('Loading banks')");
  await render("error");
  await browser.waitFor("document.body.textContent.includes('We could not load banks')");
  await browser.activate("document.querySelector('[data-sheet-frame] button:not([aria-label])')");
  assert.equal(await browser.evaluate("window.retryCalls"), 1, "retry calls only the supplied retry boundary");

  await browser.viewport(390, 844);
  for (const theme of ["light", "dark"]) {
    await browser.evaluate(`document.documentElement.className = ${JSON.stringify(theme === "dark" ? "dark" : "")}`);
    await render("ready");
    await browser.shot(`initial-sheet-${theme}-390`, { full: true });
  }
  await browser.viewport(1280, 844);
  await browser.evaluate("document.documentElement.className = ''");
  await render("ready");
  await browser.shot("initial-sheet-1280", { full: true });
  assert.deepEqual(browser.exceptions, [], JSON.stringify(browser.exceptions));
  assert.deepEqual(browser.apiRequests, [], JSON.stringify(browser.apiRequests));
  assert.equal(await browser.evaluate("performance.getEntriesByType('resource').every(entry => new URL(entry.name).origin === location.origin)"), true, "all browser resources are same-origin");
  await browser.save("result", { passed: true, widths: [320, 390, 1280], themes: ["light", "dark"], screenshots: ["initial-sheet-light-390", "initial-sheet-dark-390", "initial-sheet-1280", "review-health-light-390", "review-health-dark-390", "review-unknown-320"], checks: ["actual flow and sheet", "partial/full/unknown coverage", "health notice", "search focus", "escape and change focus restoration", "explicit one-time transport stub", "loading error retry", "no external requests"], exceptions: browser.exceptions });
  console.log(`G395 coverage browser matrix passed; evidence: ${evidence}`);
} finally {
  browser.close();
  await new Promise(resolve => server.close(resolve));
}
