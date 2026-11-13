// G467: the Penny composer placeholder is the fixed line "Ask Penny about your
// money". It is never seeded from a suggestion chip, the at-cap resting line is
// unchanged, and the placeholder stays on one line (nowrap + ellipsis).
// Run: npm run -s check:g467-penny-placeholder
// Optional: G467_CONVERSATION=/path/to/PennyConversation.tsx to test another copy.
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
let failures = 0;
const ok = (label, cond) => { if (!cond) { failures += 1; console.error(`FAIL: ${label}`); } };

const conv = process.env.G467_CONVERSATION ? readFileSync(process.env.G467_CONVERSATION, "utf8") : read("components/PennyConversation.tsx");
const css = process.env.G467_CSS ? readFileSync(process.env.G467_CSS, "utf8") : read("app/globals.css");

ok("DEFAULT_PLACEHOLDER is exactly the fixed line", /const DEFAULT_PLACEHOLDER = "Ask Penny about your money";/.test(conv));
ok("no placeholder state", !/setPlaceholder|useState\(DEFAULT_PLACEHOLDER\)/.test(conv));
ok("no placeholder built from a chip label", !/Ask Penny: \$\{/.test(conv) && !/seeded/.test(conv));
ok("composer receives the fixed line when not capped", /placeholder=\{atCap \? restingPlaceholder : DEFAULT_PLACEHOLDER\}/.test(conv));
ok("restingPlaceholder is unchanged", /const restingPlaceholder = `Penny is resting until \$\{formatPennyResetDate\(usage\.resetsOn\)\}`;/.test(conv));
ok("chips still load from canISuggestions", /api\.canISuggestions\(\)[\s\S]{0,200}setChips\(c\);[\s\S]{0,80}onContextLine\?\.\(s\?\.context_line \?\? null\)/.test(conv));
ok("fixed copy has no em dash or exclamation mark", !/[—!]/.test("Ask Penny about your money"));

const rule = (sel) => {
  const m = css.match(new RegExp(`${sel.replace(/[[\]():]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : "";
};
for (const sel of ["[data-penny-input]:not([data-penny-resting])::placeholder", "[data-penny-input]:not([data-penny-resting]):placeholder-shown"]) {
  const body = rule(sel);
  ok(`${sel} has white-space: nowrap`, /white-space:\s*nowrap/.test(body));
  ok(`${sel} has overflow: hidden`, /overflow:\s*hidden/.test(body));
  ok(`${sel} has text-overflow: ellipsis`, /text-overflow:\s*ellipsis/.test(body));
}

ok("composer marks the at-cap textarea data-penny-resting", /data-penny-resting=\{disabled \? "" : undefined\}/.test(read("components/PennyComposer.tsx")));
ok("no unscoped nowrap placeholder rule", !/\[data-penny-input\](::placeholder|:placeholder-shown)\s*\{/.test(css));

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log("g467-penny-placeholder: ok");
