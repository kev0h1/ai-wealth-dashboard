// Plain-Node test for G182: components/AuthProvider.tsx's sign-in redirect
// cleanup used to do `window.history.replaceState({}, "", cleaned)` —
// replacing the CURRENT entry's state with a bare empty object instead of
// spreading `window.history.state` the way every other pushState/
// replaceState site in this codebase does (lib/scrollNavDetect.ts's
// ScrollReset.tsx caller, lib/useSheetA11y.ts's H71 backToClose push, and
// G116's lib/accountSheetHistory.ts). That silently destroyed two things
// living on `history.state` for the first entry after OAuth:
//   - lib/scrollNavDetect.ts's `__wdNavSeq` stamp, whose mere PRESENCE is
//     its whole POP/PUSH signal (see that file's header comment) — wiping
//     it makes the very next traversal misread as a fresh push forever.
//   - Next's own router state, `__NA` / `__PRIVATE_NEXTJS_INTERNALS_TREE`,
//     written by node_modules/next/dist/client/components/app-router.js's
//     `HistoryUpdater` (~L46-58) on every entry it owns.
//
// Same framework-free pattern as scripts/scroll-nav-detect.test.mjs and
// scripts/account-sheet-history.test.mjs. This script checks two things:
//
//   1. AuthProvider.tsx's own cleanup call spreads the prior state (source
//      read, not a DOM-driven unit test — AuthProvider pulls in Capacitor/
//      routing/API dependencies that aren't worth mocking just to exercise
//      one line). Proven red against the exact old snippet, green against
//      the current file.
//   2. A repo-wide scan: every `history.pushState(`/`history.replaceState(`
//      call site under frontend/ (excluding node_modules, .next, scripts)
//      either spreads `history.state` inline or calls a helper whose own
//      body does — so this class of bug can't reappear at a new call site
//      unnoticed. An explicit ALLOWLIST covers any site that legitimately
//      resets state; empty today; add an entry with a citation-shaped
//      justification if one is ever found to be intentional.
//
// Run with:
//   node --no-warnings --experimental-strip-types scripts/auth-replace-state.test.mjs
// or:
//   npm run -s check:auth-replace-state

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(__dirname, "..");

let failures = 0;
function check(label, cond) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}

// --- bracket-balanced parsing helpers -------------------------------------

/** Given `source` and the index of an opening bracket (`(`, `{` or `[`),
 *  returns the index of its matching close bracket, tracking nested
 *  brackets of any of the three kinds and skipping over string/template
 *  literal contents so a stray bracket character inside a string can't
 *  throw off the count. */
function matchingBracketEnd(source, openIndex) {
  let depth = 1;
  let i = openIndex;
  let inString = null;
  while (i < source.length - 1 && depth > 0) {
    i += 1;
    const c = source[i];
    if (inString) {
      if (c === "\\") {
        i += 1;
      } else if (c === inString) {
        inString = null;
      }
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      inString = c;
      continue;
    }
    if (c === "(" || c === "{" || c === "[") depth += 1;
    else if (c === ")" || c === "}" || c === "]") depth -= 1;
  }
  return i;
}

/** Splits a call's argument-list text on top-level commas only (not commas
 *  nested inside (), {}, [] or strings), returning trimmed argument texts. */
function splitTopLevelArgs(text) {
  const args = [];
  let depth = 0;
  let current = "";
  let inString = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      current += c;
      if (c === "\\") {
        current += text[i + 1] ?? "";
        i += 1;
      } else if (c === inString) {
        inString = null;
      }
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      inString = c;
      current += c;
      continue;
    }
    if (c === "(" || c === "{" || c === "[") depth += 1;
    if (c === ")" || c === "}" || c === "]") depth -= 1;
    if (c === "," && depth === 0) {
      args.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  if (current.trim().length) args.push(current);
  return args.map((a) => a.trim());
}

/** Finds every `history.pushState(`/`history.replaceState(` call in
 *  `source` (matches both `window.history....` and bare `history....`),
 *  skipping matches on comment lines, and returns each call's method name,
 *  1-based line number, raw line text, and first-argument text. */
