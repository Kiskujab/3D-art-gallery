// API + static server. Reads DATABASE_URL from .env.local (never logged).
// Serves the museum dataset from Neon Postgres when available, otherwise
// falls back to the local ETL output at data/museum-data.json.

import express from 'express';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import pg from 'pg';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = process.env.PORT ?? 8787;

function loadEnvLocal() {
  const p = path.join(ROOT, '.env.local');
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = loadEnvLocal();
const DATABASE_URL = env.DATABASE_URL ?? env.POSTGRES_URL ?? env.NEON_DATABASE_URL ?? null;

let pool = null;
if (DATABASE_URL) {
  pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 4 });
  console.log('DB: using Neon Postgres (connection string loaded from .env.local)');
} else {
  console.log('DB: no DATABASE_URL in .env.local — falling back to data/museum-data.json');
}

async function dataFromDb() {
  const { rows: periods } = await pool.query('SELECT * FROM periods ORDER BY start_year');
  const { rows: artists } = await pool.query('SELECT * FROM artists');
  const { rows: paintings } = await pool.query('SELECT * FROM paintings');
  const byArtist = new Map();
  for (const p of paintings) {
    if (!byArtist.has(p.artist_slug)) byArtist.set(p.artist_slug, []);
    byArtist.get(p.artist_slug).push({
      qid: p.qid, title: p.title, year: p.year, story: p.story, facts: p.facts,
      genres: p.genres, depicts: p.depicts,
      image_url: p.image_url, thumb_url: p.thumb_url, width: p.width, height: p.height,
      license: p.license, credit: p.credit, wikipedia_url: p.wikipedia_url, source: p.source,
    });
  }
  return {
    periods: periods.map((per) => ({
      slug: per.slug, name: per.name, start: per.start_year, end: per.end_year,
      color: per.color, description: per.description, wikipedia_url: per.wikipedia_url,
      artists: artists.filter((a) => a.period_slug === per.slug).map((a) => ({
        slug: a.slug, period: a.period_slug, name: a.name, qid: a.qid,
        description: a.description, bio: a.bio,
        bio_hu: a.bio_hu, description_hu: a.description_hu, wikipedia_url_hu: a.wikipedia_url_hu,
        gender: a.gender,
        portrait_url: a.portrait_url, portrait_thumb: a.portrait_thumb,
        wikipedia_url: a.wikipedia_url,
        birth_year: a.birth_year, death_year: a.death_year,
        active_start: a.active_start, active_end: a.active_end,
        paintings: byArtist.get(a.slug) ?? [],
      })),
    })),
  };
}

async function dataFromJson() {
  return JSON.parse(await readFile(path.join(ROOT, 'data', 'museum-data.json'), 'utf8'));
}

const app = express();

// The dataset only changes on db:load (which restarts this server), so it is
// serialized, gzipped and ETagged exactly once; /api/data then serves buffers.
let cache = null; // { obj, json, gz, etag }

function packCache(obj) {
  const json = Buffer.from(JSON.stringify(obj));
  const gz = gzipSync(json);
  const etag = `"${createHash('sha1').update(json).digest('base64url')}"`;
  cache = { obj, json, gz, etag };
  return cache;
}

async function ensureCache() {
  if (cache) return cache;
  try {
    return packCache(pool ? await dataFromDb() : await dataFromJson());
  } catch (e) {
    console.error('data load failed, falling back to JSON:', e.message);
    return packCache(await dataFromJson());
  }
}

app.get('/api/data', async (req, res) => {
  try {
    const c = await ensureCache();
    res.set('ETag', c.etag);
    res.set('Cache-Control', 'no-cache'); // revalidate → 304 while unchanged
    res.type('application/json');
    if (req.headers['if-none-match'] === c.etag) return res.status(304).end();
    if (/\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
      res.set('Content-Encoding', 'gzip');
      return res.send(c.gz);
    }
    res.send(c.json);
  } catch {
    res.status(500).json({ error: 'no data available' });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, db: Boolean(pool) }));

// ---- share pages: crawlers can't see hash routes, so /a/<artist> and
// /p/<artist>/<painting> serve real og: meta tags, then bounce the human
// visitor to the corresponding #/artist/… deep link ----
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function sharePage({ title, description, image, target }) {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(String(description ?? '').slice(0, 300))}">
${image ? `<meta property="og:image" content="${esc(image)}">` : ''}
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0;url=${esc(target)}">
</head><body>
<p><a href="${esc(target)}">The Timeline Museum →</a></p>
</body></html>`;
}

function findArtist(obj, slug) {
  for (const per of obj.periods)
    for (const a of per.artists)
      if (a.slug === slug) return { artist: a, period: per };
  return null;
}

// must mirror the museum's hanging order (chronological, undated last) so
// index-based ids in /p/<slug>/i<n> point at the same painting
const hangOrder = (paintings) => (paintings ?? [])
  .filter((p) => p.image_url)
  .sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity));

app.get('/a/:slug', async (req, res) => {
  const c = await ensureCache().catch(() => null);
  const hit = c && findArtist(c.obj, req.params.slug);
  if (!hit) return res.redirect('/');
  const { artist, period } = hit;
  res.send(sharePage({
    title: `${artist.name} — The Timeline Museum`,
    description: artist.description || artist.bio || period.name,
    image: artist.portrait_thumb ?? hangOrder(artist.paintings)[0]?.thumb_url,
    target: `/#/artist/${artist.slug}`,
  }));
});

app.get('/p/:slug/:pid', async (req, res) => {
  const c = await ensureCache().catch(() => null);
  const hit = c && findArtist(c.obj, req.params.slug);
  if (!hit) return res.redirect('/');
  const { artist } = hit;
  const hung = hangOrder(artist.paintings);
  const pid = req.params.pid;
  const painting = /^i\d+$/.test(pid)
    ? hung[Number(pid.slice(1))]
    : hung.find((p) => p.qid === pid);
  if (!painting) return res.redirect(`/a/${artist.slug}`);
  res.send(sharePage({
    title: `${painting.title} · ${artist.name} — The Timeline Museum`,
    description: painting.story || artist.description || '',
    image: painting.thumb_url ?? painting.image_url,
    target: `/#/artist/${artist.slug}/p/${pid}`,
  }));
});

const dist = path.join(ROOT, 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist, {
    setHeaders: (res, filePath) => {
      // vite's hashed /assets/ files never change under the same name
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));
}

app.listen(PORT, () => console.log(`server on http://localhost:${PORT}`));
