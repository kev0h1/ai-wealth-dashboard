// Manual Chromium check of the real header, not a retained design preview.
// Run with the project's _tsx-loader and a local Next server on port 3146.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { get } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderPeriodBar } from "./g285-period-bar.test.mjs";

const origin = process.env.G285_TEST_ORIGIN || "http://127.0.0.1:3146";
const output = process.argv[2];
assert.ok(output && path.isAbsolute(output), "Pass an absolute scratch output directory");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), "g285-foldin-chrome-"));
const chrome = spawn("/usr/bin/google-chrome", ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
const results = [];
try {
  let port;
  for (let n = 0; n < 100; n++) {
    try { port = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; break; } catch { await delay(100); }
  }
  assert.ok(port, "Chrome exposes a local debugging port");
  const info = await new Promise((resolve, reject) => {
    const request = get({ hostname: "127.0.0.1", port, path: "/json/version" }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { body += chunk; });
      response.on("error", reject);
      response.on("end", () => { try { assert.equal(response.statusCode, 200); resolve(JSON.parse(body)); } catch (error) { reject(error); } });
    });
    request.on("error", reject);
    request.setTimeout(5000, () => request.destroy(new Error("Chrome metadata timed out")));
  });
  socket = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let seq = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(String(data));
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id); clearTimeout(task.timer);
    if (message.error) task.reject(new Error(JSON.stringify(message.error))); else task.resolve(message.result);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout ${method}`)); }, 45000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);
  await call("Page.enable"); await call("Runtime.enable"); await call("Network.enable");
  await call("Network.setBlockedURLs", { urls: ["*/api/*", "https://*"] });
  const evaluate = async expression => {
    const reply = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails));
    return reply.result.value;
  };
  const waitFor = async expression => {
    for (let n = 0; n < 200; n++) { if (await evaluate(expression)) return; await delay(100); }
    const state = await evaluate(`({ url:location.href, theme:document.documentElement.className, ready:document.readyState, text:document.body.innerText.slice(0,500) })`);
    throw new Error(`Page condition timed out: ${expression}; ${JSON.stringify(state)}`);
  };
  const viewport = width => call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
  const navigate = async mode => {
    // Wait for a fresh document so a same-URL reload cannot satisfy readiness
    // from the outgoing page while its replacement is still loading.
    await call("Page.navigate", { url: "about:blank" });
    await waitFor(`location.href === 'about:blank'`);
    await call("Page.navigate", { url: `${origin}/design/spend-live?mode=${mode}&state=normal` });
    await waitFor(`document.querySelector('[data-g285-period-bar]') && document.documentElement.classList.contains('dark') === ${mode === "dark"}`);
    await evaluate("document.fonts.ready.then(() => true)");
    await delay(750);
  };
  const click = async expression => {
    const box = await evaluate(`(() => { const e = ${expression}; e.focus(); const r = e.getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 }; })()`);
    await call("Input.dispatchMouseEvent", { type: "mousePressed", ...box, button: "left", clickCount: 1 });
    await call("Input.dispatchMouseEvent", { type: "mouseReleased", ...box, button: "left", clickCount: 1 });
  };
  const key = async (key, code = key, modifiers = 0) => {
    await call("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers, windowsVirtualKeyCode: key === "Tab" ? 9 : 27 });
    await call("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers, windowsVirtualKeyCode: key === "Tab" ? 9 : 27 });
  };

  // This round uses the hydrated production component in an existing fixture
  // page. These controls execute real callbacks and the real SheetFrame.
  await viewport(390); await navigate("light");
  await click(`document.querySelector('[aria-label="Previous pay period"]')`);
  await waitFor(`document.querySelector('[aria-label="Next pay period"]').disabled === false`);
  await click(`document.querySelector('[aria-label="Next pay period"]')`);
  await waitFor(`document.querySelector('[aria-label="Next pay period"]').disabled === true`);
  await click(`document.querySelector('[data-period-picker]')`);
  await waitFor(`document.querySelector('[data-sheet-frame]') && history.state?.__sheetA11yId`);
  await delay(350);
  await key("Escape");
  await waitFor(`!document.querySelector('[data-sheet-frame]')`);
  assert.equal(await evaluate(`document.activeElement.matches('[data-period-picker]')`), true, "Escape restores picker focus");
  await key("Tab");
  assert.equal(await evaluate(`document.activeElement.getAttribute('aria-label')`), "Previous pay period");
  await key("Tab");
  assert.equal(await evaluate(`document.activeElement.getAttribute('aria-label')`), "Search transactions", "Disabled Next is skipped");
  await click(`document.querySelector('[data-period-picker]')`);
  await waitFor(`document.querySelector('[data-sheet-frame]') && history.state?.__sheetA11yId`);
  await delay(350);
  await click(`document.querySelectorAll('[data-sheet-frame] [data-tutorial-id="tutorial-spend-periods"] button')[1]`);
  await waitFor(`!document.querySelector('[data-sheet-frame]') && document.querySelector('[aria-label="Next pay period"]').disabled === false`);
  await click(`[...document.querySelectorAll('button')].find(e => e.textContent.trim() === 'Back to this period')`);
  await waitFor(`document.querySelector('[aria-label="Next pay period"]').disabled === true`);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Search transactions"]').getAttribute('href')`), "/transactions");

  // Layout cases server-render the exact production component with synthetic
  // props, then use the real Next CSS/fonts. They are layout, not interaction
  // evidence for those period props; no hand-authored header markup is used.
  const fixtures = [
    ["monthly", "2026-09-25", "2026-10-29", 6, 29],
    ["year", "2026-12-25", "2027-01-28", 6, 29],
    ["weekly", "2026-09-21", "2026-09-27", 3, 4],
  ];
  for (const mode of ["light", "dark"]) {
    await viewport(390); await navigate(mode);
    for (const width of [320, 360, 375, 390, 768, 1280]) for (const [name, ...period] of fixtures) {
      await viewport(width);
      await evaluate(`document.querySelector('[data-g285-period-bar]').outerHTML = ${JSON.stringify(renderPeriodBar(...period))}`);
      await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
      const measurement = await evaluate(`(() => {
        const header = document.querySelector('[data-g285-period-bar]');
        const h = header.getBoundingClientRect();
        const title = header.querySelector('[data-period-title]').getBoundingClientRect();
        const picker = header.querySelector('[data-period-picker]').getBoundingClientRect();
        const label = document.createRange(); label.selectNodeContents(header.querySelector('[data-period-label]'));
        const r = label.getBoundingClientRect();
        const controls = [...header.querySelectorAll('button,a')].map(e => { const b = e.getBoundingClientRect(); return { w:b.width,h:b.height }; });
        const tracks = [...header.children].map(e => { const b=e.getBoundingClientRect(); return { left:b.left,right:b.right,cy:b.y+b.height/2 }; });
        return { text:header.querySelector('[data-period-label]').textContent, controls, viewport:innerWidth,
          clipped:r.right > picker.right+.5 || picker.right > title.right+.5,
          overflow:tracks.some(b => b.left < h.left-.5 || b.right > h.right+.5),
          rowSpread:Math.max(...tracks.map(b=>b.cy))-Math.min(...tracks.map(b=>b.cy)),
          clip:{x:Math.max(0,h.x-12),y:Math.max(0,h.y-12),width:h.width+24,height:h.height+24} };
      })()`);
      assert.equal(measurement.viewport, width);
      assert.equal(measurement.clipped, false, `${mode}/${width}/${name} complete date`);
      assert.equal(measurement.overflow, false, `${mode}/${width}/${name} tracks fit`);
      assert.ok(measurement.rowSpread < 1, `${mode}/${width}/${name} same outer row`);
      assert.ok(measurement.controls.every(b => b.w >= 44 && b.h >= 44), "44px targets");
      results.push({ mode, width, name, ...measurement });
      if ((width === 390 && name === "monthly") || (width === 320 && name === "year") || (width === 1280 && name === "monthly")) {
        const shot = await call("Page.captureScreenshot", { format: "png", clip: { ...measurement.clip, scale: 1 } });
        await writeFile(path.join(output, `${mode}-${width}-${name}.png`), Buffer.from(shot.data, "base64"));
      }
    }
  }
  await writeFile(path.join(output, "results.json"), JSON.stringify({ layouts: results.length, interactions: "real production callbacks, sheet, keyboard and focus", results }, null, 2));
  console.log(JSON.stringify({ layouts: results.length, interactions: "passed", output }));
} finally {
  socket?.close();
  chrome.kill("SIGTERM");
}
