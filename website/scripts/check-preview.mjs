import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(dirname(root), 'frontend/public/design/sorted-website');
const recordPath = join(root, 'preview-manifest.json');
async function files(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await files(path)); else result.push(path);
  }
  return result.sort();
}
const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const sources = [...await files(join(root, 'src')), ...await files(join(root, 'public')), join(root, 'scripts/build.mjs')].sort();
const outputs = await files(output);
const snapshot = { sources: {}, outputs: {} };
for (const path of sources) snapshot.sources[relative(root, path)] = await hash(path);
for (const path of outputs) {
  snapshot.outputs[relative(output, path)] = await hash(path);
  if (path.endsWith('.html')) {
    const html = await readFile(path, 'utf8');
    assert.doesNotMatch(html, /<form\b|<script\b|<iframe\b|\bon\w+\s*=/i, `${path}: no collection or runtime script`);
    assert.doesNotMatch(html, /[—–]/, `${path}: copy uses British punctuation`);
    assert.match(html, /noindex,nofollow/, `${path}: design proposals stay unindexed`);
  }
}
if (process.argv.includes('--record')) await writeFile(recordPath, JSON.stringify(snapshot, null, 2) + '\n');
else assert.deepEqual(snapshot, JSON.parse(await readFile(recordPath, 'utf8')), 'C35 review copy drifted: rebuild, export and record it');
console.log('C35: static preview matches its source, with no forms, scripts or stale review assets');
