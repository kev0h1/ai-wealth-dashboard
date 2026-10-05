#!/usr/bin/env node
// G215: browser-native dialogs never ship. alert(), confirm() and prompt() draw
// the operating system's chrome (and, in the Capacitor shell, a native dialog
// titled with the host), none of it Sorted's design. Use components/ConfirmSheet
// (noticeSheet / confirmSheet) instead.
//
// Fails on a bare or window./globalThis.-qualified alert(, confirm(, prompt( call
// and on any @capacitor/dialog import under app/, components/ and lib/.
// Comments are ignored. Method calls such as foo.alert( are not matched.
// ALLOW lists files with known follow-up work, each with its reason; the
// implementation file is exempt because it defines noticeSheet.
//
// Usage: node scripts/check-no-native-dialogs.mjs   (from frontend/)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIRS = ["app", "components", "lib"];
const SKIP = new Set(["node_modules", ".next", ".next-prev"]);
const EXTS = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const ALLOW = [
  { file: "components/ConfirmSheet.tsx", reason: "the replacement primitive itself" },
  { file: "app/components/AccountsPage.tsx", reason: "G215 follow-up: G213/H108 own this file; replace each alert( with noticeSheet" },
];

const PATTERNS = [
  /(?:^|[^.\w$])(?:(?:window|globalThis|self)\s*\.\s*)?(?:alert|confirm|prompt)\s*\(/,
  /@capacitor\/dialog/,
];

export function blankComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => (/^\s*\/\//.test(line) ? "" : line.replace(/\s\/\/.*$/, "")))
    .join("\n");
}

export function findViolations(src) {
  const out = [];
  blankComments(src).split("\n").forEach((line, i) => {
    if (PATTERNS.some((p) => p.test(line))) out.push({ line: i + 1, text: line.trim() });
  });
  return out;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (EXTS.test(name)) yield full;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const allowed = new Set(ALLOW.map((a) => a.file));
  const failures = [];
  for (const d of DIRS) {
    for (const file of walk(path.join(root, d))) {
      const rel = path.relative(root, file).split(path.sep).join("/");
      if (allowed.has(rel)) continue;
      for (const v of findViolations(readFileSync(file, "utf8"))) failures.push(`${rel}:${v.line}: ${v.text}`);
    }
  }
  if (failures.length) {
    console.error("Native browser dialogs are not allowed (use components/ConfirmSheet):\n" + failures.join("\n"));
    process.exit(1);
  }
  console.log(`check:no-native-dialogs ok (${ALLOW.length} allowlisted files)`);
}
