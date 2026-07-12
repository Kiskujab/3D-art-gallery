// Enrich pass: painting genres (P136) + depicted subjects (P180) and artist
// gender (P21) from Wikidata, for the museum's thematic tours. Labels come
// from Wikidata in English (theme predicates match English keywords).
//
// Run AFTER `npm run etl` and (order among enrich passes doesn't matter,
// but they must not run concurrently — both rewrite museum-data.json).
// All results are cached in data/cache/enrich-genres.json; re-runs only
// fetch qids that are new since the last run.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = path.join(ROOT, 'data', 'museum-data.json');
const CACHE = path.join(ROOT, 'data', 'cache', 'enrich-genres.json');

const UA = 'ArtHistoryMuseum/1.0 (personal educational project; https://github.com/Kiskujab/3D-art-gallery)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_DEPICTS = 12;

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

async function sparql(query) {
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
  const json = await fetchJson(url);
  return json?.results?.bindings ?? [];
}

// P21 values → the two labels the client themes need; anything else → null
const GENDER = { Q6581072: 'female', Q1052281: 'female', Q6581097: 'male', Q2449503: 'male' };

async function main() {
  await mkdir(path.dirname(CACHE), { recursive: true });
  const cache = existsSync(CACHE)
    ? JSON.parse(await readFile(CACHE, 'utf8'))
    : { paintings: {}, artists: {} };
  const data = JSON.parse(await readFile(DATA, 'utf8'));
  const artists = data.periods.flatMap((p) => p.artists);
  const paintings = artists.flatMap((a) => a.paintings);

  // ---- paintings: P136 genre + P180 depicts labels via batched SPARQL ----
  const pQids = [...new Set(paintings.map((w) => w.qid).filter(Boolean))]
    .filter((qid) => !cache.paintings[qid]);
  console.log(`${paintings.length} paintings, ${pQids.length} qids to query (rest cached).`);
  for (let i = 0; i < pQids.length; i += 100) {
    const batch = pQids.slice(i, i + 100);
    const rows = await sparql(`
      SELECT ?item ?genreLabel ?depictLabel WHERE {
        VALUES ?item { ${batch.map((q) => `wd:${q}`).join(' ')} }
        OPTIONAL { ?item wdt:P136 ?genre. }
        OPTIONAL { ?item wdt:P180 ?depict. }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      }`);
    const acc = new Map(batch.map((q) => [q, { genres: new Set(), depicts: new Set() }]));
    for (const r of rows) {
      const qid = r.item?.value?.split('/').pop();
      const slot = acc.get(qid);
      if (!slot) continue;
      const g = r.genreLabel?.value, d = r.depictLabel?.value;
      if (g && !/^Q\d+$/.test(g)) slot.genres.add(g);
      if (d && !/^Q\d+$/.test(d)) slot.depicts.add(d);
    }
    for (const [qid, slot] of acc) {
      cache.paintings[qid] = {
        genres: [...slot.genres],
        depicts: [...slot.depicts].slice(0, MAX_DEPICTS),
      };
    }
    await writeFile(CACHE, JSON.stringify(cache));
    console.log(`paintings ${Math.min(i + 100, pQids.length)}/${pQids.length}`);
    await sleep(1000);
  }

  // ---- artists: P21 gender via wbgetentities, 50 qids per request ----
  const aQids = [...new Set(artists.map((a) => a.qid).filter(Boolean))]
    .filter((qid) => !(qid in cache.artists));
  for (let i = 0; i < aQids.length; i += 50) {
    const batch = aQids.slice(i, i + 50);
    const json = await fetchJson(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${batch.join('|')}` +
      '&props=claims&format=json&origin=*'
    );
    for (const [qid, ent] of Object.entries(json?.entities ?? {})) {
      const v = ent?.claims?.P21?.[0]?.mainsnak?.datavalue?.value?.id;
      cache.artists[qid] = GENDER[v] ?? null;
    }
    await writeFile(CACHE, JSON.stringify(cache));
    console.log(`artists ${Math.min(i + 50, aQids.length)}/${aQids.length}`);
    await sleep(500);
  }

  // ---- write everything back into museum-data.json ----
  let withGenres = 0, withDepicts = 0, women = 0;
  for (const a of artists) {
    a.gender = cache.artists[a.qid] ?? null;
    if (a.gender === 'female') women++;
    for (const w of a.paintings) {
      const hit = w.qid ? cache.paintings[w.qid] : null;
      w.genres = hit?.genres ?? [];
      w.depicts = hit?.depicts ?? [];
      if (w.genres.length) withGenres++;
      if (w.depicts.length) withDepicts++;
    }
  }
  await writeFile(DATA, JSON.stringify(data, null, 1));
  console.log(`genres on ${withGenres}, depicts on ${withDepicts} of ${paintings.length} paintings; ${women} women artists.`);
}

main().catch((e) => { console.error('enrich-genres failed:', e.message); process.exit(1); });
