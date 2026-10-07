// H100: next.config.ts widens turbopack.root only when node_modules is a
// symlink resolving outside the frontend directory. Runs the real config
// (transpiled with the repo's own typescript) from three tmp geometries:
// shared tree (real dir), worktree, and the frontend_build.py staging mirror.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "next.config.ts"), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "h100-")));
function rootFor(frontendDir) {
  fs.mkdirSync(frontendDir, { recursive: true });
  const file = path.join(frontendDir, "next.config.cjs");
  fs.writeFileSync(file, js);
  const env = { ...process.env, NEXT_PUBLIC_BUILD_TAG: "test" };
  const { execFileSync } = require("node:child_process");
  const out = execFileSync(
    process.execPath,
    ["-e", `const c=require(${JSON.stringify(file)}).default;process.stdout.write(JSON.stringify(c.turbopack&&c.turbopack.root||null))`],
    { env },
  );
  return JSON.parse(out.toString());
}

try {
  const shared = path.join(tmp, "repo", "frontend");
  fs.mkdirSync(path.join(shared, "node_modules"), { recursive: true });
  assert.equal(rootFor(shared), null, "shared tree (real node_modules) must not widen");

  const worktree = path.join(tmp, "worktrees", "feature-X", "frontend");
  fs.mkdirSync(worktree, { recursive: true });
  fs.symlinkSync(path.join(shared, "node_modules"), path.join(worktree, "node_modules"));
  assert.equal(rootFor(worktree), tmp, "worktree must widen to the common ancestor");

  const staging = path.join(tmp, "repo", ".frontend-staging");
  fs.mkdirSync(staging, { recursive: true });
  fs.symlinkSync(path.join(shared, "node_modules"), path.join(staging, "node_modules"));
  assert.equal(rootFor(staging), path.join(tmp, "repo"), "staging mirror must widen to the repo root");
  console.log("turbopack-root: ok");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
