// C50 behavioural gate: bundle the shipped LoginScreen and DemoSignIn, then
// exercise the real controls in a disposable browser. The platform bridge and
// fetch boundary are fixture-only; neither production component is replaced.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { openBrowser } from "./_plan-browser.mjs";

const out = await mkdtemp(path.join(tmpdir(), "c50-reviewer-demo-"));
const mutateReveal = process.env.C50_MUTATE_DEMO_REVEALED === "1";
const entry = `
import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import LoginScreen from "./components/LoginScreen";

const params = new URLSearchParams(location.search);
window.fixture = {
  platform: params.get("platform") || "web",
  enabled: params.get("enabled") !== "0",
  fetches: [],
  writes: [],
  mounts: 0,
};
window.fetch = async (input, init = {}) => {
  const url = String(input);
  const method = String(init.method || "GET").toUpperCase();
  window.fixture.fetches.push({ url, method });
  if (method !== "GET") window.fixture.writes.push({ url, method });
  if (url.endsWith("/auth/demo/enabled")) {
    return new Response(JSON.stringify({ enabled: window.fixture.enabled }), { status: 200 });
  }
  if (url.endsWith("/auth/demo/login")) {
    return new Response(JSON.stringify({ detail: "disabled" }), { status: 404 });
  }
  throw new Error("Unexpected fixture fetch: " + url);
};

function LoginMount() {
  useEffect(() => { window.fixture.mounts += 1; }, []);
  return <LoginScreen />;
}

function Surface() {
  const key = useRef(0);
  const [, rerender] = React.useState(0);
  window.remount = () => { key.current += 1; rerender((value) => value + 1); };
  return <LoginMount key={key.current} />;
}

createRoot(document.getElementById("root")).render(<Surface />);
`;

const nativeAuthFixture = `
export const isNativePlatform = () => window.fixture.platform !== "web";
export const isIOSNative = () => window.fixture.platform === "ios";
export const nativeGoogleLogin = async () => "cancelled";
export const nativeAppleLogin = async () => "cancelled";
export const cancelNativeLogin = () => {};
`;

await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: "tsx" },
  bundle: true,
  jsx: "automatic",
  outfile: path.join(out, "bundle.js"),
  define: {
    "process.env": "{}",
    "process.env.NODE_ENV": '"production"',
    "process.env.NEXT_PUBLIC_APP_ENV": '"production"',
    "process.env.NEXT_PUBLIC_API_URL": '"/api"',
  },
  plugins: [
    {
      name: "c50-fixture-boundaries",
      setup(bundle) {
        bundle.onResolve({ filter: /^@\/lib\/nativeAuth$/ }, () => ({ path: "@/lib/nativeAuth", namespace: "c50-fixture" }));
        bundle.onLoad({ filter: /.*/, namespace: "c50-fixture" }, () => ({ contents: nativeAuthFixture, loader: "tsx", resolveDir: process.cwd() }));
      },
    },
    {
      name: "c50-in-memory-break-mutant",
      setup(bundle) {
        if (!mutateReveal) return;
        bundle.onLoad({ filter: /[\\/]components[\\/]LoginScreen\.tsx$/ }, async (args) => {
          const source = await readFile(args.path, "utf8");
          const changed = source.replace(
            /const demoRevealed = webDemoQuery \|\| logoActivations >= DEMO_REVEAL_ACTIVATIONS;/,
            "const demoRevealed = true;",
          );
          assert.notEqual(changed, source, "break-mutant found the production reveal condition");
          return { contents: changed, loader: "tsx", resolveDir: path.dirname(args.path) };
        });
      },
    },
  ],
});

