import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const site = dirname(dirname(fileURLToPath(import.meta.url)));
const destination = join(dirname(site), 'frontend/public/design/sorted-website');
await rm(destination, { recursive: true, force: true });
await mkdir(dirname(destination), { recursive: true });
await cp(join(site, 'dist'), destination, { recursive: true });
