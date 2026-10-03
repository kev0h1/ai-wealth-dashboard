#!/usr/bin/env node
// G199 drift gate: the sign-in hand-off page has ONE source,
// shared/signin-handoff/template.html. The backend (generated Python copy) and
// the /design/signin-handoff preview (generated TS copy) must both carry exactly
// that template, and the preview must render it through @wealth/shared rather
// than hand-writing markup. Plain Node, no deps.
//
// Usage: node scripts/check-signin-handoff.mjs   (from frontend/)

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const read = (...p) => readFileSync(path.join(root, ...p), "utf8");

const failures = [];
const src = read("shared", "signin-handoff", "template.html");
const sha = createHash("sha256").update(src, "utf8").digest("hex");

const ts = read("shared", "src", "signinHandoffTemplate.ts");
const tsSha = /SIGNIN_HANDOFF_TEMPLATE_SHA256 = "([0-9a-f]{64})"/.exec(ts)?.[1];
const tsBody = /SIGNIN_HANDOFF_TEMPLATE: string = (".*");\s*$/s.exec(ts)?.[1];
if (tsSha !== sha) failures.push("shared/src/signinHandoffTemplate.ts hash differs from template.html (run scripts/gen_signin_handoff.py)");
if (!tsBody || JSON.parse(tsBody) !== src) failures.push("shared/src/signinHandoffTemplate.ts body differs from template.html");

const py = read("backend", "app", "core", "signin_handoff_template.py");
if (!py.includes(`TEMPLATE_SHA256 = "${sha}"`)) failures.push("backend signin_handoff_template.py hash differs from template.html (run scripts/gen_signin_handoff.py)");
// Compare the Python copy's BODY too (a hash line alone can be left stale by a hand edit).
const pyBody = spawnSync("python3", ["-c",
  "import json,sys;ns={};exec(open(sys.argv[1]).read(),ns);sys.stdout.write(json.dumps(ns['TEMPLATE']))",
  path.join(root, "backend", "app", "core", "signin_handoff_template.py")], { encoding: "utf8" });
if (pyBody.status !== 0 || JSON.parse(pyBody.stdout) !== src) failures.push("backend signin_handoff_template.py body differs from template.html (run scripts/gen_signin_handoff.py)");
if (/onclick=|<[^>]+\sstyle=/i.test(src)) failures.push("template.html uses an inline handler or style attribute; the route CSP only allows hashed <style>/<script> blocks");

for (const marker of ["wealthdash://auth-done", "{{state}}", "id=\"return\"", "id=\"msg\"", "prefers-color-scheme"]) {
  if (!src.includes(marker)) failures.push(`template.html lost marker ${marker}`);
}
if (/gradient/i.test(src)) failures.push("template.html contains a gradient (Penny's alone, DESIGN.md)");
if (/—/.test(src)) failures.push("template.html contains an em dash");

// The preview is split (H107): page.tsx is a Suspense wrapper that must import the
// client component, and SigninHandoffClient.tsx renders the real template.
// Both files are held to the no-hand-written-markup / no-variant rules below.
const pageOnly = read("frontend", "app", "design", "signin-handoff", "page.tsx");
const client = read("frontend", "app", "design", "signin-handoff", "SigninHandoffClient.tsx");
const page = pageOnly + "\n" + client;
if (!/from\s+"\.\/SigninHandoffClient"/.test(pageOnly)) failures.push("preview page.tsx must import SigninHandoffClient");
if (!/from\s+"@wealth\/shared"/.test(client) || !client.includes("signinHandoffHtml(")) failures.push("preview must render via signinHandoffHtml from @wealth/shared");
if (/data-variant|\{\{variant\}\}|ledger/.test(src)) failures.push("template.html still carries a variant slot or the retired ledger markup (B is the only design)");
if (/variant/i.test(page)) failures.push("preview still references variants (B is the only design)");
if (/<style|<html|wealthdash:\/\//.test(page)) failures.push("preview page hand-writes markup that belongs in the shared template");

if (failures.length) {
  console.error("check:signin-handoff FAILED");
  for (const f of failures) console.error(" - " + f);
  process.exit(1);
}
console.log("check:signin-handoff ok (template sha256 " + sha.slice(0, 12) + ")");
