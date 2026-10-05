#!/usr/bin/env node
// A142: render a legal markdown file to a standalone, plainly styled HTML
// file through the same LegalDocument component the site uses (so GFM-style
// pipe tables work). Used by export-legal-pdfs.sh for the repo-root
// TERMS/PRIVACY/SECURITY PDFs. Full text: connector marker comments are
// removed and the connector sections are kept (the root .md files are the
// canonical full copies).
//
// Run with: node --no-warnings --experimental-loader ./scripts/_tsx-loader.mjs \
//   scripts/render-legal-html.mjs <in.md> <out.html>
import { readFileSync, writeFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LegalDocument from "../components/LegalDocument.tsx";
import { stripMcpSections } from "../lib/legalContent.ts";

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) {
  console.error("usage: render-legal-html.mjs <in.md> <out.html>");
  process.exit(2);
}
const markdown = stripMcpSections(readFileSync(inPath, "utf-8"), true);
const body = renderToStaticMarkup(createElement(LegalDocument, { markdown, otherDocHref: "", otherDocLabel: "" }));
const css = `
body{font-family:Helvetica,Arial,sans-serif;color:#111;background:#fff;line-height:1.45;font-size:11pt;margin:0 auto;max-width:760px}
h1{font-size:20pt}h2{font-size:15pt;margin-top:1.4em}h3{font-size:12.5pt}
table{border-collapse:collapse;width:100%;font-size:9.5pt}th,td{border:1px solid #bbb;padding:4px 6px;text-align:left;vertical-align:top}
code,pre{font-size:9pt;word-break:break-word;white-space:pre-wrap}a{color:#111}
`;
writeFileSync(outPath, `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${inPath}</title><style>${css}</style></head><body>${body}</body></html>`);
