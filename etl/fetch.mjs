// ETL: pulls all periods, artists and paintings from Wikipedia, Wikidata and
// Wikimedia Commons into data/museum-data.json. No content is generated —
// bios, dates, stories and fun facts are extracted verbatim from Wikipedia
// article text; images come from Commons (public domain / free) with a
// per-painting license label, falling back to the English Wikipedia article
// image for 20th-century works Commons cannot host.
//
// Resumable: per-artist results are cached in data/cache/.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERIODS } from './seed.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CACHE = path.join(ROOT, 'data', 'cache');
const OUT = path.join(ROOT, 'data', 'museum-data.json');

const UA = 'ArtHistoryMuseum/1.0 (personal educational project; https://github.com/Kiskujab/3D-art-gallery)';
const MIN_PAINTINGS = 8;
const MAX_PAINTINGS = 14;

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

const enwiki = (params) =>
  fetchJson(`https://en.wikipedia.org/w/api.php?format=json&formatversion=2&origin=*&${params}`);
const commons = (params) =>
  fetchJson(`https://commons.wikimedia.org/w/api.php?format=json&formatversion=2&origin=*&${params}`);

async function sparql(query) {
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
  const json = await fetchJson(url);
  return json?.results?.bindings ?? [];
}

const slugify = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const displayName = (title) => title.replace(/\s*\(.*\)$/, '');

function parseWikidataYear(claim) {
  const t = claim?.mainsnak?.datavalue?.value?.time;
  if (!t) return null;
  const m = t.match(/^([+-])(\d{4,})/);
  if (!m) return null;
  return (m[1] === '-' ? -1 : 1) * parseInt(m[2], 10);
}

// ---------- text extraction (verbatim Wikipedia sentences) ----------

function splitSentences(text) {
  // conservative splitter that survives "c. 1503", "St. Anne", initials, etc.
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z"“(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const FACT_HINTS = /\b(stole|stolen|theft|record|auction|sold|million|X-ray|x-ray|hidden|beneath|discover|vandal|attack|slashed|forger|forgery|restor|damage|lost|rediscover|myster|legend|refus|reject|scandal|controvers|smuggl|ransom|copy|version|largest|smallest|first|only|never|secret|underneath|infrared|pigment|commission|banned|censor)\b/i;

function extractFacts(fullText, introText, max = 4) {
  const body = fullText.startsWith(introText.slice(0, 200))
    ? fullText.slice(introText.length)
    : fullText;
  const sentences = splitSentences(body).filter(
    (s) => s.length >= 70 && s.length <= 320 && !/^==/.test(s) && !/\bISBN|\bRetrieved|\bpp?\./.test(s)
  );
  const hinted = sentences.filter((s) => FACT_HINTS.test(s));
  const picked = [];
  for (const s of [...hinted, ...sentences]) {
    if (picked.length >= max) break;
    if (!picked.includes(s)) picked.push(s);
  }
  return picked;
}

function cleanExtract(text, maxChars = 900) {
  if (!text) return '';
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= maxChars) return t;
  const cut = t.slice(0, maxChars);
  return cut.slice(0, cut.lastIndexOf('. ') + 1) || cut;
}

// ---------- artist-level fetchers ----------

async function getPageBasics(title) {
  const json = await fetchJson(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`
  );
  if (!json) return null;
  return {
    title: json.title,
    description: json.description ?? '',
    extract: json.extract ?? '',
    thumb: json.thumbnail?.source ?? null,
    image: json.originalimage?.source ?? null,
    url: json.content_urls?.desktop?.page ?? '',
    qid: json.wikibase_item ?? null,
  };
}

async function getArtistDates(qid) {
  const json = await fetchJson(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims&format=json&origin=*`
  );
  const claims = json?.entities?.[qid]?.claims ?? {};
  const first = (p) => claims[p]?.[0];
  return {
    birth: parseWikidataYear(first('P569')),
    death: parseWikidataYear(first('P570')),
    workStart: parseWikidataYear(first('P2031')),
    workEnd: parseWikidataYear(first('P2032')),
  };
}

