// C43: the Demo sign-in form renders only when the backend says it is enabled,
// is labelled for password managers and screen readers, and follows the copy
// rules (British English, no em dashes, no exclamation marks).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DemoSignInView } from "../components/DemoSignIn.tsx";
import { DEMO_FAILED_MESSAGE, DEMO_LIMITED_MESSAGE, DEMO_UNREACHABLE_MESSAGE } from "../lib/demoLogin.ts";

const base = {
  enabled: true, open: false, email: "", password: "", busy: false, message: null,
  onToggle() {}, onEmail() {}, onPassword() {}, onSubmit() {},
};
const render = (props) => renderToStaticMarkup(React.createElement(DemoSignInView, { ...base, ...props }));

assert.equal(render({ enabled: false, open: true }), "", "flag off renders nothing at all");

const closed = render({});
assert.match(closed, />Demo sign-in</);
assert.match(closed, /aria-expanded="false"/);
assert.doesNotMatch(closed, /<input/, "fields stay hidden until the link is opened");

const open = render({ open: true, email: "a@b.co", password: "x", message: DEMO_FAILED_MESSAGE });
assert.match(open, /aria-expanded="true"/);
assert.match(open, /autoComplete="username"|autocomplete="username"/i);
assert.match(open, /autoComplete="current-password"|autocomplete="current-password"/i);
assert.match(open, /<label[^>]*for="demo-email"[^>]*>Email<\/label>/);
assert.match(open, /<label[^>]*for="demo-password"[^>]*>Password<\/label>/);
assert.match(open, /type="password"/);
assert.match(open, /role="alert"/, "errors are announced");
assert.match(open, /Those details didn&#x27;t work\./);
assert.match(open, />Sign in</);

// The regulatory text and the Google and Apple buttons are untouched by this item.
const login = readFileSync(new URL("../components/LoginScreen.tsx", import.meta.url), "utf8");
assert.ok(login.includes("{TRADING_NAME_DISCLOSURE} {AGENT_DISCLOSURE}"), "regulatory text unchanged");
assert.ok(login.indexOf("{signInButtons}\n              <DemoSignIn") > 0, "demo link sits directly below the sign-in buttons");

// Copy rules over every user-facing string this item added.
const sources = ["../components/DemoSignIn.tsx", "../lib/demoLogin.ts"].map((f) => readFileSync(new URL(f, import.meta.url), "utf8"));
const strings = [DEMO_FAILED_MESSAGE, DEMO_LIMITED_MESSAGE, DEMO_UNREACHABLE_MESSAGE, "Demo sign-in", "Email", "Password", "Sign in", "Signing in"];
for (const s of strings) {
  assert.doesNotMatch(s, /[—–]/, `no em or en dash: ${s}`);
  assert.doesNotMatch(s, /!/, `no exclamation mark: ${s}`);
}
for (const src of sources) assert.doesNotMatch(src, /[—]/, "no em dash anywhere in the source");
console.log("c43-demo-signin: ok");
