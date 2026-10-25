// B60: the backend copy of the Finexer disclosure (app/content/regulatory.py)
// must match frontend/lib/regulatoryCopy.ts character for character.
// Run: npm run -s check:b60-regulatory-parity
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AGENT_DISCLOSURE, TRADING_NAME_DISCLOSURE } from "../lib/regulatoryCopy.ts";

const py = readFileSync(new URL("../../backend/app/content/regulatory.py", import.meta.url), "utf8");
const read = (name) => {
  const m = py.match(new RegExp(`^${name} = "([^"\\\\]*)"$`, "m"));
  assert.ok(m, `backend defines ${name} as a plain string literal`);
  return m[1];
};
assert.equal(read("AGENT_DISCLOSURE"), AGENT_DISCLOSURE, "AGENT_DISCLOSURE matches");
assert.equal(read("TRADING_NAME_DISCLOSURE"), TRADING_NAME_DISCLOSURE, "TRADING_NAME_DISCLOSURE matches");
console.log("b60 regulatory parity: both disclosure strings match");
