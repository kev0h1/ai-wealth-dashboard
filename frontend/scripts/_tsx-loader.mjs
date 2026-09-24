// ESM loader that makes this repo's .ts/.tsx COMPONENT modules importable by
// the plain-Node test runner (G148, 2026-09-23).
//
// Why it exists: scripts/_ts-extensionless-loader.mjs plus Node's
// --experimental-strip-types covers plain .ts, but type-stripping cannot
// handle JSX, so every .tsx component was unreachable from a test. That is a
// large part of how the G148 defect survived: the branch that decided the
// spend-from rail rendered nothing lived inside components/SafeToSpendCard.tsx
// and nothing could call it.
//
// What it does, and deliberately no more:
//   - resolves "@/..." against the frontend root (tsconfig.json's own path
//     alias) and extensionless relative specifiers;
//   - transpiles .ts/.tsx with the TypeScript compiler already in
//     node_modules, using the automatic JSX runtime and THIS PROJECT'S OWN
//     compiler target, so a component renders through react-dom/server the
//     way it would on a Next server pass.
// Everything else (node_modules, data: URLs) falls through to Node's own
// resolver untouched.
//
// A test harness that resolves or compiles differently from the production
// bundler is a harness that can lie, so the two places this could drift are
// pinned rather than guessed: the extension preference order matches Next's,
// and the compiler target is READ from tsconfig.json instead of being
// restated here.
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Next resolves .tsx BEFORE .ts. No same-stem pair (foo.ts next to foo.tsx)
// exists in this repo today, so the order is latent rather than live, but on
// the day one appears a different order would have the test import a
// different module than production ships — the harness-lies failure this
// whole file exists to avoid.
const EXTS = [".tsx", ".ts", ".jsx", ".js", ".mjs"];

// Read the project's real compiler options rather than restating them.
// `target` in particular flips the `useDefineForClassFields` default, which
// changes class-field initialisation semantics; this repo targets ES2017,
// and a hardcoded ES2022 here would compile class fields differently from
// the shipped bundle.
const COMPILER_TARGET = (() => {
  try {
    const configPath = path.join(frontendRoot, "tsconfig.json");
    const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
    if (error || !config) return ts.ScriptTarget.ES2017;
    const parsed = ts.parseJsonConfigFileContent(config, ts.sys, frontendRoot);
    return parsed.options?.target ?? ts.ScriptTarget.ES2017;
  } catch {
    return ts.ScriptTarget.ES2017;
  }
})();

function tryFiles(base) {
  if (existsSync(base) && !statSync(base).isDirectory()) return base;
  for (const ext of EXTS) if (existsSync(base + ext)) return base + ext;
  for (const ext of EXTS) if (existsSync(path.join(base, "index" + ext))) return path.join(base, "index" + ext);
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const hit = tryFiles(path.join(frontendRoot, specifier.slice(2)));
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
  }
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const hit = tryFiles(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier));
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
  }
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    // `next` ships no "exports" field at all, so subpaths like
    // next/navigation are plain files Node's ESM resolver will not take
    // bare; Node's own error suggests the ".js" form. This cannot smuggle
    // past a package that DOES declare "exports": that raises
    // ERR_PACKAGE_PATH_NOT_EXPORTED, which is not caught here.
    if (err?.code === "ERR_MODULE_NOT_FOUND" && !specifier.startsWith(".") && !specifier.endsWith(".js")) {
      try {
        return await nextResolve(specifier + ".js", context);
      } catch {
        // Re-throw the ORIGINAL. Letting the retry's error escape reports a
        // specifier ("whatever.js") that appears nowhere in the source, which
        // sends the reader looking for a typo they did not make.
        throw err;
      }
    }
    throw err;
  }
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && /\.tsx?$/.test(url)) {
    const filename = fileURLToPath(url);
    const { outputText, diagnostics } = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: {
        target: COMPILER_TARGET,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
      },
      reportDiagnostics: true,
      fileName: filename,
    });
    // transpileModule discards diagnostics by default. What it reports is
    // SYNTACTIC only (verified: a `const enum` or a bare type re-export
    // yields nothing here, because isolated-modules semantic checks need a
    // full Program, which a loader has no business building — `tsc --noEmit`
    // in the gate is what covers those). Surfacing the syntactic ones is
    // still worth it: without this, a malformed file reaches Node as garbage
    // emitted JS and fails with a parser error pointing at the wrong thing,
    // instead of naming the file that could not be compiled.
    if (diagnostics?.length) {
      const text = diagnostics
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "))
        .join("; ");
      throw new Error(`_tsx-loader: TypeScript could not transpile ${filename}: ${text}`);
    }
    return { format: "module", source: outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
