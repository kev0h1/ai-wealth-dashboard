#!/usr/bin/env node
// A153: Finexer Client Terms Part C clause A4.1 requires this sentence verbatim
// in our terms, on our website and in the consent journey. Exact string match.
// Also bans the words A4.4 forbids (AURIQ is an agent, not an AR or tied agent).
// Plain Node, no deps.  Usage: node scripts/check-agency-disclosure.mjs (from frontend/)
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(frontend, "..");
const SENTENCE =
  "AURIQ LTD is acting as an agent of Finexer LTD, which is authorised by the Financial Conduct Authority under the Payment Services Regulations 2017, firm reference number 925695, as an Authorised Payment Institution to provide account information services and payment initiation services.";
const read = (p) => readFileSync(path.join(root, p), "utf8");
const failures = [];

// Files that must contain the sentence literally (terms, hand-off template and
// the single-source TS constant that LoginScreen, BankPickerSheet and
// LegalDocument render).
for (const p of [
  "frontend/content/terms.md", "TERMS.md", "frontend/lib/regulatoryCopy.ts",
  "shared/signin-handoff/template.html",
]) {
  if (!read(p).includes(SENTENCE)) failures.push(`${p} does not contain the A4.1 sentence verbatim`);
}
// Components must render the shared constant (so they cannot drift).
for (const p of ["frontend/components/BankPickerSheet.tsx", "frontend/components/LoginScreen.tsx", "frontend/components/LegalDocument.tsx"]) {
  if (!/\{AGENT_DISCLOSURE\}/.test(read(p))) failures.push(`${p} does not render {AGENT_DISCLOSURE}`);
}
if (/[—–]/.test(SENTENCE)) failures.push("sentence constant contains a dash character");

const banned = [/appointed representative/i, /tied agent/i];
const skip = new Set(["node_modules", ".next"]);
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (skip.has(n)) continue;
    const f = path.join(dir, n);
    const s = statSync(f);
    if (s.isDirectory()) walk(f, out);
    else if (/\.(md|tsx?|html|mjs|json)$/.test(n)) out.push(f);
  }
  return out;
}
const dirs = [path.join(frontend, "content"), path.join(frontend, "components"), path.join(frontend, "app"), path.join(root, "shared")];
for (const d of dirs) {
  for (const f of walk(d)) {
    if (path.basename(f) === "check-agency-disclosure.mjs") continue;
    const txt = readFileSync(f, "utf8");
    for (const re of banned) if (re.test(txt)) failures.push(`${path.relative(root, f)} contains banned wording ${re}`);
  }
}
if (failures.length) {
  console.error("check:agency-disclosure FAILED");
  for (const f of failures) console.error(" - " + f);
  process.exit(1);
}
console.log("check:agency-disclosure ok");
