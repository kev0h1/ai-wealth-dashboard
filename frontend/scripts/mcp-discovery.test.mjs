// F21: the OAuth issuer is <origin>/api, so spec-following MCP clients (RFC
// 8414 / RFC 9728 path insertion) request these well-known documents at the
// ORIGIN. next.config.ts must rewrite each to the backend's existing
// document, ahead of the catch-all /api/:path* rule.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import os from "node:os";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "next.config.ts"), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "f21-"));
try {
  const file = path.join(tmp, "next.config.cjs");
  fs.writeFileSync(file, js);
  const out = execFileSync(
    process.execPath,
    ["-e", `const c=require(${JSON.stringify(file)}).default;c.rewrites().then(r=>process.stdout.write(JSON.stringify(r)))`],
    { env: { ...process.env, NEXT_PUBLIC_BUILD_TAG: "test", BACKEND_URL: "http://backend.test", MOBILE_EXPORT: "" } },
  );
  const rewrites = JSON.parse(out.toString());
  const expected = {
    "/.well-known/oauth-authorization-server/api": "http://backend.test/.well-known/oauth-authorization-server",
    "/.well-known/openid-configuration/api": "http://backend.test/.well-known/openid-configuration",
    "/.well-known/oauth-protected-resource/api/mcp": "http://backend.test/.well-known/oauth-protected-resource",
  };
  const catchAll = rewrites.findIndex((r) => r.source === "/api/:path*");
  assert.ok(catchAll >= 0, "/api/:path* rewrite must still exist");
  for (const [src, dest] of Object.entries(expected)) {
    const idx = rewrites.findIndex((r) => r.source === src);
    assert.ok(idx >= 0, `missing rewrite for ${src}`);
    assert.equal(rewrites[idx].destination, dest, `wrong destination for ${src}`);
    assert.ok(idx < catchAll, `${src} must come before the /api/:path* catch-all`);
  }
  console.log("mcp-discovery: ok");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
