// Next imports the frozen engine JSON without Node's import-attribute syntax.
// Reuse the repository's real TS/TSX loader and provide that one JSON boundary.
import { readFile } from "node:fs/promises";
import { load as loadTs } from "../../frontend/scripts/_tsx-loader.mjs";
export { resolve } from "../../frontend/scripts/_tsx-loader.mjs";
export async function load(url, context, nextLoad) {
  if (url.endsWith("/marketing-kit/capabilities/goal-preview.json")) {
    return { format: "module", source: `export default ${await readFile(new URL(url), "utf8")}`, shortCircuit: true };
  }
  return loadTs(url, context, nextLoad);
}
