// Shared data gathering for the /design preview inventory (H113) and the
// stale check. Plain Node, no deps. Imported by design-preview-inventory.mjs
// and check-design-stale.mjs; not a check itself.
//
// Matching rules, kept deliberately simple so the result is explainable:
//   - a board item "references" a preview if its TODO.md block (the item line
//     plus its continuation lines) contains `design/<slug>` as a path, or, for
//     slugs that contain a hyphen, the bare slug as a whole token (not part of
//     a longer hyphenated word). One-word slugs (for example `reconnect`) are
//     path-form only, otherwise ordinary prose would match.
//   - states come from `scripts/backlog.py list`; if Python or the venv is not
//     available the checkbox in TODO.md is used instead ([x] = done, otherwise
//     open), and cancelled items cannot be told apart.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const frontendRoot = path.resolve(__dirname, "..");
export const repoRoot = path.resolve(frontendRoot, "..");
export const designDir = path.join(frontendRoot, "app", "design");

export const DONE_STATES = new Set(["done", "cancelled"]);
export const STALE_DAYS = 7;

const SKIP_DIRS = new Set(["_components"]);

export function listPreviewSlugs() {
  return readdirSync(designDir)
    .filter((e) => {
      if (SKIP_DIRS.has(e)) return false;
      return statSync(path.join(designDir, e)).isDirectory();
    })
    .sort();
}

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
    ...opts,
  });
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// slug -> RegExp matching a reference to it in prose.
export function slugRegex(slug) {
  const p = `design/${escapeRe(slug)}(?![\\w-])`;
  if (slug.includes("-")) {
    return new RegExp(`${p}|(?<![\\w-])${escapeRe(slug)}(?![\\w-])`);
  }
  return new RegExp(p);
}

// { id -> state } from the board CLI, with a TODO.md fallback.
export function loadBoardStates(blocks) {
  const states = new Map();
  const py = path.join(repoRoot, "backend", ".venv", "bin", "python");
  try {
    if (!existsSync(py)) throw new Error("no venv");
    const out = sh(py, ["scripts/backlog.py", "list"]);
    for (const line of out.split("\n").slice(1)) {
      const m = line.match(/^([A-Z]\d+)\s+(\S+)\s+(p\d)\s+(\S+)/);
      if (m) states.set(m[1], m[4].split(":")[0]);
    }
    if (states.size === 0) throw new Error("empty list");
  } catch {
    for (const b of blocks) states.set(b.id, b.checked ? "done" : "open");
  }
  return states;
}

// Item blocks from TODO.md: "- [x] **G12. title**" plus continuation lines.
export function loadTodoBlocks() {
  const text = readFileSync(path.join(repoRoot, "TODO.md"), "utf8").split("\n");
  const blocks = [];
  let cur = null;
  for (const line of text) {
    const m = line.match(/^- \[(.)\] \*\*([A-Z]\d+)\./);
    if (m) {
      cur = { id: m[2], checked: m[1] === "x", text: line };
      blocks.push(cur);
    } else if (/^#{1,6} /.test(line)) {
      cur = null;
    } else if (cur) {
      cur.text += "\n" + line;
    }
  }
  return blocks;
}

function walkFiles(dir, test, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(full, test, out);
    else if (test(e.name)) out.push(full);
  }
  return out;
}

export function lastCommitDate(slug) {
  try {
    const d = sh("git", ["log", "-1", "--format=%cs", "--", path.join("frontend", "app", "design", slug)]).trim();
    return d || null;
  } catch {
    return null;
  }
}

export function ageDays(isoDate, now = new Date()) {
  if (!isoDate) return Infinity;
  return Math.floor((now.getTime() - new Date(isoDate + "T00:00:00Z").getTime()) / 86400000);
}

export function referencingItems(slug, blocks, states) {
  const re = slugRegex(slug);
  return blocks
    .filter((b) => re.test(b.text))
    .map((b) => ({ id: b.id, state: states.get(b.id) || (b.checked ? "done" : "open") }));
}

