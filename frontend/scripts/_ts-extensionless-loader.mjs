// Tiny ESM resolve hook so scripts/*.test.mjs can import real .ts modules
// under Node's built-in --experimental-strip-types even when that module's
// OWN internal relative imports omit the ".ts" extension (this repo's
// normal style, since the Next.js/TypeScript build resolves those via
// tsconfig + the bundler, which plain Node's loader does not). Retries a
// failed extensionless relative specifier with ".ts" appended before giving
// up — nothing else. See scripts/accounts-pinned.test.mjs for the caller.
export async function resolve(specifier, context, nextResolve) {
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
