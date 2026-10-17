// G281: an action link has exactly one chevron affordance, the icon. The server
// sends labels with no glyph; no JSX element may pair a ChevronRight with a
// text chevron/arrow glyph.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import PlanningCheckpointTimeline from "../components/PlanningCheckpointTimeline.tsx";
import ActionLabel from "../components/ActionLabel.tsx";
import { AskGenericCard } from "../components/HomeBrief.tsx";

const GLYPH = /[›»→]|&rsaquo;|&gt;|\\u203a/;
const root = new URL("..", import.meta.url).pathname;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", "design"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const offenders = [];
for (const dir of ["components", "app"]) {
  for (const file of walk(join(root, dir))) {
    const src = readFileSync(file, "utf8");
    if (!src.includes("ChevronRight") && !src.includes("ActionLabel")) continue;
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node) => {
      if (ts.isJsxElement(node)) {
        const kids = node.children;
        const hasIcon = kids.some((k) => (ts.isJsxSelfClosingElement(k) && /^(ChevronRight|ActionLabel)$/.test(k.tagName.getText())) ||
          (ts.isJsxElement(k) && /^ActionLabel$/.test(k.openingElement.tagName.getText())));
        if (hasIcon) {
          for (const k of kids) {
            const text = ts.isJsxText(k) ? k.getText()
              : ts.isJsxExpression(k) && k.expression && ts.isStringLiteralLike(k.expression) ? k.expression.text : "";
            if (GLYPH.test(text)) offenders.push(`${file.replace(root, "")}:${sf.getLineAndCharacterOfPosition(k.getStart()).line + 1} ${text.trim()}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
}
assert.deepEqual(offenders, [], "text glyph beside a chevron icon:\n" + offenders.join("\n"));

const chevrons = (html) => (html.match(/lucide-chevron-right/g) ?? []).length;
const noGlyph = (html) => assert.ok(!GLYPH.test(html.replace(/<[^>]*>/g, "")), "no text glyph in " + html);

// ActionLabel: one icon, aria-hidden, label unchanged.
const al = renderToStaticMarkup(React.createElement(ActionLabel, null, "See your tax levers"));
assert.equal(chevrons(al), 1);
assert.match(al, /aria-hidden="true"/);
noGlyph(al);

// Planning ladder row with a glyph-free server label: exactly one chevron on the link.
const step = { key: "tax", title: "Use your tax levers", state: "active", detail: "Detail", options: [], link: { label: "See your tax levers", route: "/tax" } };
const ladder = renderToStaticMarkup(React.createElement(PlanningCheckpointTimeline, { steps: [step], hideValues: false }));
assert.match(ladder, /See your tax levers/);
const linkHtml = ladder.slice(ladder.indexOf('href="/tax"'));
assert.equal(chevrons(linkHtml.slice(0, linkHtml.indexOf("</a>"))), 1, "Planning ladder link has one chevron");
noGlyph(linkHtml.slice(0, linkHtml.indexOf("</a>")));

// HomeBrief action rendering with a glyph-free label.
const item = { id: "ask:test", kind: "ask", headline: "Headline", body: "Body", action: { label: "See what's due", route: "/upcoming" } };
const brief = renderToStaticMarkup(React.createElement(AskGenericCard, { item, router: { push() {} }, maskAmounts: (s) => s, dismissible: false }));
const btn = brief.slice(brief.indexOf("See what"), brief.indexOf("</button>", brief.indexOf("See what")));
assert.equal(chevrons(btn), 1, "HomeBrief action has one chevron");
noGlyph(brief);

console.log("g281 no-double-chevron: ok");
