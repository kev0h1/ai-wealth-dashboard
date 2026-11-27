#!/usr/bin/env node
// G484: Lucide is not part of Sorted's icon system. This guard keeps it out
// of shipped and checked source, including type-only imports and a bounded
// set of direct CommonJS aliases. It deliberately uses TypeScript's parser
// rather than text matching so comments, prose and source-string fixtures
// cannot trip it.
//
// This is source hygiene, not an arbitrary-obfuscation security boundary:
// only direct const aliases of require/module.require and createRequire
// imported from node:module or module are followed. Computed module names,
// reassigned values and arbitrary runtime data flow stay outside its scope.
//
// Usage: node scripts/check-no-lucide-imports.mjs   (from frontend/)

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);

// Build products, third-party packages, static assets and private QA
// scratchpads are not frontend source. Everything else is scanned, including
// app/, components/, lib/, remotion/ and scripts/.
const SKIP_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".qa",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "public",
]);

function isLucideSpecifier(value) {
  return value === "lucide-react" || value.startsWith("lucide-react/");
}

function staticString(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;
}

function importTypeSpecifier(node) {
  return ts.isLiteralTypeNode(node.argument) ? staticString(node.argument.literal) : null;
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function scriptKindFor(file) {
  switch (path.extname(file)) {
    case ".tsx": return ts.ScriptKind.TSX;
    case ".jsx": return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs": return ts.ScriptKind.JS;
    default: return ts.ScriptKind.TS;
  }
}

function importedCreateRequireNames(sourceFile) {
  const names = new Set();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const moduleSpecifier = statement.moduleSpecifier ? staticString(statement.moduleSpecifier) : null;
    if (moduleSpecifier !== "node:module" && moduleSpecifier !== "module") continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const imported of bindings.elements) {
      const importedName = imported.propertyName?.text ?? imported.name.text;
      if (importedName === "createRequire") names.add(imported.name.text);
    }
  }
  return names;
}

function isConstDeclaration(node) {
  return ts.isVariableDeclarationList(node.parent)
    && (node.parent.flags & ts.NodeFlags.Const) !== 0;
}

function findSourceViolations(file, source) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(file),
  );
  const findings = [];
  const requireAliases = new Set(["require"]);
  const createRequireFactories = importedCreateRequireNames(sourceFile);

  const report = (node, specifier) => {
    if (specifier && isLucideSpecifier(specifier)) {
      findings.push({ line: lineOf(sourceFile, node), specifier });
    }
  };

  const isRequireReference = (node) => (
    ts.isIdentifier(node) && requireAliases.has(node.text)
  ) || (
    ts.isPropertyAccessExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "module"
      && node.name.text === "require"
  );

  const isCreateRequireFactory = (node) => (
    ts.isIdentifier(node) && createRequireFactories.has(node.text)
  );

  const isCreateRequireCall = (node) => (
    ts.isCallExpression(node) && isCreateRequireFactory(node.expression)
  );

  const trackConstAlias = (node) => {
    if (!ts.isVariableDeclaration(node) || !isConstDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer) return;
    if (isRequireReference(node.initializer) || isCreateRequireCall(node.initializer)) {
      requireAliases.add(node.name.text);
    } else if (isCreateRequireFactory(node.initializer)) {
      createRequireFactories.add(node.name.text);
    }
  };

  const visit = (node) => {
    trackConstAlias(node);
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      report(node, node.moduleSpecifier ? staticString(node.moduleSpecifier) : null);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      report(node, node.moduleReference.expression ? staticString(node.moduleReference.expression) : null);
    } else if (ts.isImportTypeNode(node)) {
      report(node, importTypeSpecifier(node));
    } else if (ts.isCallExpression(node)) {
      const argument = node.arguments[0];
      const specifier = argument ? staticString(argument) : null;
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = isRequireReference(node.expression) || isCreateRequireCall(node.expression);
      if (isDynamicImport || isRequire) report(node, specifier);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return findings;
}

function* sourceFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKIP_DIRECTORIES.has(entry.name) || entry.name.startsWith(".qa-") || entry.isSymbolicLink()) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* sourceFiles(full);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      yield full;
    }
  }
}

function packageViolations() {
  const file = path.join(root, "package.json");
  const source = readFileSync(file, "utf8");
  JSON.parse(source);
  const sourceFile = ts.parseJsonText(file, source);
  const packageObject = sourceFile.statements[0]?.expression;
  const findings = [];

  if (!packageObject || !ts.isObjectLiteralExpression(packageObject)) {
    throw new Error("package.json must contain a JSON object");
  }
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const section = packageObject.properties.find(
      (property) => ts.isPropertyAssignment(property) && staticString(property.name) === field,
    );
    if (!section || !ts.isPropertyAssignment(section) || !ts.isObjectLiteralExpression(section.initializer)) continue;
    for (const dependency of section.initializer.properties) {
      if (ts.isPropertyAssignment(dependency) && staticString(dependency.name) === "lucide-react") {
        findings.push(`package.json:${lineOf(sourceFile, dependency.name)}: ${field} must not include lucide-react`);
      }
    }
  }
  return findings;
}

function main() {
  const failures = packageViolations();
  for (const file of sourceFiles(root)) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    for (const finding of findSourceViolations(file, readFileSync(file, "utf8"))) {
      failures.push(`${relative}:${finding.line}: lucide-react import is not allowed (${finding.specifier})`);
    }
  }

  if (failures.length > 0) {
    console.error(`lucide-react must not be used:\n${failures.join("\n")}`);
    process.exitCode = 1;
    return;
  }
  console.log("check:no-lucide-imports ok");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

export { findSourceViolations, isLucideSpecifier };
