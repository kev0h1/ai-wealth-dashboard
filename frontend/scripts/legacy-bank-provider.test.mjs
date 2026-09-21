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
// NO source matching as legacy at all, and that non-empty inputs produce
// the exact strings the Accounts menu and the picker sheet render.
//
// The subtle one, and the one an earlier version of this file got exactly
// backwards: on a UAT build a MISSING `source` MUST match as legacy. That
// is the backend's convention, verified in the code and against the live
// UAT database — `services/finexer_sync.py:629` is the only writer of that
// field and writes "finexer"; `services/truelayer_sync.py` writes no
// `source` at all; `routers/card_terms.py:122` reads it as
// `a.get("source") or "truelayer"`; and the distinct set of values in the
// `accounts` collection is `['finexer']`, with 34 documents carrying no
// `source` and zero carrying "truelayer". A rule of `source === "truelayer"`
// would therefore be false for every real account, and every expired
// TrueLayer reconnect would silently start a NEW Finexer consent instead of
// repairing the dead one. The production half must stay unconditional
// regardless: absent provider, nothing matches, whatever the data says.
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
  // The whole point of the AVAILABLE guard: with LEGACY_BANK_ID == "", the
  // "missing means legacy" rule below would otherwise match EVERY account
  // (`(undefined || "") === ""`), routing every production reconnect to a
  // provider that does not exist in this build. Nothing is legacy here.
  check("production: undefined source is not legacy", m.isLegacyBankSource(undefined), false);
  check("production: null source is not legacy", m.isLegacyBankSource(null), false);
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
  // The real-data cases. A TrueLayer account carries NO `source` field, so
  // these three are what every actual legacy reconnect looks like.
  check("uat: MISSING source matches (this is what real data looks like)", m.isLegacyBankSource(undefined), true);
  check("uat: null source matches", m.isLegacyBankSource(null), true);
  check("uat: empty-string source matches", m.isLegacyBankSource(""), true);
}

if (failures > 0) {
  console.error(`\nlegacy-bank-provider.test.mjs: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\nlegacy-bank-provider.test.mjs: all checks passed");
