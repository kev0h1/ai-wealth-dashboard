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
const { getCompositions, openBrowser, renderStill } = require("@remotion/renderer");
const lines = {
  movement: ["Cover the gap. Keep control. A suggested £120 cover.", "One £188 bill, £68 in Bills, and £80 from Everyday plus £40 from Joint.", "Review the two suggested sources.", "Sorted suggests the route. You make any transfer in your bank.", "Sorted. See what needs moving. Coming soon."],
  month: ["September in review. £200 left after spending and money moved to savings.", "£2,400 income, £1,800 spending and £400 moved to savings.", "What went out: £1,800 of spending.", "£1,600 in the shown categories plus £200 other equals £1,800 spent. £400 moved. £200 left.", "Sorted. Review the month. Coming soon."],
  spend: ["See what changed. See where. £120 above usual by day 10.", "£860 Out against £740 usual. Eating Out is £240 against £120 usual.", "The change, shown plainly.", "The four payments behind Eating Out. £400 moved remains separate from Out.", "Sorted. Know where it goes. Coming soon."],
  split: ["A reference, not a verdict. £2,400 take-home pay.", "An adapted 50/30/20 reference: £1,200 Fixed, £720 Free, £480 Moved.", "The reference beside your actual month.", "Actual: £1,200 Fixed, £600 Free, £400 Moved and £200 Left. A comparison, not a score.", "Sorted. Compare your month. Coming soon."],
  penny: ["Ask Penny. See the picture.", "Ask about spending by category, then read the chart.", "Start with the question you have.", "The chart stays in the conversation. You decide what to do next.", "Sorted. Ask Penny. See the picture. Coming soon."],
  aside: ["Groceries, already allowed for. £250 each pay period.", "Groceries: £250 each pay period. No bank transfer.", "Make room for it in the plan.", "The grocery set-aside is saved. Nothing moves in your bank.", "Sorted. Make room for what is ahead. Coming soon."],
  upcoming: ["Change a payment. Keep it current. £95 boiler service.", "Update £90 due 24 November to £95 due 26 November.", "Create a one-off payment ready to review.", "The new amount and date are clear in Upcoming payments.", "Sorted. Keep upcoming payments current. Coming soon."],
  plans: ["Break it down. Keep the dates. £600 car insurance.", "Three £200 paydays: 30 November, 30 December and 30 January.", "Review the split before it is scheduled.", "Your confirmation schedules the three payday plan.", "Sorted. Plan the cost. Keep the dates. Coming soon."],
  schedule: ["Update the plan. Keep the context. £95 boiler payment.", "Change £90 on 24 November to £95 on 26 November.", "Review the change in the conversation.", "Your confirmation updates the payment schedule.", "Sorted. Keep the plan up to date. Coming soon."],
};
function stamp(frames) {
  const ms = Math.round(frames / 30 * 1000);
  return `00:${String(Math.floor(ms / 1000)).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}
for (const [story, text] of Object.entries(lines)) {
  const boundaries = [0, 90, 180, 270, 360, 450];
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
    const selectionBrowser = await openBrowser("chrome", { browserExecutable: "/usr/bin/google-chrome" });
    let compositions;
    try {
      compositions = await getCompositions(serveUrl, { puppeteerInstance: selectionBrowser, browserExecutable: "/usr/bin/google-chrome" });
    } finally { await selectionBrowser.close({ silent: true }); }
      async function worker() {
        while (pending.length) {
          const { story, theme } = pending.shift();
          const id = `Feature-${story}-${theme}`;
          const composition = compositions.find(c => c.id === id);
          if (!composition) throw new Error(`Missing composition ${id}`);
          console.log(`Rendering ${id}`);
          // A fresh browser bounds renderer resources across a long batch.
          const browser = await openBrowser("chrome", { browserExecutable: "/usr/bin/google-chrome" });
          // These authored edits have five exactly held shots. Render each
          // unique frame once, then encode its full three-second hold.
          // FeatureFilm has no frame-dependent motion inside a stage.
          const frames = [];
          try {
            for (let stage = 0; stage < 5; stage++) {
              const framePath = path.join(temporary, `${story}-${theme}-${stage}.png`);
              await renderStill({ composition, serveUrl, puppeteerInstance: browser, browserExecutable: "/usr/bin/google-chrome", frame: stage * 90, output: framePath, imageFormat: "png", logLevel: "error" });
              frames.push(framePath);
              console.log(`${id}: prepared shot ${stage + 1}/5`);
            }
          } finally { await browser.close({ silent: true }); }
          const sequence = path.join(temporary, `${story}-${theme}-sequence.txt`);
          writeFileSync(sequence, frames.map(file => `file '${file}'\nduration 3\n`).join("") + `file '${frames.at(-1)}'\n`);
          const encode = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-threads", "1", "-filter_threads", "1", "-f", "concat", "-safe", "0", "-i", sequence, "-i", path.join(out, `${story}-sound.wav`), "-vf", "fps=30", "-t", "15", "-c:v", "libx264", "-crf", "18", "-preset", "fast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", "-threads", "2", path.join(out, `${story}-${theme}.mp4`)], { stdio: "inherit" });
          if (encode.status !== 0) throw new Error(`Encoding ${id} failed`);
          console.log(`Rendered ${id}`);
        }
      }
      await worker();
  }
  for (const { story, theme } of jobs) {
    if (selected.length && !selected.includes(`${story}-${theme}`)) continue;
    const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", "9", "-i", path.join(out, `${story}-${theme}.mp4`), "-frames:v", "1", "-q:v", "2", path.join(out, `${story}-${theme}-poster.jpg`)], { stdio: "inherit" });
    if (result.status !== 0) throw new Error("Poster extraction failed");
    // JPEG COM metadata preserves the encoded pixels and carries its origin.
    const posterPath = path.join(out, `${story}-${theme}-poster.jpg`);
    const movieHash = createHash("sha256").update(readFileSync(path.join(out, `${story}-${theme}.mp4`))).digest("hex");
    const origin = Buffer.from(`impeccable:prompt\0Origin: FFmpeg poster from ${story}-${theme}.mp4, SHA-256 ${movieHash}. Fictional Sorted production UI; authored campaign film.`);
    const comment = Buffer.alloc(4); comment[0] = 0xff; comment[1] = 0xfe; comment.writeUInt16BE(origin.length + 2, 2);
    const posterBytes = readFileSync(posterPath);
    writeFileSync(posterPath, Buffer.concat([posterBytes.subarray(0, 2), comment, origin, posterBytes.subarray(2)]));
  }
} finally { rmSync(temporary, { recursive: true, force: true }); }
if (selected.length) process.exit(0);

const hash = file => createHash("sha256").update(readFileSync(file)).digest("hex");
const metadata = file => ({ file, bytes: statSync(path.join(out, file)).size, sha256: hash(path.join(out, file)) });
const proof = JSON.parse(readFileSync(path.join(out, "proof-assets.json"), "utf8"));
const stills = JSON.parse(readFileSync(path.join(out, "still-assets.json"), "utf8"));
const movies = jobs.map(({ story, theme }) => ({ ...metadata(`${story}-${theme}.mp4`), kind: "film", story, theme, width: 1080, height: 1920, duration: 15, fps: 30, audio: "original sound design, AAC", source: "frontend/remotion/c22-features/FeatureFilm.tsx", status: "creative-review-only", data: "fictional" }));
const ancillary = [...jobs.map(({ story, theme }) => `${story}-${theme}-poster.jpg`), ...Object.keys(lines).flatMap(story => [`${story}.vtt`, `${story}-sound.wav`])].map(file => ({ ...metadata(file), kind: file.endsWith(".vtt") ? "captions" : file.endsWith(".wav") ? "sound" : "video-poster" }));
const sources = ["marketing/c22-capabilities/finalise_provenance.py", "frontend/remotion/c22-features/FeatureFilm.tsx", "frontend/remotion/c22-features/index.tsx", "frontend/remotion/c22-features/film.css", "frontend/app/design/marketing-kit/features/FeaturePoster.tsx", "frontend/app/design/marketing-kit/features/feature-poster.module.css", "frontend/app/design/marketing-kit/features/catalog.ts", "marketing/c22-features/export_round.py", "marketing/c22-features/sound_design.py", "marketing/c22-features/render_films.mjs"];
writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ item: "C22", round: "features", date: "2026-11-11", status: "creative-review-only", productionUIRevision: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(), sourceDependencies: { ...proof[0].productionUI, ...Object.fromEntries(sources.map(file => [file, hash(path.join(root, file))])) }, previousRound: "../next/manifest.json", fonts: { figtree: "../crafted/fonts/Figtree.ttf", mono: "../crafted/fonts/JetBrainsMono.ttf", licences: "../crafted/fonts/" }, assets: [...proof, ...stills, ...movies, ...ancillary] }, null, 2) + "\n");
console.log("Indexed: 36 new PNGs, 18 films, product captures, sound, captions and posters.");
