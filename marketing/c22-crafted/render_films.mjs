// Run from the repository root. Local rendering only, no paid APIs or upload.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const frontend = path.join(root, "frontend");
const out = path.join(frontend, "public/design-media/c22/crafted");
const captions = {
  receipt: ["Know the number before you leave.", "Cash £610, less £188 expected bills and £110 buffer.", "£312 estimated Safe to Spend until payday. Fictional example."],
  friday: ["Friday?", "Check what is yours to spend. Tonight’s plan: drinks after work.", "Start with your number. Estimated Safe to Spend: £312. Fictional example."],
  calendar: ["October, in view.", "£188 energy payment expected on 18 October. Payday: 30 October.", "See upcoming payments and individual account gaps. Fictional example."],
};
for (const [direction, lines] of Object.entries(captions)) writeFileSync(path.join(out, `${direction}.vtt`), `WEBVTT\n\n00:00.000 --> 00:03.000\n${lines[0]}\n\n00:03.000 --> 00:07.000\n${lines[1]}\n\n00:07.000 --> 00:12.000\n${lines[2]}\n`);

if (process.argv.includes("--prepare")) process.exit(0);

const indexOnly = process.argv.includes("--index-only");
const selected = process.argv.slice(2).filter((x) => x !== "--index-only");
const jobs = ["receipt", "friday", "calendar"].flatMap((direction) => ["light", "dark"].map((theme) => ({ direction, theme })));
for (const { direction, theme } of jobs) {
  if (selected.length && !selected.includes(`${direction}-${theme}`)) continue;
  const file = `${direction}-${theme}.mp4`;
  if (!indexOnly) {
    const result = spawnSync("npx", ["--no-install", "remotion", "render", "remotion/c22-crafted/index.tsx", `Craft-${direction}-${theme}`, path.join(out, file), "--codec=h264", "--concurrency=2", "--browser-executable=/usr/bin/google-chrome", "--x264-preset=fast", "--crf=20", "--log=error"], { cwd: frontend, stdio: "inherit" });
    if (result.status !== 0) throw new Error(`Rendering ${file} failed`);
  }
  console.log(`Rendered ${file}`);
}

function probe(file) {
  const result = spawnSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", path.join(out, file)], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`ffprobe ${file}: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  const video = data.streams.find((stream) => stream.codec_type === "video");
  if (video?.codec_name !== "h264" || video.width !== 1080 || video.height !== 1920 || video.avg_frame_rate !== "30/1" || !["yuv420p", "yuvj420p"].includes(video.pix_fmt) || Math.abs(Number(data.format.duration) - 12) > .04 || data.streams.some((stream) => stream.codec_type === "audio")) throw new Error(`Invalid movie: ${file}`);
  return { width: video.width, height: video.height, duration: Number(data.format.duration), fps: 30, codec: video.codec_name, pixelFormat: video.pix_fmt, audio: "silent" };
}


const stills = JSON.parse(readFileSync(path.join(out, "still-assets.json"), "utf8"));
const metadata = (file) => ({ file, bytes: statSync(path.join(out, file)).size, sha256: createHash("sha256").update(readFileSync(path.join(out, file))).digest("hex") });
const movies = jobs.map(({ direction, theme }) => ({ ...metadata(`${direction}-${theme}.mp4`), kind: "film", direction, theme, ...probe(`${direction}-${theme}.mp4`), source: "frontend/remotion/c22-crafted/index.tsx", data: "fictional", status: "review-draft" }));
const origin = { kind: "scene", source: "marketing/c22-crafted/render_receipt.py", renderer: "Blender 4.5.3 LTS / Cycles", generatedBy: "authored geometry, materials, lighting and text", data: "fictional", width: 1080, height: 1350, status: "review-draft" };
const ancillary = ["receipt.vtt", "friday.vtt", "calendar.vtt", ...readdirSync(path.join(out, "fonts")).map((name) => `fonts/${name}`)].map((file) => ({ ...metadata(file), kind: file.endsWith(".vtt") ? "captions" : "font-resource", source: file.startsWith("fonts/Figtree") ? "https://github.com/google/fonts/tree/main/ofl/figtree" : file.startsWith("fonts/JetBrains") ? "https://github.com/google/fonts/tree/main/ofl/jetbrainsmono" : "marketing/c22-crafted/render_films.mjs" }));
const assets = [...stills, ...movies, { ...metadata("receipt-scene.png"), ...origin }, ...ancillary];
writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ item: "C22", round: "crafted", date: "2026-10-22", status: "creative-review-only", assets }, null, 2) + "\n");
console.log(`Verified ${stills.length} production/still PNGs, ${movies.length} films, scene, captions and fonts.`);
