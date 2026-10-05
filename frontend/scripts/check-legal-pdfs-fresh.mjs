#!/usr/bin/env node
// A142: fail when a legal PDF is stale against its markdown source.
// Reads public/legal-pdf-manifest.json (written by export-legal-pdfs.sh) and:
//   1. fails if the manifest or any listed PDF/source is missing;
//   2. fails if a source's sha256 differs from the manifest (the markdown
//      changed after the PDF was exported: re-run export-legal-pdfs.sh);
//   3. when pdftotext is installed, fails if a published PDF (public/*.pdf)
//      still carries the pre-A109 wording ("maximum of 90 days",
//      "reconfirmed with your bank"), and asserts the post-A109 consent
//      wording (taken from the current markdown) is present in the PDF.
// When pdftotext is absent the text checks are SKIPPED with a loud message.
//
// Usage: node scripts/check-legal-pdfs-fresh.mjs   (from frontend/)
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(frontendRoot, "..");
let failures = 0;
const fail = (m) => { console.log(`FAIL: ${m}`); failures++; };
const pass = (m) => console.log(`PASS: ${m}`);

const manifestPath = path.join(frontendRoot, "public/legal-pdf-manifest.json");
if (!existsSync(manifestPath)) {
  console.log("FAIL: public/legal-pdf-manifest.json is missing; run frontend/scripts/export-legal-pdfs.sh");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

let havePdftotext = true;
try { execFileSync("pdftotext", ["-v"], { stdio: "ignore" }); } catch (e) { havePdftotext = e.code !== "ENOENT"; }
if (!havePdftotext) console.log("SKIP: pdftotext not installed; PDF text checks (old wording, A109 wording) are NOT being run");

const norm = (s) => s.replace(/\s+/g, " ").toLowerCase();
// Post-A109 consent sentences, each asserted to exist in the current source
// first so a reword of the source forces this list to be updated too.
const A109 = {
  "terms.md": "reconfirm your consent periodically",
  "privacy.md": "reconfirm your consent to finexer periodically",
};
const OLD = ["maximum of 90 days", "reconfirmed with your bank"];

for (const e of manifest.entries ?? []) {
  const pdf = path.join(repoRoot, e.pdf);
  const src = path.join(repoRoot, e.source);
  if (!existsSync(src)) { fail(`${e.source} missing`); continue; }
  if (!existsSync(pdf)) { fail(`${e.pdf} missing`); continue; }
  const sha = createHash("sha256").update(readFileSync(src)).digest("hex");
  if (sha !== e.source_sha256) fail(`${e.pdf} is stale: ${e.source} changed since ${e.exported} (re-run frontend/scripts/export-legal-pdfs.sh)`);
  else pass(`${e.pdf} matches ${e.source}`);
  if (!havePdftotext) continue;
  const text = norm(execFileSync("pdftotext", [pdf, "-"], { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 }));
  for (const phrase of OLD) {
    if (text.includes(phrase)) fail(`${e.pdf} still contains old wording "${phrase}"`);
  }
  const key = path.basename(e.source).toLowerCase();
  if (A109[key]) {
    const phrase = A109[key];
    if (!norm(readFileSync(src, "utf-8")).includes(phrase)) fail(`${e.source} no longer contains the A109 wording "${phrase}"; update this check`);
    else if (!text.includes(phrase)) fail(`${e.pdf} lacks the A109 wording "${phrase}"`);
    else pass(`${e.pdf} carries the A109 consent wording`);
  }
}
// Root PDFs must not print the markdown's HTML comments as visible text.
if (havePdftotext) {
  for (const e of manifest.entries ?? []) {
    if (!e.pdf.includes("/") && existsSync(path.join(repoRoot, e.pdf))) {
      const t = execFileSync("pdftotext", [path.join(repoRoot, e.pdf), "-"], { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
      if (t.includes("<!--")) fail(`${e.pdf} prints an HTML comment as visible text`);
      else pass(`${e.pdf} has no visible HTML comment`);
    }
  }
}
process.exit(failures ? 1 : 0);
