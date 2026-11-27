// C50: the reviewer-only demo form needs a deliberate, accessible reveal on
// every platform, with a documented web shortcut. Neither route authorises a
// demo login: the existing server feature gate still decides that.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasDemoRevealQuery, DEMO_REVEAL_ACTIVATIONS } from "../components/LoginScreen.tsx";

assert.equal(DEMO_REVEAL_ACTIVATIONS, 5, "five logo activations are required");
assert.equal(hasDemoRevealQuery("?demo=1"), true, "web reviewer shortcut is exact");
assert.equal(hasDemoRevealQuery("?demo=true"), false, "near-miss query does not reveal it");
assert.equal(hasDemoRevealQuery("?demo=1&other=value"), true);
assert.equal(hasDemoRevealQuery(""), false);

const login = readFileSync(new URL("../components/LoginScreen.tsx", import.meta.url), "utf8");
const demo = readFileSync(new URL("../components/DemoSignIn.tsx", import.meta.url), "utf8");
const reviewNotes = readFileSync(new URL("../../docs/ops/APP_REVIEW_DEMO.md", import.meta.url), "utf8");

assert.match(login, /aria-label="Sorted logo"/, "the invisible logo activation is named");
assert.match(login, /min-h-\[44px\].*min-w-\[44px\]/, "logo target remains at least 44px");
assert.match(login, /h-16 w-16.*shadow-lg mb-5 overflow-hidden/, "logo keeps its original dimensions and treatment");
assert.match(login, /Math\.min\(count \+ 1, DEMO_REVEAL_ACTIVATIONS\)/, "activation count cannot exceed the reveal threshold");
assert.match(login, /!isNativePlatform\(\).*hasDemoRevealQuery\(window\.location\.search\)/s, "only web has the URL shortcut");
assert.match(login, /<DemoSignIn onSignedIn=\{demoEstablish\} revealed=\{demoRevealed\}/, "the existing sign-in flow stays intact after reveal");
assert.match(demo, /if \(!revealed\) return null/, "the demo UI stays hidden until revealed");
assert.match(demo, /resolveDemoEnabled\(/, "the existing backend enabled check remains in place");
assert.match(demo, /demoLogin\(email, password\)/, "the existing credential path remains in place");
assert.match(reviewNotes, /activate the Sorted logo at the top five times/, "store-review notes disclose the native path");
assert.match(reviewNotes, /\/login\?demo=1/, "store-review notes disclose the web path");
assert.doesNotMatch("Sorted logo", /—/, "new rendered accessible copy has no em dash");
assert.doesNotMatch(reviewNotes, /—/, "reviewer instructions have no em dash");
console.log("c50-reviewer-demo-reveal: ok");
