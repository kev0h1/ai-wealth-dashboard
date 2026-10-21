// G309: Sign out sits centred between its two dividers, and Delete account has
// the same padding under its divider as Sign out has under its own.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const src = readFileSync(new URL("../app/settings/SettingsPage.tsx", import.meta.url), "utf8");
const wrapperOf = (marker) => {
  const idx = src.indexOf(marker);
  assert.ok(idx > 0, `marker not found: ${marker}`);
  const open = src.lastIndexOf("<div className=\"", idx);
  return src.slice(open + 16, src.indexOf("\"", open + 16));
};
const step = (cls, prefix) => cls.split(/\s+/).find((c) => c.startsWith(prefix));

const signOut = wrapperOf("onClick={() => void logout()}");
const del = wrapperOf("href=\"/settings?section=delete\"");

assert.ok(signOut.includes("border-t") && del.includes("border-t"), "both wrappers keep a top divider");
assert.equal(step(signOut, "pt-"), step(del, "pt-"), "matching divider padding under each divider");
assert.equal(step(del, "mt-"), step(signOut, "pt-")?.replace("pt-", "mt-"), "space below Sign out equals space above it");
assert.ok(/min-h-11/.test(src.slice(src.indexOf("onClick={() => void logout()}"), src.indexOf("Sign out</button>"))), "Sign out keeps 44px target");
console.log("g309-settings-spacing ok");
