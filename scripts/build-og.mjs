// Generates the static share pages into dist/ after vite build:
//   dist/a/<artist-slug>/index.html
//   dist/p/<artist-slug>/<painting-qid>/index.html
// Crawlers can't read hash routes, so these carry real og: meta tags, then
// bounce the human visitor to the corresponding #/artist/… deep link.
// Redirect targets are relative, so the pages work on any origin or base
// path (GitHub Pages serves project sites under /<repo>/).

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(ROOT, 'dist');
if (!existsSync(dist)) throw new Error('dist/ missing — run vite build first');

const data = JSON.parse(await readFile(path.join(ROOT, 'data', 'museum-data.json'), 'utf8'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// must mirror the museum's hanging order (museum.js populateRoom and
// server/index.mjs hangOrder): chronological, undated last — so index-based
// ids in #/artist/<slug>/p/i<n> point at the same painting
const hangOrder = (paintings) => (paintings ?? [])
  .filter((p) => p.image_url)
  .sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity));

function sharePage({ title, description, image, target }) {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<title>${esc(title)}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ctext x='16' y='24' font-size='24' text-anchor='middle' fill='%23c8a45a'%3E✦%3C/text%3E%3C/svg%3E">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(String(description ?? '').slice(0, 300))}">
${image ? `<meta property="og:image" content="${esc(image)}">` : ''}
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0;url=${esc(target)}">
</head><body>
<p><a href="${esc(target)}">The Timeline Museum →</a></p>
</body></html>`;
}

let nA = 0;
let nP = 0;
for (const period of data.periods) {
  for (const artist of period.artists) {
    const hung = hangOrder(artist.paintings);
    if (!hung.length) continue;
    const aDir = path.join(dist, 'a', artist.slug);
    await mkdir(aDir, { recursive: true });
    await writeFile(path.join(aDir, 'index.html'), sharePage({
      title: `${artist.name} — The Timeline Museum`,
      description: artist.description || artist.bio || period.name,
      image: artist.portrait_thumb ?? hung[0]?.thumb_url,
      target: `../../#/artist/${artist.slug}`,
    }));
    nA++;
    for (const p of hung) {
      if (!p.qid) continue;
      const pDir = path.join(dist, 'p', artist.slug, p.qid);
      await mkdir(pDir, { recursive: true });
      await writeFile(path.join(pDir, 'index.html'), sharePage({
        title: `${p.title} · ${artist.name} — The Timeline Museum`,
        description: p.story || artist.description || '',
        image: p.thumb_url ?? p.image_url,
        target: `../../../#/artist/${artist.slug}/p/${p.qid}`,
      }));
      nP++;
    }
  }
}
console.log(`share pages: ${nA} artists + ${nP} paintings → dist/a/, dist/p/`);
