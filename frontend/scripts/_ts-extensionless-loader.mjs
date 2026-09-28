// Tiny ESM resolve hook so scripts/*.test.mjs can import real .ts modules
// under Node's built-in --experimental-strip-types even when that module's
// OWN internal relative imports omit the ".ts" extension (this repo's
// normal style, since the Next.js/TypeScript build resolves those via
// tsconfig + the bundler, which plain Node's loader does not). Retries a
// failed extensionless relative specifier with ".ts" appended before giving
// up. See scripts/accounts-pinned.test.mjs for the original caller.
//
// G83 (2026-09-18): also rewrites the `@/*` tsconfig path alias (see
// tsconfig.json's "paths": { "@/*": ["./*"] }) to a real file URL rooted at
// this frontend package (this loader's own location, one directory up from
// `scripts/`) — plain Node has no notion of that alias at all, so an
// untranslated `@/lib/api` specifier fails outright rather than falling
// into the extensionless-retry branch above. Needed so
// scripts/verdict-cache.test.mjs can import lib/verdictCache.ts and
// lib/moneyShape.ts, the REAL production modules (both import `@/lib/api`
// at the top), the same "test the real module, not a re-implementation"
// convention spend-from-account.test.mjs's own header describes.
const FRONTEND_ROOT = new URL("../", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const aliased = new URL(specifier.slice(2), FRONTEND_ROOT).href;
    try {
      return await nextResolve(aliased, context);
    } catch (err) {
      if (!/\.[a-zA-Z]+$/.test(aliased)) {
        return nextResolve(`${aliased}.ts`, context);
      }
      throw err;
    }
  }
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      !/\.[a-zA-Z]+$/.test(specifier)
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    throw err;
  }
}
