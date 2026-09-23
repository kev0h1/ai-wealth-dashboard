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
//     alias) and extensionless relative specifiers to .ts/.tsx/.js;
//   - transpiles .ts/.tsx with the TypeScript compiler already in
//     node_modules, using the automatic JSX runtime, so a component renders
//     through react-dom/server exactly as it would on a Next server pass.
// Everything else (node_modules, data: URLs) falls through to Node's own
// resolver untouched.
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTS = [".ts", ".tsx", ".mjs", ".js", ".jsx"];

function tryFiles(base) {
  const { existsSync } = require("node:fs");
  if (existsSync(base) && !require("node:fs").statSync(base).isDirectory()) return base;
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
    // Next ships some subpaths (next/navigation, next/link) without an
    // "exports" entry that Node's ESM resolver accepts bare. Node itself
    // suggests the ".js" form in its error, so take it.
    if (err?.code === "ERR_MODULE_NOT_FOUND" && !specifier.startsWith(".") && !specifier.endsWith(".js")) {
      return nextResolve(specifier + ".js", context);
    }
    throw err;
  }
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && /\.tsx?$/.test(url)) {
    const filename = fileURLToPath(url);
    const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
      },
      fileName: filename,
    });
    return { format: "module", source: outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
