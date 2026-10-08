// Run from frontend: node app/design/marketing-kit/export_films.mjs
// Local Remotion only. No generated audio, paid APIs or store upload.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const out = path.resolve("public/design-media/c22");
const manifestPath = path.join(out, "manifest.json");
const allFilms = ["safe-to-spend", "upcoming", "penny", "overview", "app-preview"];
const indexOnly = process.argv.includes("--index-only");
const requested = process.argv.slice(2).filter((arg) => arg !== "--index-only");
const jobs = (requested.length ? requested : allFilms).flatMap((value) => {
  const [film, selectedTheme] = value.split("@");
  if (!allFilms.includes(film) || (selectedTheme && !["light", "dark"].includes(selectedTheme))) throw new Error("Unknown film or theme");
  return (selectedTheme ? [selectedTheme] : ["light", "dark"]).map((theme) => ({ film, theme }));
});
function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
for (const {film, theme} of jobs) {
  const filename = `${film}-${theme}.mp4`;
  const target = path.join(out, filename);
  console.log(`${indexOnly ? "Checking" : "Rendering"} ${filename}`);
  if (!indexOnly) run("npx", ["--no-install", "remotion", "render", "remotion/marketing-kit/index.ts", `Marketing-${film}-${theme}`, target,
    "--codec=h264", "--concurrency=2", "--browser-executable=/usr/bin/google-chrome", "--x264-preset=fast", "--video-bitrate=10M"]);
  const probe = JSON.parse(spawnSync("ffprobe", ["-v", "quiet", "-show_format", "-show_streams", "-of", "json", target], { encoding: "utf8" }).stdout);
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  const seconds = ["overview", "app-preview"].includes(film) ? 30 : 15;
  if (!video || video.codec_name !== "h264" || video.avg_frame_rate !== "30/1" || video.r_frame_rate !== "30/1" || !["yuv420p", "yuvj420p"].includes(video.pix_fmt) || probe.streams.some((stream) => stream.codec_type === "audio") || video.width !== (film === "app-preview" ? 886 : 1080) || video.height !== 1920 || Math.abs(Number(probe.format.duration) - seconds) > 0.05 || (film === "app-preview" && video.level > 40)) throw new Error(`Invalid film ${filename}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.assets = manifest.assets.filter((asset) => asset.file !== filename);
  manifest.assets.push({ file: filename, kind: "film", film, theme, width: video.width, height: video.height, duration: seconds, fps: video.avg_frame_rate, codec: video.codec_name, pixelFormat: video.pix_fmt,
    bytes: statSync(target).size, sha256: createHash("sha256").update(readFileSync(target)).digest("hex"), status: "review-draft", audio: "silent", source: "remotion/marketing-kit/MarketingFilm.tsx", synthetic: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Verified ${filename}: ${video.width}x${video.height}, ${seconds}s, ${video.codec_name}`);
}
