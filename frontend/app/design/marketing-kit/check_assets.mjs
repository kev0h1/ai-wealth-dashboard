import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SAFE_TO_SPEND, UPCOMING_HERO, UPCOMING_ACCOUNTS, PROOF_ACCOUNTS, MOVE_SUGGESTION, PAYDAY_PLAN } from "./fixtures.ts";

const read = (url) => JSON.parse(readFileSync(url, "utf8"));
const content = read(new URL("./content.json", import.meta.url));
const directory = new URL("../../../public/design-media/c22/", import.meta.url);
const manifest = read(new URL("manifest.json", directory));
const expected = new Set();
for (const feature of content.features) for (const theme of ["light", "dark"]) {
  expected.add(`proof-${feature.id}-${theme}.png`);
  if (["connect", "suggestions", "penny"].includes(feature.id)) expected.add(`detail-${feature.id}-${theme}.png`);
  for (const format of Object.keys(content.formats)) for (const direction of ["a", "b"]) expected.add(`${direction}-${feature.id}-${format}-${theme}.png`);
}
for (const film of ["safe-to-spend", "upcoming", "penny", "overview", "app-preview"]) for (const theme of ["light", "dark"]) expected.add(`${film}-${theme}.mp4`);
assert.equal(expected.size, 226);
assert.equal(manifest.assets.length, 226);
assert.equal(new Set(manifest.assets.map((a) => a.file)).size, 226, "No duplicate records");
for (const asset of manifest.assets) {
  assert(expected.delete(asset.file), `Unexpected or duplicate ${asset.file}`);
  const path = new URL(asset.file, directory);
  const bytes = readFileSync(path);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256, asset.file);
  assert.equal(bytes.length, asset.bytes);
  assert.equal(asset.synthetic, true);
  assert.equal(asset.status, "review-draft");
  assert(["light", "dark"].includes(asset.theme));
  if (asset.file.endsWith(".png")) {
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    assert.equal(bytes[25], 2, "RGB PNG, no alpha channel");
    assert.equal(bytes.readUInt32BE(16), asset.width);
    assert.equal(bytes.readUInt32BE(20), asset.height);
    if (asset.format) {
      assert.equal(asset.width, content.formats[asset.format].width);
      assert.equal(asset.height, content.formats[asset.format].height);
    }
  } else {
    const result = spawnSync("ffprobe", ["-v", "quiet", "-show_format", "-show_streams", "-of", "json", fileURLToPath(path)], { encoding: "utf8" });
    assert.equal(result.status, 0);
    const probe = JSON.parse(result.stdout);
    const video = probe.streams.find((s) => s.codec_type === "video");
    assert.equal(video.codec_name, "h264");
    assert.equal(video.avg_frame_rate, "30/1");
    assert.equal(video.r_frame_rate, "30/1");
    assert(["yuv420p", "yuvj420p"].includes(video.pix_fmt));
    assert.equal(video.width, asset.width);
    assert.equal(video.height, asset.height);
    assert(Math.abs(Number(probe.format.duration) - asset.duration) < .05);
    assert.equal(probe.streams.filter((s) => s.codec_type === "audio").length, 0);
    if (asset.film === "app-preview") assert(video.level <= 40, "Apple preview profile level at most 4.0");
  }
}
assert.equal(expected.size, 0);
for (const [field, max] of Object.entries({ name: 30, subtitle: 30, promotionalText: 170, description: 4000, shortDescription: 80, keywords: 100 })) {
  const value = content.store[field];
  assert((field === "keywords" ? Buffer.byteLength(value) : value.length) <= max, field);
}
assert(!JSON.stringify(content).includes("\u2014"));
const current = PROOF_ACCOUNTS.filter((account) => account.subtype === "CURRENT").reduce((sum, account) => sum + account.balance, 0);
assert.equal(current, 610);
assert.equal(UPCOMING_HERO.runway, current - UPCOMING_HERO.runwayBillsTotal);
assert.equal(SAFE_TO_SPEND.safe_to_spend, UPCOMING_HERO.runway - SAFE_TO_SPEND.buffer);
assert.equal(UPCOMING_ACCOUNTS.reduce((sum, account) => sum + account.closing, 0), UPCOMING_HERO.runway);
assert.equal(MOVE_SUGGESTION.amount, UPCOMING_ACCOUNTS.find((account) => account.status === "short").shortfall);
assert.equal(PAYDAY_PLAN.salary.amount, PAYDAY_PLAN.total + PAYDAY_PLAN.salary.stays);
console.log("PASS: 216 RGB PNGs, 10 verified H.264 films, complete dimensions/themes/hashes, copy limits and reconciled financial fixtures.");
