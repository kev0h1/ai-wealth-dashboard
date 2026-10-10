// H114: the importer detection behind check:design-stale. Real imports of a
// preview in any form count; comments and plain file reads are mentions only.
import assert from "node:assert/strict";
import { isImportOf } from "./_design-preview-data.mjs";

const slug = "demo-slug";
assert.equal(isImportOf(`import x from "../app/design/${slug}/fixtures";`, slug), true, "relative static import");
assert.equal(isImportOf(`import { y } from "@/app/design/${slug}/fixtures";`, slug), true, "alias static import");
assert.equal(isImportOf(`const m = await import("../app/design/${slug}/x.tsx");`, slug), true, "dynamic import");
assert.equal(isImportOf(`const m = require("../app/design/${slug}/x");`, slug), true, "require");
assert.equal(isImportOf(`import "../app/design/${slug}/side-effect";`, slug), true, "bare import");
assert.equal(isImportOf(`// see app/design/${slug}/x for the old copy, from the round\n/* from design/${slug} */`, slug), false, "comment-only mention");
assert.equal(isImportOf(`const s = readFileSync(new URL("../app/design/${slug}/X.tsx", import.meta.url), "utf8");`, slug), false, "a file read is a mention, not an import");
assert.equal(isImportOf(`import x from "../app/design/${slug}-other/x";`, slug), false, "a longer slug is a different preview");
console.log("check:design-stale-detect OK");
