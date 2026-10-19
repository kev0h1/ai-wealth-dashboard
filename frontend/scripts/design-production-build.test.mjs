// A97 build-level proof. Intentionally separate from the quick check:* gate:
// runs real Next builds with the repository config in a tiny isolated app.
// Usage: node scripts/design-production-build.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const frontend = fileURLToPath(new URL("../", import.meta.url));
const root = fs.mkdtempSync(path.join(frontend, ".a97-build-test-"));
const secret = "A97_PREVIEW_SECRET_MUST_NOT_SHIP";
const next = path.join(frontend, "node_modules/next/dist/bin/next");
const config = ts.transpileModule(fs.readFileSync(path.join(frontend, "next.config.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;

function write(dir, name, source) {
  const target = path.join(dir, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, source);
}

function textFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? textFiles(file) : /\.(?:js|json|html|txt|rsc)$/.test(file) ? [file] : [];
  });
}

async function build(dir, env, compiler) {
  const child = spawn(process.execPath, [next, "build", compiler], { cwd: dir, env });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(output)));
  });
}

async function checkHttp(dir, env, blocked) {
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, [next, "start", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: dir, env });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  try {
    const origin = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let i = 0; i < 120; i++) {
      try { ready = (await fetch(origin)).status === 200; } catch {}
      if (ready) break;
      if (child.exitCode !== null) throw new Error(output);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready, `test server did not start: ${output}`);
    for (const route of ["/design", "/design/demo?variant=a", "/design/api"]) {
      const response = await fetch(`${origin}${route}`);
      const body = await response.text();
      assert.equal(response.status, blocked ? 404 : 200, route);
      assert.equal(body.includes(secret), !blocked, `${route}: preview data`);
    }
    assert.equal((await fetch(`${origin}/design-extra`)).status, 200, "unrelated route remains available");
  } finally {
    child.kill("SIGTERM");
    if (child.exitCode === null) await new Promise(resolve => child.on("exit", resolve));
  }
}

try {
  for (const [name, appEnv, vercelEnv, mobile, compiler, blocked] of [
    ["production-turbopack", "production", "", "", "--turbopack", true],
    ["production-webpack", "uat", "production", "", "--webpack", true],
    ["production-export", "production", "", "1", "--turbopack", true],
    ["uat-turbopack", "uat", "", "", "--turbopack", false],
  ]) {
    console.log(`building ${name}...`);
    const dir = path.join(root, name);
    write(dir, "next.config.js", `${config}\nmodule.exports = exports.default;`);
    write(dir, "scripts/production-design-loader.cjs", fs.readFileSync(path.join(frontend, "scripts/production-design-loader.cjs")));
    write(dir, "package.json", JSON.stringify({ private: true, dependencies: { next: "16.4.0", react: "19.2.4", "react-dom": "19.2.4" } }));
    fs.symlinkSync(path.join(frontend, "node_modules"), path.join(dir, "node_modules"), "dir");
    write(dir, "app/layout.jsx", `export default function Layout({ children }) { return <html><body>{children}</body></html>; }`);
    write(dir, "app/page.jsx", `export default function Page() { return <p>Public product</p>; }`);
    write(dir, "app/design-extra/page.jsx", `export default function Page() { return <p>Unrelated route</p>; }`);
    write(dir, "app/design/PreviewClient.jsx", `"use client"; export default function PreviewClient() { return <p>${secret}</p>; }`);
    write(dir, "app/design/not-found.jsx", `export default function NotFound() { return <p>${secret}</p>; }`);
    write(dir, "app/design/error.jsx", `"use client"; export default function Error() { return <p>${secret}</p>; }`);
    write(dir, "app/design/page.jsx", `"use client"; import PreviewClient from "./PreviewClient"; export default PreviewClient;`);
    write(dir, "app/design/demo/page.jsx", `import PreviewClient from "../PreviewClient"; export default function Page() { return <PreviewClient />; }`);
    write(dir, "app/design/api/route.js", `export const dynamic = "force-static"; export function GET() { return Response.json({ text: "${secret}" }); }`);
    const env = { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_BUILD_TAG: "test",
      NEXT_PUBLIC_RELEASE_SHA: "test", NEXT_PUBLIC_SENTRY_DSN: "", SENTRY_AUTH_TOKEN: "", VERCEL: "1",
      NEXT_PUBLIC_APP_ENV: appEnv, VERCEL_ENV: vercelEnv, MOBILE_EXPORT: mobile };
    await build(dir, env, compiler);
    const emitted = textFiles(path.join(dir, ".next/static"));
    const emittedSecret = emitted.some(file => fs.readFileSync(file, "utf8").includes(secret));
    assert.equal(emittedSecret, !blocked, `${name}: emitted client bundles`);
    if (mobile) {
      assert.ok(!textFiles(path.join(dir, "out")).some(file => fs.readFileSync(file, "utf8").includes(secret)), "static export contains no preview data");
    } else {
      await checkHttp(dir, env, blocked);
    }
    console.log(`${name}: bundle and response checks passed`);
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
