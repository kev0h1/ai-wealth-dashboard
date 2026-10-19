// A97: exercise the real config and loader under each deployment target.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const frontend = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const loader = require("./production-design-loader.cjs");
const configSource = fs.readFileSync(path.join(frontend, "next.config.ts"), "utf8");
const compiled = ts.transpileModule(configSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;

// Product imports must not pull a preview back into the production graph.
// Remotion and script-only preview checks are separate build targets.
function previewImports(file, source) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  const isPreview = specifier => {
    const resolved = specifier.startsWith("@/") ? path.join(frontend, specifier.slice(2))
      : specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : "";
    return resolved === path.join(frontend, "app/design") || resolved.startsWith(path.join(frontend, "app/design") + path.sep);
  };
  function visit(node) {
    let specifier;
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
      const bindings = node.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings) || node.importClause.name || bindings.elements.length === 0 || bindings.elements.some(e => !e.isTypeOnly)) specifier = node.moduleSpecifier;
    }
    if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
      if (!node.exportClause || !ts.isNamedExports(node.exportClause) || node.exportClause.elements.length === 0 || node.exportClause.elements.some(e => !e.isTypeOnly)) specifier = node.moduleSpecifier;
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) specifier = node.arguments[0];
    if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) specifier = node.moduleReference.expression;
    if (specifier && ts.isStringLiteralLike(specifier) && isPreview(specifier.text)) found.push(specifier.text);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return found;
}
const sampleFile = path.join(frontend, "components/Example.tsx");
assert.equal(previewImports(sampleFile, 'import Fixture from "@/app/design/demo/Fixture";').length, 1);
assert.equal(previewImports(sampleFile, 'export { Fixture } from "../app/design/demo/Fixture";').length, 1);
assert.equal(previewImports(sampleFile, 'const load = () => import("@/app/design/demo/Fixture");').length, 1);
assert.equal(previewImports(sampleFile, 'import type { Fixture } from "@/app/design/demo/Fixture";').length, 0);
assert.equal(previewImports(sampleFile, 'import { Fixture } from "@/components/Fixture";').length, 0);
function scanProduct(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (file === path.join(frontend, "app/design")) continue;
    if (entry.isDirectory()) scanProduct(file);
    else if (/\.[jt]sx?$/.test(file)) assert.deepEqual(previewImports(file, fs.readFileSync(file, "utf8")), [], `${file}: move shared preview code into components or lib`);
  }
}
for (const dir of ["app", "components", "lib"]) scanProduct(path.join(frontend, dir));
scanProduct(path.join(frontend, "../shared/src"));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "a97-config-"));
try {
  const configFile = path.join(tmp, "next.config.cjs");
  fs.writeFileSync(configFile, compiled);
  for (const [name, appEnv, vercelEnv, mobile, blocked] of [
    ["production web", "production", "", "", true],
    ["production mobile", "production", "", "1", true],
    ["Vercel production", "", "production", "", true],
    ["Vercel production with conflicting tag", "uat", "production", "", true],
    ["UAT", "uat", "", "", false],
    ["UAT mobile", "uat", "", "1", false],
    ["Vercel preview", "", "preview", "", false],
    ["local / self-hosted UAT", "", "", "", false],
  ]) {
    const result = JSON.parse(execFileSync(process.execPath, ["-e", `
      const c = require(${JSON.stringify(configFile)}).default;
      const turbo = c.turbopack.rules?.["*"];
      const webpack = c.webpack({ module: { rules: [] } }).module.rules[0];
      const paths = [
        "app/design/page.tsx", "frontend/app/design/ops-board-mobile/page.tsx",
        "worktrees/feature-A97/frontend/app/design/nested/demo/page.jsx",
        "app/design/route.ts", "app/design/new/layout.tsx",
        "app/design/new/loading.tsx", "app/design/new/error.tsx",
        "app/design/new/not-found.tsx", "app/design/new/default.tsx",
        "app/design/new/template.tsx", "app/home/page.tsx",
        "app/design-example/page.tsx", "app/design/fixtures.ts"
      ];
      process.stdout.write(JSON.stringify({
        turbo: paths.map(p => !!turbo?.condition.path.test(p)),
        webpack: paths.map(p => !!webpack?.test.test(p)),
        sameLoader: turbo?.loaders[0] === webpack?.use[0],
        root: c.turbopack.root ?? null
      }));
    `], {
      env: { ...process.env, NODE_ENV: "production", NEXT_PUBLIC_BUILD_TAG: "test", SENTRY_AUTH_TOKEN: "",
        NEXT_PUBLIC_SENTRY_DSN: "", NEXT_PUBLIC_APP_ENV: appEnv, VERCEL_ENV: vercelEnv, MOBILE_EXPORT: mobile },
    }).toString());
    const expected = [...Array(10).fill(blocked), false, false, false];
    assert.deepEqual(result.turbo, expected, `${name}: Turbopack route scope`);
    assert.deepEqual(result.webpack, expected, `${name}: webpack route scope`);
    assert.equal(result.sameLoader, true, `${name}: both compilers use the same loader`);
  }
  const original = '"use client"; import "./private-fixtures"; export default () => "private board prose";';
  const page = loader.call({ resourcePath: "/frontend/app/design/demo/page.tsx" }, original);
  assert.match(page, /notFound\(\)/);
  assert.doesNotMatch(page, /private|use client/);
  const route = loader.call({ resourcePath: "/frontend/app/design/demo/route.ts" }, original);
  assert.match(route, /status: 404/);
  assert.doesNotMatch(route, /private/);
  for (const boundary of ["not-found", "error"]) {
    const source = loader.call({ resourcePath: `/frontend/app/design/${boundary}.tsx` }, original);
    assert.doesNotMatch(source, /notFound\(|private/);
  }
  console.log("design-production OK (deployment targets, route scope, import stripping)");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
