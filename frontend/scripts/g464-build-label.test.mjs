// G464: the build label (lib/buildTag.ts) lives at the bottom of the Account
// hub only. It must not render on the sign-in screen or the biometric lock
// screen, and the regulatory disclosure on sign-in must stay.
// Run: npm run -s check:g464-build-label
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
let failures = 0;
const ok = (label, cond) => { if (!cond) { failures += 1; console.error(`FAIL: ${label}`); } };

const noTag = /BUILD_TAG|buildTag|lib\/buildTag/;
for (const f of ["components/LoginScreen.tsx", "components/BiometricLock.tsx", "components/LockScreenView.tsx", "lib/lockScreenCopy.ts"]) {
  ok(`${f} does not reference the build tag`, !noTag.test(read(f)));
}
const settings = read("app/settings/SettingsPage.tsx");
ok("settings imports BUILD_TAG", /import \{ BUILD_TAG \} from "@\/lib\/buildTag"/.test(settings));
ok("settings renders {BUILD_TAG} in a plain paragraph", /<p data-build-label[^>]*>\{BUILD_TAG\}<\/p>/.test(settings));
ok("settings build label is not a link or button", !/<(a|Link|button)[^>]*>\s*\{BUILD_TAG\}/.test(settings));
ok("lib/buildTag.ts still exports BUILD_TAG", /export const BUILD_TAG/.test(read("lib/buildTag.ts")));
ok("sign-in still renders the regulatory disclosure", /TRADING_NAME_DISCLOSURE/.test(read("components/LoginScreen.tsx")));

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log("g464-build-label: ok");
