#!/usr/bin/env node
// Unit test for lib/legalContent.ts's stripMcpSections (A17). No test
// framework is set up in this project (see scripts/check-design-index.mjs,
// scripts/build-mobile-guard.test.sh for the same "plain node/bash script,
// no deps" convention). This imports the real .ts module directly (Node
// 22's built-in type stripping, no build step) and the real
// content/privacy.md and content/terms.md, rather than a synthetic fixture,
// so a change to either file that breaks the marker/renumbering contract
// fails this test immediately.
//
// Usage: node scripts/legal-content.test.mjs   (from frontend/)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripMcpSections } from "../lib/legalContent.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");

let fail = 0;
function check(label, condition) {
  if (condition) {
    console.log(`PASS: ${label}`);
  } else {
    console.log(`FAIL: ${label}`);
    fail = 1;
  }
}

const privacy = readFileSync(path.join(frontendRoot, "content/privacy.md"), "utf-8");
const terms = readFileSync(path.join(frontendRoot, "content/terms.md"), "utf-8");

// ── enabled: byte-identical to the source minus the marker comment lines ──

function withoutMarkerLines(markdown) {
  return markdown.replace(/^(?:<!-- mcp-connector:start -->|<!-- mcp-connector:end -->)\n?/gm, "");
}

check(
  "privacy.md enabled output is byte-identical to the file minus marker lines",
  stripMcpSections(privacy, true) === withoutMarkerLines(privacy)
);
check(
  "terms.md enabled output is byte-identical to the file minus marker lines",
  stripMcpSections(terms, true) === withoutMarkerLines(terms)
);
check(
  "privacy.md enabled output still contains the AI assistants section",
  stripMcpSections(privacy, true).includes("## 6. AI assistants you connect")
);
check(
  "terms.md enabled output still contains the Connecting an AI assistant subsection",
  stripMcpSections(terms, true).includes("### Connecting an AI assistant")
);

// ── disabled (production default): connector content gone, headings and
//    cross-references renumbered with no gap ──────────────────────────────

const privacyOff = stripMcpSections(privacy, false);
const termsOff = stripMcpSections(terms, false);

check(
  "privacy.md disabled output has no AI-assistants-you-connect section",
  !privacyOff.includes("AI assistants you connect")
);
check(
  "privacy.md disabled output drops the recipients note naming the connector",
  !privacyOff.includes("If you connect an AI assistant")
);
check(
  "terms.md disabled output has no Connecting an AI assistant subsection",
  !termsOff.includes("Connecting an AI assistant")
);

const privacyHeadings = [...privacyOff.matchAll(/^## (\d+)\./gm)].map((m) => Number(m[1]));
check(
  "privacy.md disabled output headings run 1 to 15 consecutively",
  privacyHeadings.join(",") === Array.from({ length: 15 }, (_, i) => i + 1).join(",")
);
check(
  "privacy.md disabled output has no dangling 'Section 16' reference",
  !/\bSection 16\b/.test(privacyOff)
);
check(
  'privacy.md disabled output renumbers "Section 4 and Section 10" (open banking / delete-your-data) to "Section 4 and Section 9"',
  privacyOff.includes("Section 4 and Section 9")
);
check(
  'privacy.md disabled output renumbers the retention cross-reference "Section 9" (AI processing) to "Section 8"',
  / short period \(see Section 8\)/.test(privacyOff)
);
check(
  'privacy.md disabled output renumbers "Section 5 and Section 7" (international transfers) to "Section 5 and Section 6"',
  privacyOff.includes("Section 5 and Section 6")
);
check(
  'privacy.md disabled output renumbers the delete-your-data retention cross-reference to "Section 8"',
  / retention periods in Section 8\b/.test(privacyOff)
);
check(
  'privacy.md disabled output renumbers "see Section 16" (complain to the ICO) to "see Section 15"',
  privacyOff.includes("see Section 15")
);
check(
  'privacy.md disabled output final heading is "## 15. How to contact us and how to complain"',
  privacyOff.includes("## 15. How to contact us and how to complain")
);
check(
  "privacy.md disabled output has no Connector audit log retention row",
  !privacyOff.includes("Connector audit log")
);
check(
  "privacy.md disabled output has no mention of \"connector\" at all (production, A17 connector-off)",
  !/connector/i.test(privacyOff)
);

const termsHeadings = [...termsOff.matchAll(/^## (\d+)\./gm)].map((m) => Number(m[1]));
check(
  "terms.md disabled output headings are unchanged (the connector content is an unnumbered subsection)",
  termsHeadings.join(",") === Array.from({ length: 18 }, (_, i) => i + 1).join(",")
);
check(
  "terms.md disabled output keeps section 6 as Important: information, not financial advice",
  termsOff.includes("## 6. Important: information, not financial advice")
);

process.exit(fail);
