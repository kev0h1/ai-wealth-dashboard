#!/usr/bin/env node
// G136: native date, month and datetime-local inputs never ship. The browser
// draws them in the operating system's own colours (Android shows a grey
// wheel with teal buttons), so every date the user picks goes through
// components/DatePicker (DateField + DatePickerSheet). DESIGN.md, Inputs /
// Fields, "Date and month pickers".
//
// Fails on an input type of date, month or datetime-local anywhere under
// app/, components/ and lib/ (JSX attribute, object literal, or a CSS
// attribute selector). Comments are ignored. The ALLOW list is empty on
// purpose: components/DatePicker/ must not use one either. Keep the
// mechanism so a future, justified exception has somewhere written to live:
// { file: "components/x.tsx", reason: "why" } (posix path under frontend/).
//
// Usage: node scripts/check-no-native-date-inputs.mjs   (from frontend/)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIRS = ["app", "components", "lib"];
const SKIP = new Set(["node_modules", ".next", ".next-prev"]);
const EXTS = /\.(ts|tsx|js|jsx|mjs|cjs|css)$/;
const ALLOW = [];

const TYPES = "date|month|datetime-local";
const PATTERNS = [
  new RegExp(`\\btype\\s*=\\s*\\{?\\s*["'\`](?:${TYPES})["'\`]`),
  new RegExp(`\\btype\\s*:\\s*["'\`](?:${TYPES})["'\`]`),
  new RegExp(`\\[\\s*type\\s*=\\s*["']?(?:${TYPES})["']?\\s*\\]`),
  /\.(valueAsDate|showPicker)\b/,
];

/** Blank block comments and whole-line // comments, keeping line numbers. */
export function blankComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => (/^\s*\/\//.test(line) ? "" : line))
    .join("\n");
}

export function findOffences(src) {
  const out = [];
  blankComments(src).split("\n").forEach((line, i) => {
    if (PATTERNS.some((re) => re.test(line))) out.push({ line: i + 1, text: line.trim() });
  });
  return out;
}

// Self-test, so the guard cannot rot into a no-op.
const must = ['<input type="date" />', "<input type='month'/>", '<input type={"datetime-local"} />', "{ type: \"date\" }", 'input[type="date"] { appearance: none }', "el.showPicker()"];
const mustNot = ['<input type="text" />', '// <input type="date" />', '/* type="month" */', '<DateField mode="day" />'];
for (const s of must) if (findOffences(s).length === 0) { console.error(`check-no-native-date-inputs: self-test failed to catch: ${s}`); process.exit(2); }
for (const s of mustNot) if (findOffences(s).length !== 0) { console.error(`check-no-native-date-inputs: self-test false positive: ${s}`); process.exit(2); }

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (EXTS.test(name)) acc.push(full);
  }
  return acc;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const used = new Set();
  const problems = [];
  for (const d of DIRS) {
    for (const file of walk(path.join(root, d))) {
      const rel = path.relative(root, file).split(path.sep).join("/");
      const hits = findOffences(readFileSync(file, "utf8"));
      if (!hits.length) continue;
      const allowed = ALLOW.find((a) => a.file === rel);
      if (allowed) { used.add(allowed.file); continue; }
      for (const h of hits) problems.push(`${rel}:${h.line}: ${h.text}`);
    }
  }
  for (const a of ALLOW) if (!used.has(a.file)) problems.push(`stale allowlist entry: ${a.file}`);
  if (problems.length) {
    console.error("check-no-native-date-inputs: native date inputs must use components/DatePicker (DateField):\n  " + problems.join("\n  "));
    process.exit(1);
  }
  console.log("check-no-native-date-inputs: ok");
}