const html = "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"></head><body><main id=\"root\"></main><script src=\"/bundle.js\"></script></body></html>";
const server = createServer(async (req, res) => {
  try {
    if ((req.url ?? "").startsWith("/bundle.js")) {
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      res.end(await readFile(path.join(out, "bundle.js")));
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(html);
  } catch {
    res.statusCode = 404;
    res.end("missing");
  }
});

let browser;
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await openBrowser({ origin: `http://127.0.0.1:${server.address().port}`, output: out });
  await browser.viewport(390, 844);

  const text = () => browser.evaluate("document.body.innerText");
  const logo = "document.querySelector('[aria-label=\"Sorted logo\"]')";
  const demo = "[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Demo sign-in')";
  const hidden = async (message) => assert.equal(await browser.evaluate(`!!(${demo})`), false, message);
  const shown = async (message) => {
    await browser.waitFor(`!!(${demo})`);
    assert.match(await text(), /Demo sign-in/, message);
  };
  const open = async (route) => {
    await browser.navigate(route, "window.fixture && window.fixture.mounts > 0");
    await browser.settle();
  };
  const activateLogo = async () => {
    await browser.activate(logo);
    await browser.settle();
  };
  const assertNoWrite = async (label) => {
    assert.deepEqual(await browser.evaluate("window.fixture.writes"), [], `${label}: the fixture issued no API write`);
  };

  // Web needs five deliberate activations. The fifth is keyboard activation,
  // which also proves that the semantic logo button remains reachable.
  await open("/?enabled=1");
  await browser.waitFor("window.fixture.fetches.some((request) => request.url.endsWith('/auth/demo/enabled'))");
  await hidden("web starts hidden before activation");
  for (let activation = 1; activation <= 4; activation += 1) {
    await activateLogo();
    await hidden(`web stays hidden after activation ${activation}`);
  }
  await browser.evaluate(`${logo}.focus()`);
  await browser.key("Enter", "Enter", 13);
  await shown("keyboard fifth activation reveals the real DemoSignIn component");
  await assertNoWrite("web reveal");

  // The count is deliberately local state: remounting the real component
  // clears it, rather than retaining a reveal through refresh/navigation.
  const mountsBeforeReset = await browser.evaluate("window.fixture.mounts");
  await browser.evaluate("window.remount()");
  await browser.waitFor(`window.fixture.mounts > ${mountsBeforeReset}`);
  await browser.settle();
  await hidden("a fresh LoginScreen mount resets the web reveal");
  await assertNoWrite("web remount");

  // The documented query is web-only and exact. A near miss cannot reveal it.
  await open("/?demo=1");
  await browser.waitFor("window.fixture.fetches.some((request) => request.url.endsWith('/auth/demo/enabled'))");
  await shown("the documented web query reveals the existing component");
  await assertNoWrite("web query");
  await open("/?demo=true");
  await browser.waitFor("window.fixture.fetches.some((request) => request.url.endsWith('/auth/demo/enabled'))");
  await hidden("a non-exact web query stays hidden");

  // A disabled web server gate wins over both reveal paths.
  await open("/?enabled=0");
  await browser.waitFor("window.fixture.fetches.some((request) => request.url.endsWith('/auth/demo/enabled'))");
  for (let activation = 1; activation <= 5; activation += 1) await activateLogo();
  await hidden("disabled web server gate keeps the revealed form absent");
  await assertNoWrite("disabled web activation");
  await open("/?enabled=0&demo=1");
  await browser.waitFor("window.fixture.fetches.some((request) => request.url.endsWith('/auth/demo/enabled'))");
  await hidden("disabled web server gate keeps the query form absent");
  await assertNoWrite("disabled web query");

  // C45's native production eligibility remains lower-level than C50's UI:
  // native skips the enabled probe, ignores the web query, and still needs
  // five activations before the actual DemoSignIn component can render.
  for (const platform of ["ios", "android"]) {
    await open(`/?platform=${platform}&demo=1`);
    assert.deepEqual(await browser.evaluate("window.fixture.fetches"), [], `${platform} production does not need the enabled probe`);
    await hidden(`${platform} ignores the web-only query`);
    for (let activation = 1; activation <= 4; activation += 1) {
      await activateLogo();
      await hidden(`${platform} stays hidden after activation ${activation}`);
    }
    await activateLogo();
    await shown(`${platform} reveals after exactly five activations`);
    await assertNoWrite(`${platform} reveal`);
    const mountsBeforeReset = await browser.evaluate("window.fixture.mounts");
    await browser.evaluate("window.remount()");
    await browser.waitFor(`window.fixture.mounts > ${mountsBeforeReset}`);
    await browser.settle();
    await hidden(`${platform} remount resets the reveal despite the ignored web query`);
    await assertNoWrite(`${platform} remount`);
  }

  assert.deepEqual(browser.exceptions, [], "no browser exceptions");
  assert.deepEqual(browser.apiRequests, [], "no request reached a real API endpoint");
  await writeFile(path.join(out, "result.json"), JSON.stringify({ passed: true, mutateReveal }, null, 2));
  console.log("c50 reviewer demo browser: ok");
} catch (error) {
  console.error("C50 browser exceptions:", browser?.exceptions ?? []);
  throw error;
} finally {
  browser?.close();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  await rm(out, { recursive: true, force: true });
}