// Slug-level facts that need file scans (production imports, outside importers,
// compliance docs, marketing assets).
export function scanFacts(slugs) {
  const read = (f) => ({ f, t: readFileSync(f, "utf8") });
  const complianceText = walkFiles(path.join(repoRoot, "docs", "compliance"), (n) => /\.(md|html|css|txt|json)$/.test(n)).map(read);
  const mediaFiles = walkFiles(path.join(frontendRoot, "public", "design-media"), () => true);
  const mediaDocs = [path.join(repoRoot, "docs", "design", "c22-marketing-kit.md")].filter(existsSync).map(read);

  const outside = [];
  const walkSrc = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (["node_modules", ".next", ".next-prev", "public", "out", "ios", "android"].includes(e.name)) continue;
      const full = path.join(d, e.name);
      if (full === designDir) continue;
      if (e.isDirectory()) walkSrc(full);
      else if (/\.(ts|tsx|mjs)$/.test(e.name)) outside.push(full);
    }
  };
  walkSrc(frontendRoot);
  const toolingRe = /design-preview-inventory|check-design-|_design-preview-data/;
  const outsideText = outside.filter((f) => !toolingRe.test(f)).map(read).filter((x) => x.t.includes("design/"));

  const facts = new Map();
  for (const slug of slugs) {
    const files = walkFiles(path.join(designDir, slug), (n) => /\.(ts|tsx)$/.test(n));
    const src = files.map((f) => readFileSync(f, "utf8")).join("\n");
    const rendersProd = /from\s+["'](@\/components|@\/app\/(?!design[\/"'])|(\.\.\/)+components|(\.\.\/)+app\/(?!design[\/"']))/.test(src);

    const re = new RegExp(`design/${escapeRe(slug)}(?![\\w-])`);
    // A real import has the slug path on an import/from/require/dynamic-import line;
    // anything else (comments, docs strings) is only a mention.
    const impRe = new RegExp(`^.*(\\bfrom\\s|\\bimport\\s*\\(|\\bimport\\s+["']|require\\().*design/${escapeRe(slug)}(?![\\w-]).*$`, "m");
    const importers = outsideText.filter((x) => impRe.test(stripComments(x.t))).map((x) => path.relative(repoRoot, x.f));
    const mentions = outsideText.filter((x) => re.test(x.t) && !impRe.test(stripComments(x.t))).map((x) => path.relative(repoRoot, x.f));
    const compliance = complianceText.filter((x) => slugRegex(slug).test(x.t)).map((x) => path.relative(repoRoot, x.f));
    const media = [
      ...mediaFiles.filter((f) => f.includes(`/${slug}/`) || f.includes(`/${slug}.`)).map((f) => path.relative(repoRoot, f)),
      ...mediaDocs.filter((x) => slugRegex(slug).test(x.t)).map((x) => path.relative(repoRoot, x.f)),
    ];
    facts.set(slug, { rendersProd, importers, mentions, compliance, media });
  }
  return facts;
}

// Marketing items whose output lives under /design (G222 to G224, C22).
// Drop block comments, whole-line // comments and trailing // comments so an import
// regex cannot match the word `from` inside prose. Import lines never carry `//`.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .map((l) => l.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
}

export const MARKETING_IDS = new Set(["G222", "G223", "G224", "C22"]);

// Housekeeping items that merely list previews while sweeping them (this prune,
// its predecessor H43, and the G126 em-dash sweep). They are shown in the table
// but do not by themselves keep a preview alive: deleting a preview is the
// outcome those items are about, not work that depends on it.
export const HOUSEKEEPING_IDS = new Set(["H113", "H43", "H44", "G126"]);

function proposeCore({ items, ageD, rendersProd, importers, compliance, media }) {
  items = items.filter((i) => !HOUSEKEEPING_IDS.has(i.id) || DONE_STATES.has(i.state));
  const open = items.filter((i) => !DONE_STATES.has(i.state));
  if (open.length) {
    const marketing = open.some((i) => MARKETING_IDS.has(i.id));
    return { action: "KEEP", reason: `${marketing ? "marketing item" : "open item"} ${open.map((i) => `${i.id} (${i.state})`).join(", ")}` };
  }
  if (compliance.length) return { action: "KEEP", reason: `referenced by compliance docs (${compliance.join(", ")})` };
  if (media.length) return { action: "KEEP", reason: `marketing assets (${media.slice(0, 2).join(", ")})` };
  if (importers.length) return { action: "KEEP", reason: `imported outside app/design (${importers.join(", ")})` };
  const allDone = items.length > 0;
  if (rendersProd && allDone) return { action: "GATE-CANDIDATE", reason: "renders production components; items done or cancelled" };
  if (!rendersProd && ageD > STALE_DAYS) {
    return { action: "DELETE-CANDIDATE", reason: `${allDone ? "items done or cancelled" : "no referencing item"}; hand-authored; ${ageD === Infinity ? "no commit date" : ageD + " days old"}` };
  }
  if (rendersProd) return { action: "UNSURE", reason: "renders production components but no referencing item" };
  return { action: "UNSURE", reason: `hand-authored, only ${ageD} days old, ${allDone ? "items done" : "no referencing item"}` };
}

export function propose(args) {
  const hk = args.items.filter((i) => HOUSEKEEPING_IDS.has(i.id) && !DONE_STATES.has(i.state));
  const r = proposeCore(args);
  return hk.length ? { ...r, reason: r.reason + `; also mentioned by housekeeping ${hk.map((i) => i.id).join(", ")}` } : r;
}

export function gather({ full = true } = {}) {
  const slugs = listPreviewSlugs();
  const blocks = loadTodoBlocks();
  const states = loadBoardStates(blocks);
  const facts = full ? scanFacts(slugs) : new Map();
  return slugs.map((slug) => {
    const items = referencingItems(slug, blocks, states);
    const date = lastCommitDate(slug);
    const f = facts.get(slug) || { rendersProd: false, importers: [], mentions: [], compliance: [], media: [] };
    const ageD = ageDays(date);
    return { slug, items, date, ageD, ...f, ...(full ? propose({ items, ageD, ...f }) : {}) };
  });
}
