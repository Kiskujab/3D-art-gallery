// Enrich pass: Hungarian Wikipedia extracts for artists.
// Reads data/museum-data.json (the etl/fetch.mjs output), resolves each
// artist's huwiki article via Wikidata sitelinks (batched, 50/request),
// fetches the Hungarian REST summary, and writes bio_hu / description_hu /
// wikipedia_url_hu back into museum-data.json. Nothing is generated — the
// text is the huwiki article's own summary.
//
// Run AFTER `npm run etl` (fetch.mjs rewrites museum-data.json without these
// fields). Per-artist results — including "no huwiki article" — are cached
// in data/cache/hu/<slug>.json, so re-runs are fast and API-polite.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = path.join(ROOT, 'data', 'museum-data.json');
const CACHE = path.join(ROOT, 'data', 'cache', 'hu');

const UA = 'ArtHistoryMuseum/1.0 (personal educational project; https://github.com/Kiskujab/3D-art-gallery)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(1500 * (i + 1));
    }
  }
}

async function readCache(slug) {
  const p = path.join(CACHE, `${slug}.json`);
  if (!existsSync(p)) return undefined;
  return JSON.parse(await readFile(p, 'utf8'));
}

const writeCache = (slug, obj) =>
  writeFile(path.join(CACHE, `${slug}.json`), JSON.stringify(obj, null, 1));

async function main() {
  await mkdir(CACHE, { recursive: true });
  const data = JSON.parse(await readFile(DATA, 'utf8'));
  const artists = data.periods.flatMap((p) => p.artists);

  // apply cache; collect the artists that still need a lookup
  const todo = [];
  for (const a of artists) {
    const cached = await readCache(a.slug);
    if (cached === undefined) todo.push(a);
    else Object.assign(a, cached); // {} = cached "no huwiki article"
  }
  console.log(`${artists.length} artists, ${todo.length} to fetch (rest cached).`);

  // huwiki article titles via Wikidata sitelinks, 50 qids per request
  const titleByQid = new Map();
  const qids = todo.map((a) => a.qid).filter(Boolean);
  for (let i = 0; i < qids.length; i += 50) {
    const batch = qids.slice(i, i + 50);
    const json = await fetchJson(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${batch.join('|')}` +
      '&props=sitelinks&sitefilter=huwiki&format=json&origin=*'
    );
    for (const [qid, ent] of Object.entries(json?.entities ?? {})) {
      const title = ent?.sitelinks?.huwiki?.title;
      if (title) titleByQid.set(qid, title);
    }
    await sleep(500);
  }

  // Hungarian REST summary per artist
  let fetched = 0;
  for (const a of todo) {
    const title = titleByQid.get(a.qid);
    let out = {};
    if (title) {
      const urlTitle = encodeURIComponent(title.replace(/ /g, '_'));
      const sum = await fetchJson(`https://hu.wikipedia.org/api/rest_v1/page/summary/${urlTitle}`);
      await sleep(250);
      if (sum?.extract) {
        out = {
          bio_hu: sum.extract,
          description_hu: sum.description ?? '',
          wikipedia_url_hu: sum.content_urls?.desktop?.page
            ?? `https://hu.wikipedia.org/wiki/${urlTitle}`,
        };
        fetched++;
      }
    }
    Object.assign(a, out);
    await writeCache(a.slug, out);
    console.log(`${a.slug}: ${out.bio_hu ? 'hu ok' : '-'}`);
  }

  await writeFile(DATA, JSON.stringify(data, null, 1));
  const total = artists.filter((x) => x.bio_hu).length;
  console.log(`Hungarian extracts: ${total}/${artists.length} artists (${fetched} newly fetched).`);
}

main().catch((e) => { console.error('enrich-hu failed:', e.message); process.exit(1); });
