// C49: Codemagic Play publishing works whatever the app's review state.
// Runs scripts/codemagic-play-publish.sh against a fake `google-play` on PATH
// and asserts the flags on each attempt, plus the codemagic.yaml wiring.
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, chmodSync, readFileSync as rf, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("../../", import.meta.url).pathname;
const script = join(root, "scripts/codemagic-play-publish.sh");
const NEEDLE = "Changes cannot be sent for review automatically";
const SECRET = "SECRET-SERVICE-ACCOUNT-JSON";

// behaviours: array of per-attempt [exitCode, outputText]
function run(behaviours, extraArgs = ["--track", "internal"]) {
  const dir = mkdtempSync(join(tmpdir(), "c49-"));
  const aab = join(dir, "app-release.aab");
  writeFileSync(aab, "x");
  writeFileSync(join(dir, "plan.json"), JSON.stringify(behaviours));
  const fake = join(dir, "google-play");
  writeFileSync(fake, `#!/usr/bin/env bash
D="${dir}"
N=$(( $(cat "$D/count" 2>/dev/null || echo 0) + 1 ))
echo $N > "$D/count"
echo "$@" >> "$D/calls"
python3 - "$D/plan.json" "$N" <<'PY'
import json,sys
plan=json.load(open(sys.argv[1])); rc,out=plan[int(sys.argv[2])-1]
print(out); sys.exit(rc)
PY
`);
  chmodSync(fake, 0o755);
  const r = spawnSync("bash", [script, ...extraArgs], {
    env: { PATH: `${dir}:${process.env.PATH}`, AAB_GLOB: aab, GCLOUD_SERVICE_ACCOUNT_CREDENTIALS: SECRET },
    encoding: "utf8",
  });
  const calls = existsSync(join(dir, "calls")) ? rf(join(dir, "calls"), "utf8").trim().split("\n") : [];
  return { status: r.status, out: r.stdout + r.stderr, calls };
}
const flag = "--changes-not-sent-for-review";

// 1. First attempt succeeds: one call, no flag, nothing for Kevin to do.
{
  const r = run([[0, "published"]]);
  assert.equal(r.status, 0);
  assert.equal(r.calls.length, 1);
  assert.ok(!r.calls[0].includes(flag));
  assert.match(r.calls[0], /--track internal/);
  assert.match(r.out, /attempt 1 succeeded/);
  assert.doesNotMatch(r.out, /ACTION NEEDED/);
}

// 2. First fails with the review-state text, retry with the flag succeeds.
{
  const r = run([[1, `Google error: ${NEEDLE}`], [0, "saved"]]);
  assert.equal(r.status, 0);
  assert.equal(r.calls.length, 2);
  assert.ok(!r.calls[0].includes(flag));
  assert.ok(r.calls[1].includes(flag));
  assert.match(r.out, /attempt 2 succeeded/);
  assert.match(r.out, /ACTION NEEDED: Kevin must open Play Console and press 'Send for review'/);
}

// 3a. First fails with another error: no retry, non-zero.
{
  const r = run([[1, "quota exceeded"], [0, "should not run"]]);
  assert.notEqual(r.status, 0);
  assert.equal(r.calls.length, 1);
  assert.match(r.out, /quota exceeded/);
  assert.match(r.out, /Not retrying/);
}

// 3b. Both attempts fail: non-zero after exactly two calls.
{
  const r = run([[1, NEEDLE], [1, "still broken"]]);
  assert.notEqual(r.status, 0);
  assert.equal(r.calls.length, 2);
  assert.ok(r.calls[1].includes(flag));
  assert.match(r.out, /failed on both attempts/);
}

// 4. Prod: --draft on every attempt.
{
  const r = run([[1, NEEDLE], [0, "ok"]], ["--track", "production", "--draft"]);
  assert.equal(r.status, 0);
  for (const c of r.calls) {
    assert.match(c, /--track production/);
    assert.match(c, /--draft/);
  }
}

// 5. The secret is only passed to the CLI, never echoed by the script.
{
  const r = run([[1, NEEDLE], [0, "ok"]]);
  assert.ok(!r.out.includes(SECRET), "credentials never printed");
}

// codemagic.yaml wiring: no static flag, no built-in publishing, script step used.
const yaml = readFileSync(join(root, "codemagic.yaml"), "utf8");
const block = (name) => {
  const start = yaml.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `${name} workflow exists`);
  const rest = yaml.slice(start + 1);
  const next = rest.slice(1).search(/\n  [a-z][a-z0-9-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
};
for (const [wf, args] of [
  ["android-capacitor", "--track internal"],
  ["android-capacitor-prod", "--track production --draft"],
]) {
  const b = block(wf);
  assert.doesNotMatch(b, /^\s+changes_not_sent_for_review:/m, `${wf} has no static flag`);
  assert.doesNotMatch(b, /^\s+google_play:\s*$/m, `${wf} has no built-in google_play publishing`);
  assert.ok(b.includes(`codemagic-play-publish.sh" ${args}`), `${wf} calls the publish script with ${args}`);
}
console.log("c49-play-publish: ok");