function findHistoryStateCalls(source) {
  const calls = [];
  const callRe = /history\.(pushState|replaceState)\s*\(/g;
  let m;
  while ((m = callRe.exec(source)) !== null) {
    const lineStart = source.lastIndexOf("\n", m.index) + 1;
    const lineEndIdx = source.indexOf("\n", m.index);
    const lineText = source.slice(lineStart, lineEndIdx === -1 ? source.length : lineEndIdx);
    if (/^\s*(\/\/|\*)/.test(lineText)) continue; // comment line, not real code
    const openParenIndex = m.index + m[0].length - 1;
    const closeParenIndex = matchingBracketEnd(source, openParenIndex);
    const argsText = source.slice(openParenIndex + 1, closeParenIndex);
    const args = splitTopLevelArgs(argsText);
    const lineNumber = source.slice(0, m.index).split("\n").length;
    calls.push({
      method: m[1],
      firstArg: args[0] ?? "",
      lineNumber,
      lineText: lineText.trim(),
    });
  }
  return calls;
}

/** True when the named `function <fnName>(...)` in `source` has a body
 *  that contains a spread (`...`) at all — the whole job of each of this
 *  repo's state-merging helpers, so this is a meaningful self-check, not a
 *  rubber stamp: it fails loudly if a helper's spread is ever removed. */
function helperSpreadsState(source, fnName) {
  const re = new RegExp(`function\\s+${fnName}\\s*\\(`);
  const m = re.exec(source);
  if (!m) return false;
  const openBrace = source.indexOf("{", m.index);
  if (openBrace === -1) return false;
  const closeBrace = matchingBracketEnd(source, openBrace);
  const body = source.slice(openBrace, closeBrace);
  return body.includes("...");
}

/** For a bare identifier passed as the first argument (e.g. `stampedState`),
 *  finds the `const <ident> = <fn>(` or `const { ..., <ident>, ... } =
 *  <fn>(` assignment in the same file's source and returns the called
 *  function's name, or `{ inlineSpread: true }` if the identifier was
 *  itself assigned from an object literal containing a spread. */
function resolveIdentifierOrigin(fileSource, ident) {
  const destructureRe = new RegExp(
    `const\\s*\\{[^}]*\\b${ident}\\b[^}]*\\}\\s*=\\s*([A-Za-z_$][\\w$]*)\\s*\\(`
  );
  const directCallRe = new RegExp(`const\\s+${ident}\\s*=\\s*([A-Za-z_$][\\w$]*)\\s*\\(`);
  const directSpreadRe = new RegExp(`const\\s+${ident}\\s*=\\s*\\{[^;]*\\.\\.\\.`);
  const m = destructureRe.exec(fileSource) || directCallRe.exec(fileSource);
  if (m) return { calledFn: m[1] };
  if (directSpreadRe.test(fileSource)) return { inlineSpread: true };
  return null;
}

// Helper functions in this repo whose whole job is to merge new fields
// into an existing history-state object (verified below to actually spread
// their input, not just asserted). Add an entry here, and verify it below,
// before allowing a call site to reference it as its safety justification.
const KNOWN_SPREADING_HELPERS = {
  classifyNavigation: path.join(FRONTEND_ROOT, "lib/scrollNavDetect.ts"),
  stampAccountDetailState: path.join(FRONTEND_ROOT, "lib/accountSheetHistory.ts"),
};

/** Explicit allowlist for any pushState/replaceState call site that
 *  legitimately resets history state rather than spreading it. Keyed by
 *  `relative/path.ts:lineNumber`. Expected to be empty — every current
 *  call site spreads state or calls a helper that does. If a genuine
 *  exception is ever found, add it here with a one-line justification
 *  citing why a reset (not a merge) is correct at that call site. */
const ALLOWLIST = {};

function classifyArg(firstArg, fileSource) {
  if (firstArg.includes("...")) {
    return { safe: true, reason: "inline spread in the argument" };
  }
  for (const helper of Object.keys(KNOWN_SPREADING_HELPERS)) {
    if (firstArg.startsWith(`${helper}(`)) {
      return { safe: true, reason: `calls known spreading helper ${helper}()` };
    }
  }
  if (/^[A-Za-z_$][\w$]*$/.test(firstArg)) {
    const origin = resolveIdentifierOrigin(fileSource, firstArg);
    if (origin?.inlineSpread) {
      return { safe: true, reason: `variable "${firstArg}" is assigned via an inline spread` };
    }
    if (origin?.calledFn && Object.prototype.hasOwnProperty.call(KNOWN_SPREADING_HELPERS, origin.calledFn)) {
      return {
        safe: true,
        reason: `variable "${firstArg}" comes from known spreading helper ${origin.calledFn}()`,
      };
    }
  }
  return {
    safe: false,
    reason: "does not spread history.state and does not call a known spreading helper",
  };
}

function listSourceFiles(dir, out = []) {
  const SKIP_DIRS = new Set(["node_modules", ".next", "scripts", ".git"]);
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      listSourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

// --- 1. AuthProvider.tsx's own cleanup call, proven red then green -------

function testAuthProviderCleanupSpreadsState() {
  // The exact vulnerable line this item fixes, as it read before G182.
  const oldVulnerableSnippet = `window.history.replaceState({}, "", cleaned);`;
  const oldCall = findHistoryStateCalls(oldVulnerableSnippet)[0];
  check("old snippet is detected as a replaceState call", oldCall?.method === "replaceState");
  const oldVerdict = classifyArg(oldCall.firstArg, oldVulnerableSnippet);
  check(
    "RED: the old `{}` argument is correctly flagged as unsafe",
    oldVerdict.safe === false
  );

  const authProviderPath = path.join(FRONTEND_ROOT, "components/AuthProvider.tsx");
  const authProviderSource = readFileSync(authProviderPath, "utf8");
  const calls = findHistoryStateCalls(authProviderSource).filter(
    (c) => c.method === "replaceState"
  );
  check("AuthProvider.tsx still has exactly one replaceState call (the cleanup)", calls.length === 1);
  const call = calls[0];
  check(
    "AuthProvider.tsx's replaceState no longer passes a bare {}",
    call.firstArg !== "{}"
  );
  const verdict = classifyArg(call.firstArg, authProviderSource);
  check(
    `GREEN: AuthProvider.tsx:${call.lineNumber} spreads prior history.state (${verdict.reason})`,
    verdict.safe === true
  );

  // The cleaned URL must still be passed, i.e. this isn't a no-op that
  // stopped stripping the token/error from the address bar.
  check(
    "AuthProvider.tsx's replaceState call still passes `cleaned` as the URL argument",
    call.lineText.includes("cleaned")
  );

  // The prior-state read itself must come from window.history.state, with
  // a non-object guard (the same shape lib/accountSheetHistory.ts uses),
  // not e.g. a stale closure variable.
  check(
    "AuthProvider.tsx reads window.history.state (not some unrelated source) before spreading",
    /window\.history\.state\s*!=\s*null/.test(authProviderSource) &&
      authProviderSource.includes('typeof window.history.state === "object"')
  );
}

// --- 2. Known helpers actually spread their input -------------------------

function testKnownHelpersActuallySpread() {
  for (const [fnName, filePath] of Object.entries(KNOWN_SPREADING_HELPERS)) {
    const source = readFileSync(filePath, "utf8");
    check(
      `${fnName}() in ${path.relative(FRONTEND_ROOT, filePath)} spreads its input state`,
      helperSpreadsState(source, fnName)
    );
  }
}

// --- 3. Repo-wide scan: every call site spreads or defers to a helper ----

function testRepoWideScan() {
  const files = listSourceFiles(FRONTEND_ROOT);
  let sitesChecked = 0;
  const violations = [];
  const allowlisted = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const calls = findHistoryStateCalls(source);
    if (calls.length === 0) continue;
    const rel = path.relative(FRONTEND_ROOT, file);
    for (const call of calls) {
      sitesChecked += 1;
      const key = `${rel}:${call.lineNumber}`;
      const verdict = classifyArg(call.firstArg, source);
      if (verdict.safe) {
        check(`${key} (${call.method}) is safe: ${verdict.reason}`, true);
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(ALLOWLIST, key)) {
        allowlisted.push({ key, justification: ALLOWLIST[key] });
        console.log(`ALLOWLISTED: ${key} — ${ALLOWLIST[key]}`);
        continue;
      }
      violations.push({ key, lineText: call.lineText, reason: verdict.reason });
    }
  }

  check("scanned at least the known call sites (AuthProvider, ScrollReset, AccountsPage, useSheetA11y)", sitesChecked >= 4);

  for (const v of violations) {
    console.error(`FAIL: ${v.key} does not spread history.state and is not allowlisted: ${v.lineText} (${v.reason})`);
  }
  check(
    `repo-wide scan: no un-allowlisted pushState/replaceState call resets state (checked ${sitesChecked} site(s), ${violations.length} violation(s), ${allowlisted.length} allowlisted)`,
    violations.length === 0
  );
}

function main() {
  testAuthProviderCleanupSpreadsState();
  testKnownHelpersActuallySpread();
  testRepoWideScan();

  if (failures > 0) {
    console.error(`\n${failures} failure(s).`);
    process.exit(1);
  }
  console.log("\nAll auth-replace-state checks passed.");
}

main();
