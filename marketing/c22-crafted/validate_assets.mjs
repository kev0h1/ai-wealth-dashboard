// Hash/dimension/codec checks of the deliverables themselves, not their names.
import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.join(root, "frontend/public/design-media/c22/crafted");
const manifest = JSON.parse(readFileSync(path.join(out, "manifest.json"), "utf8"));
const seen = new Set();
for (const asset of manifest.assets) {
  if (seen.has(asset.file) || path.isAbsolute(asset.file) || asset.file.split(/[\\/]/).includes("..")) throw new Error(`Invalid/duplicate asset: ${asset.file}`);
  seen.add(asset.file);
  const target = path.join(out, asset.file);
  const data = readFileSync(target);
  if (data.length !== asset.bytes || createHash("sha256").update(data).digest("hex") !== asset.sha256) throw new Error(`Changed asset: ${asset.file}`);
  if (asset.file.endsWith(".png")) {
    if (data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || data.readUInt32BE(16) !== asset.width || data.readUInt32BE(20) !== asset.height) throw new Error(`Invalid PNG: ${asset.file}`);
    if (!data.includes(Buffer.from("Source\0"))) throw new Error(`PNG provenance missing: ${asset.file}`);
  }
  if (asset.kind === "film") {
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", target], { encoding: "utf8" });
    if (probe.status !== 0) throw new Error(probe.stderr);
    const data = JSON.parse(probe.stdout);
    const v = data.streams.find((stream) => stream.codec_type === "video");
    if (v.codec_name !== "h264" || v.width !== 1080 || v.height !== 1920 || v.avg_frame_rate !== "30/1" || !["yuv420p", "yuvj420p"].includes(v.pix_fmt) || Number(v.nb_frames) !== 360 || Math.abs(Number(data.format.duration) - 12) > .04 || data.streams.some((stream) => stream.codec_type === "audio")) throw new Error(`Invalid video: ${asset.file}`);
    const decode = spawnSync("ffmpeg", ["-v", "error", "-i", target, "-f", "null", "-"], { encoding: "utf8" });
    if (decode.status !== 0 || decode.stderr.trim()) throw new Error(`Video decode failed: ${asset.file}: ${decode.stderr}`);
  }
}
for (const direction of ["receipt", "friday", "calendar"]) for (const theme of ["light", "dark"]) {
  for (const [form, height] of [["feed", 1350], ["story", 1920]]) {
    const a = manifest.assets.find((asset) => asset.file === `${direction}-${form}-${theme}.png`);
    if (a?.width !== 1080 || a.height !== height || a.status !== "review-draft") throw new Error(`Missing/wrong still: ${direction} ${form} ${theme}`);
  }
  if (!seen.has(`${direction}-${theme}.mp4`) || !seen.has(`${direction}.vtt`)) throw new Error("Missing video/captions");
}
if (manifest.assets.filter((a) => a.kind === "proof").length !== 4 || manifest.assets.filter((a) => a.kind === "still").length !== 12 || manifest.assets.filter((a) => a.kind === "film").length !== 6) throw new Error("Incomplete round");
if (!statSync(path.join(root, "marketing/c22-crafted/receipt-scene.blend")).size) throw new Error("Editable Blender scene missing");
console.log(`C22 crafted: ${manifest.assets.length} hashed resources verified; 12 stills, 4 production proofs, 6 fully decoded films, scene, fonts and captions.`);
