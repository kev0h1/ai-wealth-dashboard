import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helper = "components/Disclosure.tsx";
export function rawSummarySites(text, name) {
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const sites = [];
  function visit(node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === "summary") {
      sites.push(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return sites;
}
export function indicatorOverrides(text, name) {
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const sites = [];
  function visit(node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === "DisclosureChevron") {
      for (const attr of node.attributes.properties) {
        if (!ts.isJsxAttribute(attr)) continue;
        const name = attr.name.getText(source);
        if (["size", "width", "height", "style"].includes(name) || (name === "className" && /\b(?:size-|w-|h-|text-|rotate-|transition-|duration-)/.test(attr.getText(source)))) {
          sites.push(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return sites;
}
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : /\.[jt]sx$/.test(entry.name) ? [path.join(dir, entry.name)] : []);
}
export function check() {
  const failures = [];
  const files = ["app", "components"].flatMap(dir => walk(path.join(root, dir)));
  for (const file of files) {
    const relative = path.relative(root, file);
    if (relative === helper) continue; // the only owner of the actual native element
    const text = readFileSync(file, "utf8");
    for (const line of rawSummarySites(text, file)) failures.push(`${relative}:${line}: use DisclosureSummary so native markers, size and rotation cannot drift`);
    for (const line of indicatorOverrides(text, file)) failures.push(`${relative}:${line}: do not override shared disclosure size, colour or rotation; use inverse on inverted surfaces`);
  }
  const source = readFileSync(path.join(root, helper), "utf8");
  for (const token of ['list-none', 'marker:content-none', '[&::-webkit-details-marker]:hidden', 'size={16}', 'aria-hidden="true"', 'motion-reduce:transition-none']) {
    if (!source.includes(token)) failures.push(`${helper}: shared indicator is missing ${token}`);
  }
  if (rawSummarySites(source, helper).length !== 1) failures.push(`${helper}: must own exactly one native summary`);
  const css = readFileSync(path.join(root, "app/globals.css"), "utf8");
  for (const rule of [".disclosure-summary::-webkit-details-marker { display: none; }", '.disclosure-summary::marker { content: ""; }', "details[open] > .disclosure-summary > .disclosure-chevron { transform: rotate(180deg); }"]) {
    if (!css.includes(rule)) failures.push(`app/globals.css: missing nested-safe disclosure rule ${rule}`);
  }
  return { files: files.length, failures };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = check();
  if (result.failures.length) { console.error(result.failures.join("\n")); process.exitCode = 1; }
  else console.log(`Disclosure consistency: ${result.files} app/component source files checked. All native summaries use the shared indicator.`);
}
