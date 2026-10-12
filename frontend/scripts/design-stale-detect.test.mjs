// H114: the importer detection behind check:design-stale. Real imports of a
// preview in any form count; comments and plain file reads are mentions only.
import assert from "node:assert/strict";
import { isImportOf, isReadBy } from "./_design-preview-data.mjs";

const slug = "demo-slug";
assert.equal(isImportOf(`import x from "../app/design/${slug}/fixtures";`, slug), true, "relative static import");
assert.equal(isImportOf(`import { y } from "@/app/design/${slug}/fixtures";`, slug), true, "alias static import");
assert.equal(isImportOf(`const m = await import("../app/design/${slug}/x.tsx");`, slug), true, "dynamic import");
assert.equal(isImportOf(`const m = require("../app/design/${slug}/x");`, slug), true, "require");
assert.equal(isImportOf(`import "../app/design/${slug}/side-effect";`, slug), true, "bare import");
assert.equal(isImportOf(`// see app/design/${slug}/x for the old copy, from the round\n/* from design/${slug} */`, slug), false, "comment-only mention");
assert.equal(isImportOf(`const s = readFileSync(new URL("../app/design/${slug}/X.tsx", import.meta.url), "utf8");`, slug), false, "a file read is a mention, not an import");
assert.equal(isImportOf(`import x from "../app/design/${slug}-other/x";`, slug), false, "a longer slug is a different preview");
assert.equal(isReadBy(`const p = readFileSync(new URL("../app/design/${slug}/X.tsx", import.meta.url), "utf8");`, slug), true, "readFileSync + new URL");
assert.equal(isReadBy(`const a = await fs.promises.readFile(path.join(root, "app/design/${slug}/fixtures.ts"), "utf8");`, slug), true, "fs.promises.readFile");
assert.equal(isReadBy(`const c = read("../app/design/${slug}/Client.tsx");`, slug), true, "local read helper");
assert.equal(isReadBy(`// readFileSync("../app/design/${slug}/x") was the old way\nimport x from "../app/design/${slug}/fixtures.ts";`, slug), false, "comment and import are not reads");
// H116: the real forms check-signin-handoff.mjs uses, plus joined and variable paths.
assert.equal(isReadBy(`const page = read("frontend", "app", "design", "${slug}", "page.tsx");`, slug), true, "segmented read() args (check-signin-handoff.mjs)");
assert.equal(isReadBy(`const c = readFileSync(path.join(root, "frontend", "app", "design", "${slug}", "C.tsx"), "utf8");`, slug), true, "path.join segments inside readFileSync");
assert.equal(isReadBy(`const c = readFileSync(path.resolve(ROOT, "app/design/${slug}", "C.tsx"), "utf8");`, slug), true, "path.resolve with a joined design/slug segment");
assert.equal(isReadBy(`const P = path.join(ROOT, "app", "design", "${slug}", "page.tsx");\nconst t = readFileSync(P, "utf8");`, slug), true, "constant path later read");
assert.equal(isReadBy(`const P = "../app/design/${slug}/page.tsx";\nconst t = fs.readFileSync(new URL(P, import.meta.url), "utf8");`, slug), true, "quoted constant later read via new URL");
assert.equal(isReadBy(`const U = new URL("../app/design/${slug}/page.tsx", import.meta.url);\nconst t = readFileSync(U, "utf8");`, slug), true, "new URL constant later read");
assert.equal(isReadBy(`const P = path.join(ROOT, "app", "design", "${slug}", "page.tsx");\nconsole.log(P);`, slug), false, "constant never read");
assert.equal(isReadBy(`// read("frontend", "app", "design", "${slug}", "page.tsx")\n/* const P = "app/design/${slug}/x"; readFileSync(P) */`, slug), false, "comment-only mention");
assert.equal(isReadBy(`const c = read("frontend", "app", "design", "${slug}-other", "page.tsx");`, slug), false, "a longer slug is a different preview");
console.log("check:design-stale-detect OK");