async function getPaintingCandidates(qid) {
  // paintings first-class, but also murals / prints / collages / street art so
  // 20th-century artists whose famous works aren't oil-on-canvas still surface
  const rows = await sparql(`
    SELECT ?p ?pLabel ?image ?inception ?article ?links WHERE {
      VALUES ?cls { wd:Q3305213 wd:Q219423 wd:Q99516640 wd:Q11060274 wd:Q22569957
                    wd:Q15727816 wd:Q22669857 wd:Q110304307 wd:Q504073 wd:Q17516 }
      ?p wdt:P31 ?cls ; wdt:P170 wd:${qid} .
      ?p wikibase:sitelinks ?links .
      OPTIONAL { ?p wdt:P18 ?image . }
      OPTIONAL { ?p wdt:P571 ?inception . }
      OPTIONAL { ?article schema:about ?p ; schema:isPartOf <https://en.wikipedia.org/> . }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
    } ORDER BY DESC(?links) LIMIT 60`);
  const byId = new Map();
  for (const r of rows) {
    const id = r.p.value.split('/').pop();
    const cur = byId.get(id) ?? {
      qid: id,
      title: r.pLabel?.value ?? '',
      commonsFile: null,
      article: null,
      year: null,
      links: parseInt(r.links?.value ?? '0', 10),
    };
    if (r.image && !cur.commonsFile) {
      cur.commonsFile = decodeURIComponent(r.image.value.split('/Special:FilePath/')[1] ?? '').replace(/_/g, ' ');
    }
    if (r.article && !cur.article) {
      cur.article = decodeURIComponent(r.article.value.split('/wiki/')[1] ?? '').replace(/_/g, ' ');
    }
    if (r.inception && cur.year == null) {
      const m = r.inception.value.match(/^([+-]?)(\d{4,})/);
      if (m) cur.year = (m[1] === '-' ? -1 : 1) * parseInt(m[2], 10);
    }
    byId.set(id, cur);
  }
  return [...byId.values()].filter((p) => p.title && !/^Q\d+$/.test(p.title));
}

async function getCommonsImageInfo(fileNames) {
  const out = new Map();
  for (let i = 0; i < fileNames.length; i += 40) {
    const batch = fileNames.slice(i, i + 40);
    const titles = batch.map((f) => `File:${f}`).join('|');
    const json = await commons(
      `action=query&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=1600&titles=${encodeURIComponent(titles)}`
    );
    for (const page of json?.query?.pages ?? []) {
      const ii = page.imageinfo?.[0];
      if (!ii) continue;
      const name = page.title.replace(/^File:/, '');
      if (!/^image\/(jpeg|png)$/.test(ii.mime)) continue;
      const em = ii.extmetadata ?? {};
      out.set(name, {
        image: ii.thumburl ?? ii.url,
        thumb: (ii.thumburl ?? ii.url).replace(/(\/|^)1600px-/, '$1560px-'),
        full: ii.url,
        width: ii.width,
        height: ii.height,
        license: em.LicenseShortName?.value ?? 'see Commons',
        credit: em.Artist?.value?.replace(/<[^>]+>/g, '').trim() ?? '',
      });
    }
    await sleep(250);
  }
  return out;
}

async function getArticleImages(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 40) {
    const batch = titles.slice(i, i + 40);
    const json = await enwiki(
      `action=query&prop=pageimages&piprop=original|thumbnail&pithumbsize=560&pilicense=any&titles=${encodeURIComponent(batch.join('|'))}`
    );
    for (const page of json?.query?.pages ?? []) {
      if (page.original?.source) {
        out.set(page.title, {
          image: page.original.source,
          thumb: page.thumbnail?.source ?? page.original.source,
          width: page.original.width,
          height: page.original.height,
          license: 'via English Wikipedia article',
        });
      }
    }
    await sleep(250);
  }
  return out;
}

