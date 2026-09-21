// Plain-Node test for lib/legacyBankProvider.ts (A67) — same framework-free
// pattern as scripts/spend-from-account.test.mjs et al: imports the REAL
// production module, not a re-implementation.
//
// Run with:
//   node --no-warnings --experimental-strip-types scripts/legacy-bank-provider.test.mjs
// or:
//   npm run -s check:legacy-bank-provider
//
// What this guards. TrueLayer is a UAT-only provider (A67): Finexer is the
// only one production connects through, and Kevin's constraint was that
// "behind a flag is not enough if the flag could be switched on in
// production, so enforce absence rather than rely on configuration". The
// absence itself is a property of the BUILD, proven by grepping
// `.next/static` after `next build` (there is no unit test that can assert
// what a bundler emitted). What CAN be pinned here, and is, is the
// derivation this file does from the two values next.config.ts inlines:
// that empty inputs produce an unavailable provider with empty labels and
// no source ever matching as legacy, and that non-empty inputs produce the
// exact strings the Accounts menu and the picker sheet render. If someone
// later makes LEGACY_BANK_AVAILABLE default to true, or lets an account
// with no `source` match as legacy (which is how the ORIGINAL defect
// worked: the test was inverted, so anything not explicitly Finexer fell
// through to TrueLayer), this fails.
//
// Each case re-imports the module with a fresh cache-busting query string,
// because the constants are resolved once at module scope from
// process.env — the same reason backend tests/test_truelayer_uat_only.py
// tests config._is_non_production rather than the constant it produces.

let failures = 0;

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures += 1;
    console.error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}

let bust = 0;
async function load(id, name) {
  if (id === undefined) delete process.env.NEXT_PUBLIC_LEGACY_BANK_ID;
  else process.env.NEXT_PUBLIC_LEGACY_BANK_ID = id;
  if (name === undefined) delete process.env.NEXT_PUBLIC_LEGACY_BANK_NAME;
  else process.env.NEXT_PUBLIC_LEGACY_BANK_NAME = name;
  bust += 1;
  return import(`../lib/legacyBankProvider.ts?bust=${bust}`);
}

// ── production build: both values inlined as "" ──────────────────────────

{
  const m = await load("", "");
  check("production: not available", m.LEGACY_BANK_AVAILABLE, false);
  check("production: no menu label", m.LEGACY_BANK_MENU_LABEL, "");
  check("production: no sheet subtitle", m.LEGACY_BANK_SUBTITLE, "");
  check("production: no identifier", m.LEGACY_BANK_ID, "");
  check("production: undefined source is not legacy", m.isLegacyBankSource(undefined), false);
  check("production: null source is not legacy", m.isLegacyBankSource(null), false);
  // The one that matters: with LEGACY_BANK_ID == "", a naive `source ===
  // LEGACY_BANK_ID` would match an account whose source really is the empty
  // string. The AVAILABLE guard is what stops it.
  check("production: empty-string source is not legacy", m.isLegacyBankSource(""), false);
  check("production: a finexer source is not legacy", m.isLegacyBankSource("finexer"), false);
  check("production: the name is still not legacy", m.isLegacyBankSource("truelayer"), false);
}

// ── the vars missing entirely (not even set to "") ───────────────────────

{
  const m = await load(undefined, undefined);
  check("unset: not available", m.LEGACY_BANK_AVAILABLE, false);
  check("unset: no menu label", m.LEGACY_BANK_MENU_LABEL, "");
}

// ── half-configured: fails closed, never a half-built label ──────────────

{
  const m = await load("truelayer", "");
  check("id without name: not available", m.LEGACY_BANK_AVAILABLE, false);
  check("id without name: no menu label", m.LEGACY_BANK_MENU_LABEL, "");
  check("id without name: source does not match", m.isLegacyBankSource("truelayer"), false);
}

{
  const m = await load("", "TrueLayer");
  check("name without id: not available", m.LEGACY_BANK_AVAILABLE, false);
  check("name without id: no sheet subtitle", m.LEGACY_BANK_SUBTITLE, "");
}

// ── UAT build: proves the wiring is not simply always-off ────────────────

{
  const m = await load("truelayer", "TrueLayer");
  check("uat: available", m.LEGACY_BANK_AVAILABLE, true);
  check("uat: menu label", m.LEGACY_BANK_MENU_LABEL, "Add Bank via TrueLayer");
  check("uat: sheet subtitle", m.LEGACY_BANK_SUBTITLE, "Secure open banking · Powered by TrueLayer");
  check("uat: its own source matches", m.isLegacyBankSource("truelayer"), true);
  check("uat: a finexer source does not match", m.isLegacyBankSource("finexer"), false);
  check("uat: an unknown source does not match", m.isLegacyBankSource("mono"), false);
  check("uat: undefined source does not match", m.isLegacyBankSource(undefined), false);
}

if (failures > 0) {
  console.error(`\nlegacy-bank-provider.test.mjs: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\nlegacy-bank-provider.test.mjs: all checks passed");
