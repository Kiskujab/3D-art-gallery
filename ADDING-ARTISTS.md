# Adding artists to The Timeline Museum

A hand-off guide for anyone (human or AI) who has never seen this project.
Follow it top to bottom and a new artist will appear in the timeline, in the
Explore search, and as a walkable 3D gallery room.

## What this project is

A browser app: a zoomable timeline of 16 art periods → artist placard cards →
first-person 3D galleries (Three.js) hung with each artist's real paintings.
**Every fact, date, bio, story and image comes from Wikipedia / Wikidata /
Wikimedia Commons.** Nothing may be AI-generated or hand-written — if it isn't
on Wikipedia, it doesn't go in. The dataset lives in a Neon Postgres database.

Two hard rules:

1. **Never invent content.** You only add an artist's *name* to a seed list;
   the pipeline fetches everything else from the wikis.
2. **Never print or display the database connection string** (`DATABASE_URL`
   in `.env.local`). Don't `cat .env.local`, don't echo it, don't paste it
   into logs or commits.

## Environment

Node 18+ and `npm ci`. All commands run from the repo root.

## How the pipeline works (30 seconds)

```
etl/seed.mjs          you edit this: period definitions + artist NAMES only
      │  npm run etl
      ▼
data/cache/<slug>.json   one file per artist, fetched once, reused forever
data/museum-data.json    the assembled dataset (committed — the deployed
      │                  site is built straight from it)
      │  npm run build   bakes it into dist/ as a static file
      ▼                  (pushing to main redeploys GitHub Pages the same way)
dist/  → npm run serve → http://localhost:8787
```

Optionally the dataset also loads into Neon Postgres (`npm run db:load`,
`DATABASE_URL` from `.env.local`) — the local Express API then serves from
the DB and caches it in memory, so restart it after `db:load`. The deployed
site never touches the database.

For each artist the ETL: resolves the Wikipedia article → Wikidata QID →
SPARQL query for paintings whose *creator* is that QID → ranks them (has a
Commons image + its own English Wikipedia article = best) → downloads image
metadata, licenses, article intros (the "story" told on placards and during
the guided tour) → if still short, tops up from the Commons category
`Category:Paintings by <Name>`. Artists that end up with too few images are
**pruned automatically** and reported.

## Step by step

### 1. Pick artists that will actually work

- The artist needs an **English Wikipedia article** and a **Wikidata entry
  with paintings linked to them** (most notable painters have this).
- **Painters who died before ~1950 are safe**: their work is public domain
  and Wikimedia Commons hosts it.
- **Modern/contemporary artists (still in copyright) only work in the
  periods Surrealism → Contemporary**, where the app is allowed to fall back
  to the fair-use image shown in each painting's own English Wikipedia
  article. That means only paintings famous enough to have their *own
  article* count — many modern artists yield too few and get pruned. Adding
  them is a legitimate try; just expect the coverage report to have the
  final word.
- Sculptors, photographers, performance artists yield few or no "paintings"
  in Wikidata and will be pruned.

### 2. Verify the exact article title

The seed name must be the artist's **English Wikipedia article title**
(redirects resolve, but use the canonical title to keep slugs clean —
e.g. the article is "James McNeill Whistler", not "James Abbott McNeill
Whistler"). Disambiguation suffixes are fine and are stripped for display:
`Richard Hamilton (artist)` shows as "Richard Hamilton". Check with:

```bash
curl -s "https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&titles=NAME%20HERE"
# → look for "missing" (bad) or "redirects" (use the target title instead)
```

### 3. Add the name to `etl/seed.mjs`

Find the right period (16 of them, `medieval` → `contemporary`, each with a
date range) and append the name to its `artists` array. That's the entire
edit — names only, never facts.

### 4. Run the ETL

```bash
npm run etl
```

- Already-fetched artists load instantly from `data/cache/<slug>.json`
  (slug = kebab-cased display name, e.g. `mihaly-munkacsy.json`); only
  newcomers hit the network. To force a re-fetch, delete the cache file.
- `ETL_FILTER=munkácsy npm run etl` fetches only matching artists — useful
  for testing one addition — **but writes a museum-data.json containing only
  them**, so always finish with one full `npm run etl` (fast, all cached).
- Read the **coverage report** at the end. `⚠ below N` or
  `pruning from <Period>: <names>` means an artist didn't get enough images
  and was dropped — remove it from the seed or accept the prune.

### 5. Load the database and restart the server

```bash
npm run db:load        # recreates tables from data/museum-data.json
# then restart the API server — it caches /api/data in memory:
#   stop the running `npm run serve`, start it again
```

(Without `DATABASE_URL` the API falls back to serving
`data/museum-data.json` directly — the app still works.)

### 6. Update the visible counts

The artist/painting totals are written in three places — keep them honest:

- `src/locales/en.json` and `src/locales/hu.json`, key `gate.sub`
- `index.html` (the fallback text inside `#device-gate`)
- `README.md` (intro paragraph and the museum-map bullet)

### 7. Verify

```bash
npm run build          # production bundle → dist/, served by :8787
```

Open `http://localhost:8787/#/artist/<slug>` — the share-link router spawns
you directly in the new artist's room. Check: the room has paintings, the
placard card (click the artist in the timeline) shows a bio and portrait,
and the museum map (M) includes the new gallery. Headless check without a
browser:

```bash
mkdir -p /tmp/shots && SHOT_DIR=/tmp/shots node scripts/drive.mjs script.json
# script.json: [{"do":"goto","url":"http://localhost:8787/#/artist/<slug>"},
#   {"do":"wait","ms":3500},{"do":"shot","name":"new-artist"}]
```

## Gotchas that will bite you

- **Server memory cache**: after `db:load`, the running server still serves
  the old data. Restart it.
- **Wikimedia thumbnails are bucket-restricted**: only widths
  250/330/500/960/1280/1920 return HTTP 200. Never construct other sizes.
- **Slugs** are the kebab-cased full display name (`gustav-klimt`,
  `tivadar-csontvary-kosztka`) — accents stripped. The share-link hash, the
  cache filename and the DB row all use it.
- **Period placement matters**: the timeline positions artists by their real
  working years (from Wikidata), but the artist list, room preset and colour
  come from the period you seeded them under. Pick the period art historians
  would.
- **Adding a whole period** is more work: a new entry in `etl/seed.mjs`
  (slug, name, `wiki` article, date range, colour, artists), a localized
  name key `period.<slug>` in both locale files, and a room preset mapping
  in `src/museum/museum.js` (PRESETS) — read that file's preset table first.
- Be polite to the wiki APIs: the ETL already sleeps between requests; don't
  strip those sleeps or parallelize the fetches.