async function getIntros(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 20) {
    const batch = titles.slice(i, i + 20);
    const json = await enwiki(
      `action=query&prop=extracts&exintro=1&explaintext=1&exlimit=20&titles=${encodeURIComponent(batch.join('|'))}`
    );
    for (const page of json?.query?.pages ?? []) {
      if (page.extract) out.set(page.title, page.extract);
    }
    await sleep(250);
  }
  return out;
}

async function getFullText(title) {
  const json = await enwiki(
    `action=query&prop=extracts&explaintext=1&exlimit=1&titles=${encodeURIComponent(title)}`
  );
  return json?.query?.pages?.[0]?.extract ?? '';
}

async function getCommonsCategoryFiles(artistName, limit = 30) {
  const json = await commons(
    `action=query&list=categorymembers&cmtitle=${encodeURIComponent(`Category:Paintings by ${artistName}`)}&cmtype=file&cmlimit=${limit}`
  );
  return (json?.query?.categorymembers ?? [])
    .map((m) => m.title.replace(/^File:/, ''))
    .filter((f) => /\.(jpe?g|png)$/i.test(f));
}

const titleFromFilename = (f) =>
  f.replace(/\.[a-z]+$/i, '').replace(/[_-]+/g, ' ')
    .replace(/\b(by|circa|c\.)\b.*$/i, '').replace(/\d{3,4}px/g, '').trim();

// ---------- per-artist pipeline ----------

async function buildArtist(wikiTitle, periodSlug) {
  const slug = slugify(displayName(wikiTitle));
  const cacheFile = path.join(CACHE, `${slug}.json`);
  if (existsSync(cacheFile)) {
    return JSON.parse(await readFile(cacheFile, 'utf8'));
  }
  process.stdout.write(`  ${wikiTitle} ... `);

  const basics = await getPageBasics(wikiTitle);
  if (!basics?.qid) { console.log('SKIP (no page/qid)'); return null; }
  const dates = await getArtistDates(basics.qid);
  const candidates = await getPaintingCandidates(basics.qid);
  await sleep(400);

  // rank: article+commons image > commons image > article-only; then by fame
  const score = (c) => (c.commonsFile ? 2 : 0) + (c.article ? 1 : 0);
  candidates.sort((a, b) => score(b) - score(a) || b.links - a.links);
  let picked = candidates.filter((c) => c.commonsFile || c.article).slice(0, MAX_PAINTINGS + 6);

  const commonsInfo = await getCommonsImageInfo(picked.filter((c) => c.commonsFile).map((c) => c.commonsFile));
  const articleImgs = await getArticleImages(picked.filter((c) => !c.commonsFile && c.article).map((c) => c.article));
  const intros = await getIntros(picked.filter((c) => c.article).map((c) => c.article.replace(/_/g, ' ')));

  const paintings = [];
  for (const c of picked) {
    if (paintings.length >= MAX_PAINTINGS) break;
    const ci = c.commonsFile ? commonsInfo.get(c.commonsFile) : null;
    const ai = !ci && c.article ? articleImgs.get(c.article.replace(/_/g, ' ')) : null;
    const img = ci ?? ai;
    if (!img) continue;
    const articleTitle = c.article?.replace(/_/g, ' ') ?? null;
    const intro = articleTitle ? intros.get(articleTitle) ?? '' : '';
    let facts = [];
    if (articleTitle) {
      const full = await getFullText(articleTitle);
      facts = extractFacts(full, intro);
      await sleep(150);
    }
    paintings.push({
      qid: c.qid,
      title: c.title,
      year: c.year,
      story: cleanExtract(intro),
      facts,
      image_url: img.image,
      thumb_url: img.thumb,
      width: img.width,
      height: img.height,
      license: img.license,
      credit: img.credit ?? '',
      wikipedia_url: articleTitle ? `https://en.wikipedia.org/wiki/${encodeURIComponent(articleTitle.replace(/ /g, '_'))}` : null,
      source: ci ? 'commons' : 'enwiki',
    });
  }

  // top up from Commons "Paintings by X" category if still short
  if (paintings.length < MIN_PAINTINGS) {
    const catFiles = await getCommonsCategoryFiles(displayName(basics.title));
    const fresh = catFiles.filter((f) => ![...commonsInfo.keys()].includes(f)).slice(0, 20);
    const info = await getCommonsImageInfo(fresh);
    for (const [file, img] of info) {
      if (paintings.length >= MIN_PAINTINGS + 2) break;
      const t = titleFromFilename(file);
      if (paintings.some((p) => p.title.toLowerCase() === t.toLowerCase())) continue;
      paintings.push({
        qid: null, title: t, year: null, story: '', facts: [],
        image_url: img.image, thumb_url: img.thumb, width: img.width, height: img.height,
        license: img.license, credit: img.credit, wikipedia_url: null, source: 'commons-category',
      });
    }
  }

  const artist = {
    slug,
    period: periodSlug,
    name: displayName(basics.title),
    qid: basics.qid,
    description: basics.description,
    bio: cleanExtract(basics.extract, 1100),
    portrait_url: basics.image ?? basics.thumb,
    portrait_thumb: basics.thumb,
    wikipedia_url: basics.url,
    birth_year: dates.birth,
    death_year: dates.death,
    active_start: dates.workStart ?? (dates.birth != null ? dates.birth + 20 : null),
    active_end: dates.workEnd ?? dates.death ?? 2026,
    paintings,
  };
  await writeFile(cacheFile, JSON.stringify(artist, null, 2));
  console.log(`${paintings.length} paintings (${paintings.filter((p) => p.source !== 'enwiki').length} commons)`);
  return artist;
}

