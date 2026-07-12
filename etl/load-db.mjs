// Loads data/museum-data.json into the Neon Postgres database whose
// connection string lives in .env.local. The connection string is never
// printed or echoed.

import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

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
if (!DATABASE_URL) {
  console.error('No DATABASE_URL found in .env.local — aborting.');
  process.exit(1);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS periods (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_year INT NOT NULL,
  end_year INT NOT NULL,
  color TEXT NOT NULL,
  description TEXT DEFAULT '',
  wikipedia_url TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS artists (
  slug TEXT PRIMARY KEY,
  period_slug TEXT NOT NULL REFERENCES periods(slug) ON DELETE CASCADE,
  name TEXT NOT NULL,
  qid TEXT,
  description TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  portrait_url TEXT,
  portrait_thumb TEXT,
  wikipedia_url TEXT,
  birth_year INT,
  death_year INT,
  active_start INT,
  active_end INT
);
ALTER TABLE artists ADD COLUMN IF NOT EXISTS bio_hu TEXT DEFAULT '';
ALTER TABLE artists ADD COLUMN IF NOT EXISTS description_hu TEXT DEFAULT '';
ALTER TABLE artists ADD COLUMN IF NOT EXISTS wikipedia_url_hu TEXT;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS gender TEXT;
-- rebuilt on every load; dedupe_key = qid (falls back to title), so two works
-- that share a title (e.g. "Self-portrait") no longer collapse into one row
DROP TABLE IF EXISTS paintings;
CREATE TABLE paintings (
  id SERIAL PRIMARY KEY,
  artist_slug TEXT NOT NULL REFERENCES artists(slug) ON DELETE CASCADE,
  qid TEXT,
  dedupe_key TEXT NOT NULL,
  title TEXT NOT NULL,
  year INT,
  story TEXT DEFAULT '',
  facts JSONB DEFAULT '[]',
  genres JSONB DEFAULT '[]',
  depicts JSONB DEFAULT '[]',
  image_url TEXT NOT NULL,
  thumb_url TEXT,
  width INT,
  height INT,
  license TEXT,
  credit TEXT,
  wikipedia_url TEXT,
  source TEXT,
  UNIQUE (artist_slug, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_artists_period ON artists(period_slug);
CREATE INDEX IF NOT EXISTS idx_paintings_artist ON paintings(artist_slug);
`;

async function main() {
  const data = JSON.parse(await readFile(path.join(ROOT, 'data', 'museum-data.json'), 'utf8'));
  const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 4 });
  const client = await pool.connect();
  try {
    await client.query(SCHEMA);
    await client.query('BEGIN');
    await client.query('DELETE FROM paintings');
    await client.query('DELETE FROM artists');
    await client.query('DELETE FROM periods');
    let nArtists = 0, nPaintings = 0;
    for (const p of data.periods) {
      await client.query(
        'INSERT INTO periods (slug,name,start_year,end_year,color,description,wikipedia_url) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [p.slug, p.name, p.start, p.end, p.color, p.description, p.wikipedia_url]
      );
      for (const a of p.artists) {
        await client.query(
          `INSERT INTO artists (slug,period_slug,name,qid,description,bio,portrait_url,portrait_thumb,wikipedia_url,birth_year,death_year,active_start,active_end,bio_hu,description_hu,wikipedia_url_hu,gender)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [a.slug, p.slug, a.name, a.qid, a.description, a.bio, a.portrait_url, a.portrait_thumb,
           a.wikipedia_url, a.birth_year, a.death_year, a.active_start, a.active_end,
           a.bio_hu ?? '', a.description_hu ?? '', a.wikipedia_url_hu ?? null, a.gender ?? null]
        );
        nArtists++;
        for (const w of a.paintings) {
          await client.query(
            `INSERT INTO paintings (artist_slug,qid,dedupe_key,title,year,story,facts,genres,depicts,image_url,thumb_url,width,height,license,credit,wikipedia_url,source)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
             ON CONFLICT (artist_slug,dedupe_key) DO NOTHING`,
            [a.slug, w.qid, w.qid ?? w.title, w.title, w.year, w.story, JSON.stringify(w.facts ?? []),
             JSON.stringify(w.genres ?? []), JSON.stringify(w.depicts ?? []), w.image_url,
             w.thumb_url, w.width, w.height, w.license, w.credit, w.wikipedia_url, w.source]
          );
          nPaintings++;
        }
      }
    }
    await client.query('COMMIT');
    console.log(`Loaded ${data.periods.length} periods, ${nArtists} artists, ${nPaintings} paintings into Neon.`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error('load failed:', e.message); process.exit(1); });
