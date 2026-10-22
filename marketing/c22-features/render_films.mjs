// Freeze UI captures first. Bundle once, then render one film at a time.
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, statSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const frontend = path.join(root, "frontend");
const out = path.join(frontend, "public/design-media/c22/features");
const require = createRequire(path.join(frontend, "package.json"));
const { bundle } = require("@remotion/bundler");
const { getCompositions, openBrowser, renderMedia } = require("@remotion/renderer");
const lines = {
  movement: ["Right amount. Right account. A suggested £120 move.", "£188 energy payment expected. £68 in the bills account. £120 gap.", "Review the paying account and the gap to cover.", "Sorted suggests a path. You make any transfer in your bank.", "Sorted. See what needs moving. Explore Sorted."],
  month: ["September in review. £200 left after spending and money moved to savings.", "£2,400 income, £1,800 spending and £400 moved to savings.", "What went out: £1,800 of spending.", "£1,600 in the shown categories plus £200 other equals £1,800 spent. £400 moved. £200 left.", "Sorted. Review the month. Keep the context. Explore Sorted."],
  spend: ["October so far. £860 out this pay period. Moved money is separate.", "£860 out, £850 usual pace, £2,400 in and £400 moved.", "The pace at a glance, in the current Spend page.", "The shape in detail. Spending and money moved are shown separately.", "Sorted. See the spend. Keep the pace. Explore Sorted."],
  split: ["A reference, not a verdict. £2,400 take-home pay.", "An adapted 50/30/20 reference: £1,200 Fixed, £720 Free, £480 Moved.", "The reference beside your actual month.", "Actual: £1,200 Fixed, £600 Free, £400 Moved and £200 Left. A comparison, not a score.", "Sorted. Compare your month. Keep your context. Explore Sorted."],
  penny: ["Ask Penny. Keep the final say. A £200 envelope after you confirm.", "Create a £200 envelope for annual costs. Start with what you want done.", "Review the plan. Confirm to create it. £200 reserved every pay period. No money is moved.", "Done. Your annual costs plan is set up after confirmation.", "Sorted. Let Penny bring the task forward. Explore Sorted."],
  aside: ["Give future costs a place. £200 for annual costs each pay period.", "Name: Annual costs. Each pay period: £200. Source: Everyday account.", "Review your set-aside before saving. This does not move money.", "Annual costs is in your plan. You control any bank transfer.", "Sorted. Make room for what is ahead. Explore Sorted."],
};
function stamp(frames) {
  const ms = Math.round(frames / 30 * 1000);
  return `00:${String(Math.floor(ms / 1000)).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}
for (const [story, text] of Object.entries(lines)) {
  const boundaries = [0, 65, 140, story === "penny" ? 260 : 225, 355, 450];
  writeFileSync(path.join(out, `${story}.vtt`), `WEBVTT\n\nNOTE Fictional example. Original instrumental cues; all information is also on screen.\n\n${text.map((line, i) => `${stamp(boundaries[i])} --> ${stamp(boundaries[i + 1])}\n${line}`).join("\n\n")}\n`);
}
const jobs = Object.keys(lines).flatMap(story => ["light", "dark"].map(theme => ({ story, theme })));
const indexOnly = process.argv.includes("--index-only");
const resume = process.argv.includes("--resume");
const selected = process.argv.slice(2).filter(x => !["--index-only", "--resume"].includes(x));
const complete = job => {
  const result = spawnSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", path.join(out, `${job.story}-${job.theme}.mp4`)], { encoding: "utf8" });
  if (result.status !== 0) return false;
  const streams = JSON.parse(result.stdout).streams;
  return streams.some(s => s.codec_type === "video" && Number(s.nb_frames) === 450) && streams.some(s => s.codec_name === "aac");
};
const pending = jobs.filter(job => (!selected.length || selected.includes(`${job.story}-${job.theme}`)) && (!resume || !complete(job)));
const temporary = mkdtempSync(path.join(os.tmpdir(), "c22-feature-films-"));
try {
  if (!indexOnly) {
    const serveUrl = await bundle({ entryPoint: path.join(frontend, "remotion/c22-features/index.tsx"), rootDir: frontend, publicDir: path.join(frontend, "public"), outDir: path.join(temporary, "bundle"), symlinkPublicDir: true });
    const browser = await openBrowser("chrome", { browserExecutable: "/usr/bin/google-chrome" });
    try {
      const compositions = await getCompositions(serveUrl, { puppeteerInstance: browser, browserExecutable: "/usr/bin/google-chrome" });
      async function worker() {
        while (pending.length) {
          const { story, theme } = pending.shift();
          const id = `Feature-${story}-${theme}`;
          const composition = compositions.find(c => c.id === id);
          if (!composition) throw new Error(`Missing composition ${id}`);
          console.log(`Rendering ${id}`);
          await renderMedia({ composition, serveUrl, puppeteerInstance: browser, browserExecutable: "/usr/bin/google-chrome", outputLocation: path.join(out, `${story}-${theme}.mp4`), codec: "h264", audioCodec: "aac", crf: 18, x264Preset: "fast", concurrency: 2, imageFormat: "jpeg", logLevel: "error", ffmpegOverride: ({ args }) => [...args.slice(0, -1), "-threads", "2", args.at(-1)] });
          console.log(`Rendered ${id}`);
        }
      }
      await worker();
    } finally { await browser.close({ silent: true }); }
  }
  for (const { story, theme } of jobs) {
    if (selected.length && !selected.includes(`${story}-${theme}`)) continue;
    const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", story === "penny" ? "9.5" : "8.5", "-i", path.join(out, `${story}-${theme}.mp4`), "-frames:v", "1", "-q:v", "2", path.join(out, `${story}-${theme}-poster.jpg`)], { stdio: "inherit" });
    if (result.status !== 0) throw new Error("Poster extraction failed");
  }
} finally { rmSync(temporary, { recursive: true, force: true }); }
if (selected.length) process.exit(0);

const hash = file => createHash("sha256").update(readFileSync(file)).digest("hex");
const metadata = file => ({ file, bytes: statSync(path.join(out, file)).size, sha256: hash(path.join(out, file)) });
const proof = JSON.parse(readFileSync(path.join(out, "proof-assets.json"), "utf8"));
const stills = JSON.parse(readFileSync(path.join(out, "still-assets.json"), "utf8"));
const movies = jobs.map(({ story, theme }) => ({ ...metadata(`${story}-${theme}.mp4`), kind: "film", story, theme, width: 1080, height: 1920, duration: 15, fps: 30, audio: "original sound design, AAC", source: "frontend/remotion/c22-features/FeatureFilm.tsx", status: "creative-review-only", data: "fictional" }));
const ancillary = [...jobs.map(({ story, theme }) => `${story}-${theme}-poster.jpg`), ...Object.keys(lines).flatMap(story => [`${story}.vtt`, `${story}-sound.wav`])].map(file => ({ ...metadata(file), kind: file.endsWith(".vtt") ? "captions" : file.endsWith(".wav") ? "sound" : "video-poster" }));
const sources = ["frontend/remotion/c22-features/FeatureFilm.tsx", "frontend/remotion/c22-features/index.tsx", "frontend/remotion/c22-features/film.css", "frontend/app/design/marketing-kit/features/FeaturePoster.tsx", "frontend/app/design/marketing-kit/features/feature-poster.module.css", "frontend/app/design/marketing-kit/features/catalog.ts", "marketing/c22-features/export_round.py", "marketing/c22-features/sound_design.py", "marketing/c22-features/render_films.mjs"];
writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ item: "C22", round: "features", date: "2026-10-22", status: "creative-review-only", productionUIRevision: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(), sourceDependencies: { ...proof[0].productionUI, ...Object.fromEntries(sources.map(file => [file, hash(path.join(root, file))])) }, previousRound: "../next/manifest.json", fonts: { figtree: "../crafted/fonts/Figtree.ttf", mono: "../crafted/fonts/JetBrainsMono.ttf", licences: "../crafted/fonts/" }, assets: [...proof, ...stills, ...movies, ...ancillary] }, null, 2) + "\n");
console.log("Indexed: 24 new PNGs, 12 films, 30 product captures, sound, captions and posters.");
