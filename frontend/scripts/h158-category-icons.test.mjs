// H158: shared/category-icons.json is the source of truth (the frontend imports
// it); the backend image only contains backend/, so it ships a committed copy.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shared = readFileSync(new URL("../../shared/category-icons.json", import.meta.url), "utf8");
const backend = readFileSync(new URL("../../backend/app/data/category-icons.json", import.meta.url), "utf8");
assert.equal(
  backend,
  shared,
  "backend/app/data/category-icons.json differs from shared/category-icons.json: copy shared over it",
);
console.log("h158 category icon manifest copies match");
