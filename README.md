# The Timeline Museum

An interactive 3D museum of art history in the browser: a zoomable, node-based
timeline of 16 periods (Medieval → Contemporary) → museum-placard artist cards
→ first-person walkable 3D galleries hung with each artist's real paintings.

Every bio, date, image, story and fun fact comes from Wikipedia, Wikidata and
Wikimedia Commons — nothing is AI-generated. The dataset covers 16 periods,
231 artists and 3,174 paintings.

**Live: <https://kiskujab.github.io/3D-art-gallery/>**

The site is fully static: the dataset is baked into the build and the
paintings load straight from Wikimedia Commons. Every push to `main` rebuilds
and redeploys it to GitHub Pages via the included workflow — no server, no
database, no secrets involved at runtime.

## Run it locally

```bash
npm ci
npm run build        # bakes the dataset + share pages into dist/
npm run serve        # http://localhost:8787
```

Development mode (hot reload):

```bash
npm run dev          # http://localhost:5173
```

## Controls

- **Timeline** — every period band is a miniature gallery: a strip of its
  actual paintings, glazed in the period colour, with the artist count in the
  label. Scroll to zoom (into a period, the strip fades into its artists at
  their real working dates; zooming out stops at "all of art history"), drag
  to pan, click a band to zoom in, click an artist for their placard. The **Explore** panel searches and filters the whole
  collection by period or artist (↑↓ + Enter work too).
- **Museum** — from a placard, *Enter the museum* → *Step inside* (locks the
  cursor). WASD + mouse to walk, **Space to fly up, Shift to fly down**,
  click a painting (up close) to inspect it, ESC to release the cursor,
  threshold screen → back. **Doorways at both ends of every gallery** lead to
  the chronologically neighbouring artists (wrapping at the ends of art
  history), so you can wander the whole collection without leaving the 3D
  world — name plaques above each door say who's next. Rooms come in ten
  era-appropriate types.
- **Guided tour (T)** — an autopilot strolls the museum chronologically,
  gliding from painting to painting and pausing at each one while a caption
  panel tells its Wikipedia story (the pause scales with the story's length).
  It walks through the doorways into the next artist forever. Press T or ESC
  to end it, or just click to take over on foot from wherever it left you.
- **Museum map (M)** — the whole 500-year enfilade as a strip of 231
  galleries in chronological order, coloured by period, with your current
  room marked in gold. Hover names a gallery; click teleports you there.
- **Placard (E)** — look at a painting and press E to read its story on a
  floating panel without breaking your stride (it closes with E, or by
  walking away). ESC never gets involved — you stay in the walk.
- **Favourites (F) & your salon** — press F on any painting (while walking,
  while reading its placard, during a tour pause, or via the ♡ button in the
  inspect view) to heart it. Favourites hang together in **Your Salon**, a
  plum-walled personal gallery at the end of art history — the gold cell on
  the museum map — each painting keeping its real painter on the placard.
  Hearts persist in localStorage; hearting mid-walk re-hangs the salon live.
- **Controls help (H)** — the HUD shows only a tiny "H — controls" hint;
  pressing H opens a panel listing every key (and closes it again). ESC also
  dismisses it.
- **Share links** — the address bar always carries a hash for the gallery
  you're standing in (`#/artist/gustav-klimt`, `#/salon`), updated as you
  wander. Copy it to share: opening such a link spawns the visitor directly
  at that room's entrance. The browser Back button steps out of the museum.
- **VR (WebXR)** — with a headset connected, an *Enter VR* button appears on
  the entry screen. The enfilade is walked with the left thumbstick (gliding
  toward your gaze), the right thumbstick snap-turns 45°; rooms stream and
  the ambience plays exactly as on the desktop. The mirror floor is switched
  off in VR (it renders from a single eye), and ending the session hands the
  walk back to mouse and keyboard where you stood.
- **Sound** — procedurally synthesized ambience (no audio files): soft
  footsteps that follow your actual stride, a room tone whose colour changes
  with the ten room types (the white cube hisses, the umber cabinets rumble),
  and a reverb send scaled by room volume, so footsteps echo in the long
  salons and stay dry in small rooms. A little chime confirms each heart.

## Performance

**Settings** (⚙ in the top bar) offers a language choice (English / Magyar —
all UI strings live in `src/locales/<lang>.json`, so adding a language is one
new JSON file plus a `LANGUAGES` entry in `src/settings.js`; Wikipedia content
stays in its source language, but the curated period names are localized)
five render-quality modes, a live **sound volume** slider, a **tour pace**
choice (leisurely / normal / brisk — scales the stroll speed and the reading
pauses) and the favourites count with a clear-all button, persisted in
localStorage. Quality applies on the next museum entry; sound and pace apply
immediately. They scale the five big GPU costs — render resolution,
the mirror floor (a full second scene render per frame), shadow map
count/size, painting texture size (Wikimedia bucket widths 500/960/1280/1920)
and antialiasing. *High* is the intended look; *Medium* is a good pick for
fanless laptops; *Very Low* runs without shadows or reflections at reduced
resolution.

The enfilade streams: only the current room and its two neighbours exist,
and the neighbours are bare architectural shells behind a **gauze curtain**
hung in every doorway — light and colour show through it, paintings don't,
so nothing unrendered is ever visible. A neighbour's paintings, spotlights
and textures are hung only when you walk up to its door (≈6 m) and taken
down again when you retreat, meaning at most two rooms are fully populated
at any moment. The curtain fades open over the last two metres as you
approach. Phones, tablets and browsers without WebGL 2 or pointer lock get
a polite full-screen notice instead of a broken app.

## Data pipeline

```bash
npm run etl          # fetch everything from Wikipedia/Wikidata/Commons → data/museum-data.json
                     # (per-artist cache in data/cache/ makes re-runs incremental)
npm run etl:hu       # Hungarian Wikipedia extracts   (run after etl)
npm run etl:genres   # genre/depicts/gender enrichment (run after etl)
```

`data/museum-data.json` is committed; `npm run build` bakes it into `dist/`
as a static file (`scripts/build-data.mjs`) and generates the share pages
(`scripts/build-og.mjs`), so deploys need nothing but the repo itself.
Optionally `npm run db:load` loads the dataset into Neon Postgres
(`DATABASE_URL` from a local, git-ignored `.env.local`) and the local Express
API serves it from there — the deployed site never touches a database.

### Sources & licensing

Images are Wikimedia Commons files (public domain / free licenses). For
post-1930 movements whose works Commons cannot host (Surrealism → Contemporary),
the app uses the fair-use image shown in each work's English Wikipedia article;
every painting carries its license label in the inspect view. Curated seed
lists (period/artist names only) live in `etl/seed.mjs`; facts come exclusively
from the fetched articles.

## Layout

- `etl/` — seed lists, Wikipedia/Wikidata fetcher, enrichers, Neon loader
- `data/museum-data.json` — the assembled dataset (ETL output, committed)
- `scripts/build-data.mjs` — bakes the dataset into the static build
- `scripts/build-og.mjs` — generates the `/a/…` and `/p/…` share pages
- `server/` — optional local Express server (API + static host for `dist/`)
- `src/timeline/` — canvas Strata timeline (era-weighted year axis, semantic zoom)
- `src/ui/` — GSAP filter dropdown + artist placard
- `src/museum/` — Three.js walkable gallery (PBR, per-painting spotlights,
  soft shadows, Reflector floor, ACES tone mapping) + inspect overlay
- `scripts/drive.mjs` — headless-Chrome driver used for visual testing
- `.github/workflows/deploy.yml` — build + deploy to GitHub Pages on push
