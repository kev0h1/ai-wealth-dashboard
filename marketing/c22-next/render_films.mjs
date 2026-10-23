// Local frame-driven edits. Run after proofs and stills have been frozen.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const frontend = path.join(root, "frontend");
const out = path.join(frontend, "public/design-media/c22/next");
const text = {
  balance: ["£610 in the bank. But what is yours to spend?", "£610 cash, less £188 expected bills, less £110 buffer. £312 estimated.", "The calculation is shown in the app.", "Estimated Safe to Spend, until 30 October 2026.", "Sorted. See what is yours to spend. Coming soon."],
  account: ["£610 across two current accounts. Bills leave one account.", "Everyday £542. Bills account £68. Expected energy payment £188.", "£188 minus £68 leaves a £120 shortfall. Expected 18 October 2026.", "Sorted shows the account that needs attention. No money is moved.", "Sorted. Before the next bill. Explore Sorted."],
};
const times = ["00:00.000", "00:02.167", "00:04.667", "00:07.500", "00:11.833", "00:15.000"];
for (const [story, lines] of Object.entries(text)) {
  writeFileSync(path.join(out, `${story}.vtt`), `WEBVTT\n\nNOTE Fictional example. Instrumental sound cues only; all information is also on screen.\n\n${lines.map((line, i) => `${times[i]} --> ${times[i + 1]}\n${line}`).join("\n\n")}\n`);
}

const indexOnly = process.argv.includes("--index-only");
const selected = process.argv.slice(2).filter((x) => x !== "--index-only");
const jobs = ["balance", "account"].flatMap((story) => ["light", "dark"].map((theme) => ({ story, theme })));
for (const { story, theme } of jobs) {
  if (selected.length && !selected.includes(`${story}-${theme}`)) continue;
  if (!indexOnly) {
    const result = spawnSync("npx", ["--no-install", "remotion", "render", "remotion/c22-next/index.tsx", `Next-${story}-${theme}`, path.join(out, `${story}-${theme}.mp4`), "--codec=h264", "--audio-codec=aac", "--concurrency=2", "--browser-executable=/usr/bin/google-chrome", "--x264-preset=fast", "--crf=18", "--log=error"], { cwd: frontend, stdio: "inherit" });
    if (result.status !== 0) throw new Error(`Rendering ${story}-${theme} failed`);
  }
  const frame = story === "balance" ? "9.5" : "8.5";
  const still = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", frame, "-i", path.join(out, `${story}-${theme}.mp4`), "-frames:v", "1", "-q:v", "2", path.join(out, `${story}-${theme}-poster.jpg`)], { stdio: "inherit" });
  if (still.status !== 0) throw new Error("Poster extraction failed");
  console.log(`Rendered ${story}-${theme}`);
}
if (selected.length) process.exit(0);

const metadata = (file) => ({ file, bytes: statSync(path.join(out, file)).size, sha256: createHash("sha256").update(readFileSync(path.join(out, file))).digest("hex") });
const proof = JSON.parse(readFileSync(path.join(out, "proof-assets.json"), "utf8"));
const stills = JSON.parse(readFileSync(path.join(out, "still-assets.json"), "utf8"));
const movies = jobs.map(({ story, theme }) => ({ ...metadata(`${story}-${theme}.mp4`), kind: "film", story, theme, width: 1080, height: 1920, duration: 15, fps: 30, audio: "original sound design, AAC", source: `frontend/remotion/c22-next/${story === "balance" ? "BalanceStory" : "AccountStory"}.tsx`, status: "creative-review-only", data: "fictional" }));
const ancillary = [...jobs.map(({ story, theme }) => `${story}-${theme}-poster.jpg`), "balance.vtt", "account.vtt", "balance-sound.wav", "account-sound.wav"].map((file) => ({ ...metadata(file), kind: file.endsWith(".vtt") ? "captions" : file.endsWith(".wav") ? "sound" : "video-poster" }));
writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ item: "C22", round: "next", date: "2026-10-22", status: "creative-review-only", productionUIRevision: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(), sourceDependencies: proof[0].productionUI, fonts: { figtree: "../crafted/fonts/Figtree.ttf", mono: "../crafted/fonts/JetBrainsMono.ttf", licences: "../crafted/fonts/" }, assets: [...proof, ...stills, ...movies, ...ancillary] }, null, 2) + "\n");
console.log("Manifest indexed: 12 designed stills, 4 films, 10 production proof captures, sound, captions and posters.");
