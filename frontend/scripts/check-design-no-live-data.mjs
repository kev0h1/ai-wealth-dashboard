#!/usr/bin/env node
// A26: /design/* ships to production auth-exempt (AuthProvider.tsx lets any
// path starting with "/design" through with no session check at all, "static
// mockups with zero user data — always public"). That's only safe as long as
// no file under app/design actually calls a real API, reads real cookies, or
// runs on the server with access to anything a signed-in session could see.
// This is a standing regression guard, not a one-off audit: /design grows a
// new preview directory most sessions, and nothing else stops one of them
// from quietly wiring up a real fetch. It uses the installed TypeScript parser
// so comments and type-only imports are not mistaken for runtime code.
//
// Usage: node scripts/check-design-no-live-data.mjs   (from frontend/)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");
const defaultDesignDir = path.join(frontendRoot, "app", "design");
const apiModulePath = path.join(frontendRoot, "lib", "api");

function isApiModule(specifier, sourceFile) {
  const withoutExtension = specifier.replace(/\.(tsx?|jsx?)$/, "");
  if (withoutExtension === "@/lib/api" || withoutExtension === "@/lib/api/index") return true;
  if (!specifier.startsWith(".")) return false;
  const resolved = path.resolve(path.dirname(sourceFile.fileName), withoutExtension);
  return resolved === apiModulePath || resolved === path.join(apiModulePath, "index");
}

function importHasRuntimeValue(importClause) {
  if (!importClause) return true;
  if (importClause.isTypeOnly) return false;
  if (importClause.name || importClause.namedBindings?.kind === ts.SyntaxKind.NamespaceImport) return true;
  if (!importClause.namedBindings) return false;
  return importClause.namedBindings.elements.some((element) => !element.isTypeOnly);
}

function exportHasRuntimeValue(exportDeclaration) {
  if (exportDeclaration.isTypeOnly) return false;
  if (!exportDeclaration.exportClause) return true;
  if (ts.isNamespaceExport(exportDeclaration.exportClause)) return true;
  return exportDeclaration.exportClause.elements.some((element) => !element.isTypeOnly);
}

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listFiles(full));
    } else if (/\.(tsx|ts)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function inspectFile(file) {
  const source = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const violations = [];
  const report = (why) => violations.push(why);

  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && isApiModule(node.moduleSpecifier.text, sourceFile) && importHasRuntimeValue(node.importClause)) {
      report("imports the real API module at runtime");
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && isApiModule(node.moduleSpecifier.text, sourceFile) && exportHasRuntimeValue(node)) {
      report("re-exports the real API module at runtime");
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression) && isApiModule(node.moduleReference.expression.text, sourceFile)) {
      report("loads the real API module with require()");
    }
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === "fetch") report("calls fetch() directly");
      if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && ["globalThis", "window"].includes(node.expression.expression.text) && node.expression.name.text === "fetch") {
        report(`calls ${node.expression.expression.text}.fetch() directly`);
      }
      if (ts.isIdentifier(node.expression) && node.expression.text === "cookies") report("reads cookies() directly");
      if (ts.isIdentifier(node.expression) && node.expression.text === "require" && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && isApiModule(node.arguments[0].text, sourceFile)) {
        report("loads the real API module with require()");
      }
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && isApiModule(node.arguments[0].text, sourceFile)) {
        report("loads the real API module dynamically");
      }
    }
    if (ts.isIdentifier(node) && node.text === "useSWR") report("uses useSWR (implies a real data fetch)");
    if (ts.isIdentifier(node) && node.text === "axios") report("uses axios");
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "next/headers") report("imports next/headers (server-side cookies/headers access)");
    if (ts.isStringLiteral(node) && node.text === "use server") report("declares a server action");
    if (ts.isIdentifier(node) && node.text === "getServerSideProps") report("defines getServerSideProps");
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return [...new Set(violations)];
}

export function scanDesignDirectory(designDir) {
  return listFiles(designDir).flatMap((file) => inspectFile(file).map((why) => ({ file, why })));
}

function main() {
  const files = listFiles(defaultDesignDir);
  const violations = scanDesignDirectory(defaultDesignDir);
  if (violations.length === 0) {
    console.log(`check:design-no-live-data OK (${files.length} files under app/design, static fixtures only)`);
    return 0;
  }
  console.error("Files under app/design that could reach real user data (this ships auth-exempt, see AuthProvider.tsx):");
  for (const violation of violations) console.error(`  - ${path.relative(frontendRoot, violation.file)}: ${violation.why}`);
  console.error("\napp/design/* must stay static fixture data only. Move any real data need out of /design.");
  return 1;
}

if (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
