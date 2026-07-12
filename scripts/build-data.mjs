// Bakes data/museum-data.json into public/data/museum-data.json (minified),
// so the built site is fully static — no API server needed at runtime.
// Runs via the predev/prebuild hooks; vite copies public/ into dist/.

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const data = JSON.parse(await readFile(path.join(ROOT, 'data', 'museum-data.json'), 'utf8'));
const periods = data.periods?.length ?? 0;
const artists = data.periods?.reduce((s, p) => s + p.artists.length, 0) ?? 0;
if (!periods || !artists) throw new Error('museum-data.json looks empty — run the ETL first');

const outDir = path.join(ROOT, 'public', 'data');
await mkdir(outDir, { recursive: true });
const json = JSON.stringify(data);
await writeFile(path.join(outDir, 'museum-data.json'), json);
console.log(`static data: ${periods} periods · ${artists} artists → public/data/museum-data.json (${(json.length / 1e6).toFixed(1)} MB)`);
