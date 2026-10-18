// Local, auth-exempt preview verification. No installed browser dependency.
// CDP's device-metrics override is the same viewport mechanism used by
// Puppeteer; Chrome's 500px command-line window minimum is not used.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const base = process.env.G285_PREVIEW_ORIGIN || "http://127.0.0.1:3145";
const output = process.argv[2];
if (!output || !path.isAbsolute(output)) throw new Error("Pass an absolute scratch output directory");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), "g285-chrome-"));
// A CLI --virtual-time-budget run exits its target when the budget ends;
// a persistent CDP session awaits actual hydration, fonts and paint instead.
const chrome = spawn("/usr/bin/google-chrome", ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
const failures = [];
const results = [];
try {
  let port;
  for (let n = 0; n < 100; n++) {
    try { port = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; break; } catch { await delay(100); }
  }
  if (!port) throw new Error("Chrome did not expose its local debugging port");
  const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  socket = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  const requests = [];
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(String(data));
    if (message.id && pending.has(message.id)) {
      const { resolve, reject, timer } = pending.get(message.id);
      pending.delete(message.id); clearTimeout(timer);
      if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
    }
    if (message.method === "Network.requestWillBeSent") requests.push(message.params.request.url);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)); }, 45000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);
  await call("Page.enable"); await call("Runtime.enable"); await call("Network.enable");
  await call("Network.setBlockedURLs", { urls: ["*/api/*", "https://*"] });
  const evaluate = async expression => {
    const response = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text + " " + JSON.stringify(response.exceptionDetails.exception));
    return response.result.value;
  };
  const waitFor = async expression => {
    for (let n = 0; n < 200; n++) { if (await evaluate(expression)) return; await delay(100); }
    throw new Error(`Page condition timed out: ${expression}`);
  };
  const viewport = async width => {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600, screenWidth: width, screenHeight: 900 });
  };
  const navigate = async (variant, mode, scenario = "monthly", state = "ready", width = 390) => {
    await viewport(width);
    await call("Page.navigate", { url: `${base}/design/spend-period-picker?variant=${variant}&mode=${mode}&scenario=${scenario}&state=${state}` });
    await waitFor(`(() => { const d = document.querySelector('[data-spend-header]')?.dataset; return d?.previewReady === 'true' && d.variant === '${variant}' && d.scenario === '${scenario}' && d.state === '${state}' && document.documentElement.classList.contains('dark') === ${mode === "dark"}; })()`);
    await evaluate("document.fonts.ready.then(() => true)");
    await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
  };
  const measure = async width => evaluate(`(() => {
    const header = document.querySelector('[data-spend-header]');
    const box = header.getBoundingClientRect();
    const label = header.querySelector('[data-period-label]');
    const text = document.createRange(); text.selectNodeContents(label);
    const rect = text.getBoundingClientRect();
    const door = header.querySelector('[data-period-door]').getBoundingClientRect();
    const children = [...header.children].map(el => { const b = el.getBoundingClientRect(); return { left:b.left, right:b.right, cy:(b.top+b.bottom)/2 }; });
    const title = header.querySelector('[data-title-block]');
    const titleBox = title.getBoundingClientRect();
    const titleText = document.createRange(); titleText.selectNodeContents(title);
    const titleRect = titleText.getBoundingClientRect();
    return { width: innerWidth, expected: ${width}, text: label.textContent,
      overflow: children.some(b => b.left < box.left - .5 || b.right > box.right + .5),
      clipped: rect.left < door.left - .5 || rect.right > door.right + .5,
      titleClipped: titleRect.left < titleBox.left - .5 || titleRect.right > titleBox.right + .5,
      targets: [...header.querySelectorAll('button')].map(el => { const b = el.getBoundingClientRect(); return { name:el.getAttribute('aria-label'), width:b.width, height:b.height }; }),
      rowSpread: Math.max(...children.map(b => b.cy)) - Math.min(...children.map(b => b.cy)),
      ellipsis: getComputedStyle(label).textOverflow,
      search: !!header.querySelector('[data-search]'),
      year: header.textContent.includes('2026 to 2027'),
      font: getComputedStyle(label).fontFamily };
  })()`);
  const capture = async filename => {
    const shot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(path.join(output, filename), Buffer.from(shot.data, "base64"));
  };

  // One batched layout pass, both themes, all requested phone widths and desktop.
  for (const variant of process.env.G285_INTERACTIONS_ONLY ? [] : ["a", "b", "c"]) for (const mode of ["light", "dark"]) for (const width of [320, 360, 375, 390, 1280]) for (const scenario of ["monthly", "year", "weekly"]) {
    await navigate(variant, mode, scenario, "ready", width);
    const result = await measure(width);
    results.push({ variant, mode, width, scenario, ...result });
    const key = `${variant}-${mode}-${width}-${scenario}`;
    try {
      assert.equal(result.width, width, "real emulated CSS viewport");
      assert.equal(result.overflow, false, "header child outside available width");
      assert.equal(result.clipped, false, "full range is clipped");
      assert.equal(result.titleClipped, false, "title or day paints outside its grid track");
      assert.ok(!result.text.includes("…"), "date contains ellipsis");
      assert.ok(result.search, "Search is missing");
      assert.ok(result.targets.every(target => target.width >= 43.9 && target.height >= 43.9), "target below 44px");
      if (width >= 375 || variant !== "a") assert.ok(result.rowSpread < 1, "header unexpectedly wraps");
      if (scenario === "monthly") assert.equal(result.text, "25 Sep to 29 Oct");
      if (scenario === "year") assert.ok(result.year, "cross-year context missing");
    } catch (error) { failures.push({ key, message: error.message }); }
    if ((width === 390 && scenario === "monthly") || (width === 320 && scenario === "year") || (width === 1280 && scenario === "monthly")) await capture(`${key}.png`);
  }

  // Interaction, keyboard and non-happy states in the same bounded pass.
  for (const variant of ["a", "b", "c"]) {
    await navigate(variant, "light");
    const click = async selector => {
      const point = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({block:'center'}); const b = el.getBoundingClientRect(); return {x:b.left+b.width/2,y:b.top+b.height/2}; })()`);
      await call("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
      await call("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
    };
    const sheetReady = async () => { await waitFor("!!document.querySelector('[data-sheet-frame]') && !!history.state?.__sheetA11yId"); await delay(350); };
    if (variant === "c") { await click("[data-period-door]"); await sheetReady(); await capture("c-periods-sheet.png"); await click("[data-sheet-prev]"); }
    else await click("[data-prev]");
    await waitFor("document.querySelector('[data-period-label]')?.textContent === '28 Aug to 24 Sep'");
    await viewport(320);
    const historical = await measure(320);
    assert.equal(historical.titleClipped, false, "historical day context overflows at 320px");
    assert.equal(historical.clipped, false, "historical dates clip at 320px");
    assert.ok(await evaluate("document.querySelector('[data-g186-hero]')?.textContent.includes('£3,200')"), "period figure did not follow its selected fixture");
    await click("[data-period-door]");
    await sheetReady();
    await click('[data-period-option="0"]');
    await delay(1000);
    await waitFor("document.querySelector('[data-period-label]')?.textContent === '25 Sep to 29 Oct' && !document.querySelector('[data-sheet-frame]')");
    await viewport(390);
    await click("[data-search]");
    await sheetReady();
    await evaluate("document.querySelector('#sample-search').focus()");
    await call("Input.insertText", { text: "coffee" });
    assert.ok(await evaluate("document.querySelector('[data-sheet-frame]').textContent.includes('Coffee with friends') && !document.querySelector('[data-sheet-frame]').textContent.includes('Groceries')"), "local search did not filter");
    await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
    await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
    await waitFor("!document.querySelector('[data-sheet-frame]')");
    assert.ok(await evaluate("document.activeElement === document.querySelector('[data-search]')"), "Escape did not restore Search focus");
    for (const state of ["loading", "error", "empty"]) {
      await navigate(variant, "dark", "monthly", state, 375);
      const measured = await measure(375);
      assert.equal(measured.overflow, false, `${variant}/${state} overflow`);
      assert.equal(measured.clipped, false, `${variant}/${state} clipped`);
      if (state === "loading") assert.ok(await evaluate("document.querySelector('[data-period-door]').disabled"));
      else { await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Try again' || b.textContent === 'Use sample periods').click()"); await waitFor("document.querySelector('[data-period-label]')?.textContent === '25 Sep to 29 Oct'"); }
    }
  }
  assert.ok(!requests.some(url => new URL(url).pathname.startsWith("/api/")), "preview attempted an API request (blocked)");
  await writeFile(path.join(output, "results.json"), JSON.stringify({ results, failures, apiRequests: 0 }, null, 2));

  // Contact sheets are only local inspection evidence, not shipped UI/assets.
  for (const [name, theme, width, scenario] of process.env.G285_INTERACTIONS_ONLY ? [] : [["phone-light", "light", 390, "monthly"], ["phone-dark", "dark", 390, "monthly"], ["narrow-year", "dark", 320, "year"]]) {
    const images = await Promise.all(["a", "b", "c"].map(async variant => ({ variant, data: (await readFile(path.join(output, `${variant}-${theme}-${width}-${scenario}.png`))).toString("base64") })));
    await viewport(width * 3 + 48);
    const html = `<html><body style="margin:0;background:#64748b;display:flex;gap:12px;padding:12px">${images.map(item => `<div><div style="font:16px system-ui;color:white;height:24px">${item.variant.toUpperCase()}</div><img width="${width}" height="900" src="data:image/png;base64,${item.data}"></div>`).join("")}</body></html>`;
    await call("Page.navigate", { url: "data:text/html;base64," + Buffer.from(html).toString("base64") });
    await waitFor("document.images.length === 3 && [...document.images].every(image => image.complete)");
    await capture(`${name}.png`);
  }
  console.log(JSON.stringify({ layouts: results.length, interactionVariants: 3, nonHappyStates: 9, failures, output }));
  assert.equal(failures.length, 0, "layout failures recorded in results.json");
} catch (error) {
  if (socket?.readyState === WebSocket.OPEN) console.error("Browser checks stopped:", error.message);
  await writeFile(path.join(output, "results.json"), JSON.stringify({ results, failures, error: error.message }, null, 2));
  throw error;
} finally {
  socket?.close();
  chrome.kill("SIGTERM");
}
