// Test-only ESM loader for G168's regression test
// (scripts/month-closed-dismiss.test.mjs).
//
// Redirects the exact specifier "@/components/MonthClosedCard" to a
// props-capturing stub (scripts/g168-fixtures/monthClosedCardStub.mjs)
// instead of the real production component. This is how the test gets
// hold of the actual `onDismiss` closure components/HomeBrief.tsx's
// BriefBody constructs for the needle item, since this repo's test
// harness has no jsdom/click simulation to trigger it via the real DOM
// (see scripts/spend-from-render.test.mjs's own note on that ceiling).
//
// Must be passed AFTER scripts/_tsx-loader.mjs on the command line — Node
// chains --experimental-loader resolve hooks starting from the LAST one
// registered, each calling `nextResolve` to fall through to the earlier
// ones, so listing this one second gives it first refusal on the
// specifier, before _tsx-loader's own "@/" alias resolution would
// otherwise send it to the real file. (Verified empirically: the reverse
// order resolves straight past this hook.)
//
// Scope: only ever passed on scripts/month-closed-dismiss.test.mjs's own
// run command / its "check:month-closed-dismiss" npm script. Never wired
// into any other check, build, or dev command — this must not affect the
// real app.
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const STUB_URL = pathToFileURL(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "g168-fixtures", "monthClosedCardStub.mjs")
).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@/components/MonthClosedCard") {
    return { url: STUB_URL, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
