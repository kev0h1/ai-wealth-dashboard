import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, copyFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { scanDesignDirectory } from "./check-design-no-live-data.mjs";

const script = fileURLToPath(new URL("./check-design-no-live-data.mjs", import.meta.url));
const root = mkdtempSync(path.join(tmpdir(), "design-no-live-data-"));

function writeFixture(name, source) {
  const dir = path.join(root, name);
  mkdirSync(dir);
  writeFileSync(path.join(dir, "Preview.tsx"), source);
  return dir;
}

function fails(name, source) {
  const dir = writeFixture(name, source);
  assert.ok(scanDesignDirectory(dir).length > 0, `${name} must be reported as a violation`);
}

try {
  for (const [name, source] of [
    ["multiline-value-import", `import {\n  api,\n  type Account,\n} from "@/lib/api";\nexport const Preview = () => api.accounts();`],
    ["alias-value-import", `import { resolveApiAsset } from "@/lib/api.ts";\nexport const Preview = () => resolveApiAsset("bank");`],
    ["alias-js-value-import", `import { api } from "@/lib/api.js";\nexport const Preview = () => api.accounts();`],
    ["side-effect-import", `import "@/lib/api";\nexport const Preview = () => null;`],
    ["runtime-re-export", `export { api, type Account } from "@/lib/api";`],
    ["star-re-export", `export * from "@/lib/api";`],
    ["direct-fetch", `// fetch("comment-only")\nexport const Preview = () => fetch("/api/accounts");`],
    ["global-fetch", `export const Preview = () => globalThis.fetch("/api/accounts");`],
    ["window-fetch", `export const Preview = () => window.fetch("/api/accounts");`],
    ["dynamic-api-import", `export const Preview = () => import("@/lib/api");`],
  ]) {
    fails(name, source);
  }
  for (const [name, source] of [
    ["original-leaked-note", `export const note = "Coordinator review: the conclusion rests on TrueLayer's documented formula plus how Sorted stores balance.";`],
    ["internal-jsx", `export default () => <p>Coordinator review: awaiting evidence.</p>;`],
    ["internal-template", 'export const text = `Coordinator review: ${decision}`;'],
    ["pasted-board-metadata", 'export const copied = "| H42 | [owner: codex] [state: review] [branch: feature-H42-live] |";'],
    ["pasted-board-markdown", 'export const copied = "- [ ] G41. Internal task description";'],
    ["copied-board-object", 'export const copied = { id: "G41", section: "G", owner: "claude", state: "blocked", title: "Copied task" };'],
    ["raw-todo-import", 'import board from "../../../TODO.md"; export default board;'],
    ["raw-todo-dynamic", 'export const board = import("../../../TODO.md?raw");'],
    ["raw-todo-require", 'export const board = require("../../../TODO.md");'],
    ["raw-compliance-export", 'export { default } from "../../../docs/compliance/finexer-agent-controls-2026-09.md";'],
    ["raw-board-read", 'export const path = "../TODO.md";'],
  ]) fails(name, source);

  const safeBoardDir = writeFixture("synthetic-board", `
    // Coordinator review: comments describing the guard are not fixture data.
    export const card = { id: "A9001", section: "A", owner: "codex", state: "todo",
      title: "Synthetic account summary example", link: "https://example.invalid/design/card" };
    export default () => <p>Review the account summary example.</p>;
  `);
  assert.deepEqual(scanDesignDirectory(safeBoardDir), [], "synthetic board examples and comments must pass");
  const safeDir = writeFixture("fixture-and-types", `
    import type { Account, Transaction } from "@/lib/api";
    import { type SafeToSpend } from "@/lib/api";
    export type { Account as FixtureAccount } from "@/lib/api";
    export { type Transaction as FixtureTransaction } from "@/lib/api";
    // import { api } from "@/lib/api"; fetch("comment-only")
    const fixtures: Account[] = [];
    const typed: SafeToSpend | null = null;
    export const Preview = () => <span>{fixtures.length}{typed?.amount ?? 0}</span>;
  `);
  assert.deepEqual(scanDesignDirectory(safeDir), [], "fixture and type-only imports must pass");

  // Verify the unchanged no-argument command path, without a test-only
  // runtime override. The copied script resolves TypeScript through the
  // frontend node_modules symlink just as the real command does.
  const cliRoot = path.join(root, "cli-frontend");
  const cliDesign = path.join(cliRoot, "app", "design");
  mkdirSync(path.join(cliRoot, "scripts"), { recursive: true });
  mkdirSync(cliDesign, { recursive: true });
  copyFileSync(script, path.join(cliRoot, "scripts", "check-design-no-live-data.mjs"));
  symlinkSync(path.resolve("node_modules"), path.join(cliRoot, "node_modules"), "dir");
  writeFileSync(path.join(cliDesign, "Preview.tsx"), `import "@/lib/api";`);
  const cli = spawnSync(process.execPath, ["scripts/check-design-no-live-data.mjs"], { cwd: cliRoot, encoding: "utf8" });
  assert.equal(cli.status, 1, `no-argument command must fail\n${cli.stdout}\n${cli.stderr}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("design-no-live-data OK");
