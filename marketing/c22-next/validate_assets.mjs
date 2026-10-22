// Check actual deliverables, including source freshness and full movie decoding.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.join(root, "frontend/public/design-media/c22/next");
const manifest = JSON.parse(readFileSync(path.join(out, "manifest.json"), "utf8"));
const hash = (data) => createHash("sha256").update(data).digest("hex");
if (manifest.status !== "creative-review-only") throw new Error("Review status missing");
for (const [source, expected] of Object.entries(manifest.sourceDependencies)) {
  if (hash(readFileSync(path.join(root, source))) !== expected) throw new Error(`Production UI changed since capture: ${source}`);
}
const seen = new Set();
for (const a of manifest.assets) {
  if (seen.has(a.file) || path.isAbsolute(a.file) || a.file.split(/[\\/]/).includes("..")) throw new Error(`Invalid asset ${a.file}`);
  seen.add(a.file);
  const target = path.join(out, a.file);
  const bytes = readFileSync(target);
  if (bytes.length !== a.bytes || hash(bytes) !== a.sha256) throw new Error(`Changed asset ${a.file}`);
  if (a.file.endsWith(".png")) {
    if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || bytes.readUInt32BE(16) !== a.width || bytes.readUInt32BE(20) !== a.height || !bytes.includes(Buffer.from("Source\0"))) throw new Error(`Invalid PNG ${a.file}`);
  }
  if (a.kind === "film") {
    const result = spawnSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", target], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    const probe = JSON.parse(result.stdout);
    const video = probe.streams.find((s) => s.codec_type === "video");
    const audio = probe.streams.find((s) => s.codec_type === "audio");
    if (video?.codec_name !== "h264" || video.width !== 1080 || video.height !== 1920 || video.avg_frame_rate !== "30/1" || Number(video.nb_frames) !== 450 || Math.abs(Number(probe.format.duration) - 15) > .06 || !["yuv420p", "yuvj420p"].includes(video.pix_fmt) || audio?.codec_name !== "aac") throw new Error(`Invalid film ${a.file}`);
    const decoded = spawnSync("ffmpeg", ["-v", "error", "-i", target, "-f", "null", "-"], { encoding: "utf8" });
    if (decoded.status !== 0 || decoded.stderr.trim()) throw new Error(`Decode failed ${a.file}: ${decoded.stderr}`);
    console.log(`Decoded ${a.file}: 450 frames, AAC sound`);
  }
}
for (const variant of ["amount", "account", "working"]) for (const theme of ["light", "dark"]) for (const [format, height] of [["feed", 1350], ["story", 1920]]) {
  const a = manifest.assets.find((a) => a.file === `${variant}-${theme}-${format}.png`);
  if (a?.width !== 1080 || a.height !== height || a.kind !== "still") throw new Error(`Missing still ${variant}-${theme}-${format}`);
}
for (const story of ["balance", "account"]) {
  for (const theme of ["light", "dark"]) if (!seen.has(`${story}-${theme}.mp4`)) throw new Error("Missing film");
  if (!seen.has(`${story}.vtt`) || !seen.has(`${story}-sound.wav`)) throw new Error("Missing sound or captions");
}
if (manifest.assets.filter((a) => a.kind === "film").length !== 4 || manifest.assets.filter((a) => a.kind === "still").length !== 12 || manifest.assets.filter((a) => a.kind === "proof").length !== 10) throw new Error("Incomplete campaign");
console.log("C22 replacement: 12 designed PNGs, 4 decoded films, 10 fresh product captures, captions and sound verified.");