// ---------- main ----------

async function main() {
  await mkdir(CACHE, { recursive: true });
  const filter = process.env.ETL_FILTER?.toLowerCase();
  const periods = [];
  for (let p of PERIODS) {
    if (filter && !p.artists.some((a) => a.toLowerCase().includes(filter))) continue;
    if (filter) p = { ...p, artists: p.artists.filter((a) => a.toLowerCase().includes(filter)) };
    console.log(`\n== ${p.name} ==`);
    const info = await getPageBasics(p.wiki);
    const artists = [];
    for (const a of p.artists) {
      try {
        const artist = await buildArtist(a, p.slug);
        if (artist) artists.push(artist);
      } catch (e) {
        console.log(`ERROR for ${a}: ${e.message}`);
      }
      await sleep(500);
    }
    periods.push({
      slug: p.slug, name: p.name, start: p.start, end: p.end, color: p.color,
      description: cleanExtract(info?.extract ?? '', 600),
      wikipedia_url: info?.url ?? '',
      artists,
    });
  }
  // prune artists that never reached the minimum, as long as the period keeps 3+
  for (const p of periods) {
    const ok = p.artists.filter((a) => a.paintings.length >= MIN_PAINTINGS);
    if (ok.length >= 3 && ok.length < p.artists.length) {
      const dropped = p.artists.filter((a) => !ok.includes(a)).map((a) => a.name);
      console.log(`pruning from ${p.name}: ${dropped.join(', ')}`);
      p.artists = ok;
    }
  }
  await writeFile(OUT, JSON.stringify({ generated: new Date().toISOString(), periods }, null, 1));

  console.log('\n=== COVERAGE REPORT ===');
  for (const p of periods) {
    const bad = p.artists.filter((a) => a.paintings.length < MIN_PAINTINGS);
    console.log(
      `${p.name}: ${p.artists.length} artists` +
      (bad.length ? `  ⚠ below ${MIN_PAINTINGS}: ${bad.map((a) => `${a.name}(${a.paintings.length})`).join(', ')}` : '  ✓')
    );
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
