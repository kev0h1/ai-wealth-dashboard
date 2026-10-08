/** Validate C22 worlds exports without adding an image-processing dependency. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const directory = new URL("../../../public/design-media/c22/worlds/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("exports.json", directory), "utf8"));
const expected = new Map([
  ["c-feed.png", [1080, 1350]], ["c-story.png", [1080, 1920]],
  ["d-feed.png", [1080, 1350]], ["d-story.png", [1080, 1920]],
  ["e-feed.png", [1080, 1350]], ["e-story.png", [1080, 1920]],
]);

assert.equal(manifest.ticket, "C22");
assert.equal(manifest.status, "synthetic/draft");
assert.equal(manifest.exports.length, expected.size, "exactly six export records");
assert.equal(new Set(manifest.exports.map((asset) => asset.file)).size, expected.size, "no duplicate filenames");
for (const asset of manifest.exports) {
  const dimensions = expected.get(asset.file);
  assert(dimensions, `unexpected export ${asset.file}`);
  const bytes = readFileSync(new URL(asset.file, directory));
  assert.equal(bytes.subarray(1, 4).toString(), "PNG", asset.file);
  assert.equal(bytes[25], 2, `${asset.file} must be RGB PNG, without alpha`);
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], dimensions, asset.file);
  assert.equal(asset.width, dimensions[0], asset.file);
  assert.equal(asset.height, dimensions[1], asset.file);
  assert.equal(asset.bytes, bytes.length, asset.file);
  assert.equal(asset.sha256, createHash("sha256").update(bytes).digest("hex"), asset.file);
  assert.equal(asset.source, "browser composition");
  assert.equal(asset.props, "actual production props");
  assert.equal(asset.scene, "generated blank-screen scene separately");
  assert.equal(asset.status, "synthetic/draft");
  expected.delete(asset.file);
}
assert.equal(expected.size, 0, `missing: ${[...expected.keys()].join(", ")}`);
console.log(`PASS: validated ${manifest.exports.length} RGB C22 world PNGs in ${fileURLToPath(directory)}`);
