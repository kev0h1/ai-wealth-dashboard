// G482: the onboarding name step pre-fills from the sign-in identity, carries
// no founder name, and keeps neutral placeholders.
// Run: npm run -s check:g482-onboarding-name
import { readFileSync } from "node:fs";
import { onboardingPrefill } from "../lib/displayName.ts";

let failures = 0;
function check(label, ok, detail = "") {
  if (!ok) { failures += 1; console.error(`FAIL: ${label} ${detail}`); } else console.log(`PASS: ${label}`);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const src = readFileSync(new URL("../components/Onboarding.tsx", import.meta.url), "utf8");
check("no founder name in Onboarding", !/Kevin|Maingi/i.test(src));
check("first name placeholder is neutral", /placeholder="First name"/.test(src));
check("last name placeholder is neutral", /placeholder="Last name"/.test(src));
check("inputs seed from the identity props", /useState\(defaultFirstName\)/.test(src) && /useState\(defaultLastName\)/.test(src));

check("provider given and family name win",
  eq(onboardingPrefill({ givenName: "Ada", familyName: "Lovelace", sessionName: "Someone Else", email: "x@y.com" }), { first: "Ada", last: "Lovelace" }));
check("multi-word family name kept",
  eq(onboardingPrefill({ givenName: "Ana", familyName: "de la Cruz" }), { first: "Ana", last: "de la Cruz" }));
check("falls back to the session name split",
  eq(onboardingPrefill({ sessionName: "Grace Brewster Hopper", email: "g@h.com" }), { first: "Grace", last: "Brewster Hopper" }));
check("nothing known gives empty fields",
  eq(onboardingPrefill({ givenName: "", familyName: "", sessionName: "", email: "someone@example.com" }), { first: "", last: "" }));
check("never derived from the email",
  eq(onboardingPrefill({ sessionName: "jjdk4", email: "jjdk4@privaterelay.appleid.com" }), { first: "", last: "" }));

if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
