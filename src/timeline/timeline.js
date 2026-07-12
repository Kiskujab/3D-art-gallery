// The Strata — zoomable infinite-canvas timeline of art history.
// Horizontal bands (periods) share one year axis; zooming in expands a band
// vertically and reveals its artists pinned to their real working dates.

import gsap from 'gsap';
import { t, periodName } from '../i18n.js';

const SERIF = `'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif`;
const SANS = `'Avenir Next', 'Helvetica Neue', Helvetica, Arial, sans-serif`;

const COMPACT_H = 96; // compact bands are little galleries — tall enough for a painting strip
const HEADER_H = 50;
const ROW_H = 66;
const LANE_GAP = 20;
const PORTRAIT_R = 23;

const smoothstep = (x, a, b) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (hex, a) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};
const lighten = (hex, amt) => {
  const [r, g, b] = hexToRgb(hex);
  const f = (c) => Math.round(c + (255 - c) * amt);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
};

class ImageCache {
  constructor(onload) {
    this.map = new Map();
    this.onload = onload;
  }
  get(url) {
    if (!url) return null;
    let e = this.map.get(url);
    if (!e) {
      e = { img: new Image(), ok: false };
      e.img.crossOrigin = 'anonymous';
      e.img.onload = () => { e.ok = true; this.onload?.(); };
      e.img.src = url;
      this.map.set(url, e);
    }
    return e.ok ? e.img : null;
  }
}

export function createTimeline({ canvas, data, onArtistClick }) {
  const ctx = canvas.getContext('2d');
  const periods = [...data.periods].sort((a, b) => a.start - b.start);

  // ---- lane assignment (greedy interval packing) ----
  const lanes = [];
  for (const p of periods) {
    let lane = lanes.findIndex((endYear) => p.start >= endYear);
    if (lane === -1) { lane = lanes.length; lanes.push(0); }
    lanes[lane] = Math.max(lanes[lane], p.end);
    p._lane = lane;
    p._artists = [...p.artists].sort((a, b) => (a.active_start ?? 0) - (b.active_start ?? 0));
    // one painting per artist for the compact band's mosaic strip; the 330px
    // Wikimedia bucket keeps these tiny (other widths return HTTP 400)
    p._thumbs = p._artists
      .map((a) => a.paintings?.find((x) => x.thumb_url || x.image_url))
      .filter(Boolean)
      .map((x) => (x.thumb_url ?? x.image_url).replace(/\/1920px-/, '/330px-'))
      .slice(0, 12);
  }
  const nLanes = lanes.length;

  // ---- era-weighted axis ----
  // Real dates, non-uniform density: the early centuries (sparse) are gently
  // compressed, the crowded modern era gets room. warp() maps year → axis
  // units; all positions/widths run through it, so nodes stay at true dates.
  const SEGMENTS = [
    { from: -Infinity, to: 1300, rate: 0.28 },
    { from: 1300, to: 1700, rate: 1.0 },
    { from: 1700, to: 1900, rate: 1.6 },
    { from: 1900, to: Infinity, rate: 2.2 },
  ];
  function warp(yr) {
    let u = 0;
    for (const s of SEGMENTS) {
      const a = Math.max(Math.min(yr, s.to), s.from === -Infinity ? Math.min(yr, s.from) : s.from);
      if (yr <= s.from) break;
      const lo = s.from === -Infinity ? 500 : s.from;
      u += (Math.min(yr, s.to) - lo) * s.rate;
      if (yr <= s.to) break;
    }
    if (yr < 500) u = (yr - 500) * SEGMENTS[0].rate;
    return u;
  }
  function unwarp(u) {
    let acc = 0;
    if (u < 0) return 500 + u / SEGMENTS[0].rate;
    for (const s of SEGMENTS) {
      const lo = s.from === -Infinity ? 500 : s.from;
      const hi = s.to === Infinity ? 4000 : s.to;
      const segU = (hi - lo) * s.rate;
      if (u <= acc + segU) return lo + (u - acc) / s.rate;
      acc += segU;
    }
    return 4000;
  }
  const rateAt = (yr) => SEGMENTS.find((s) => yr >= s.from && yr <= s.to)?.rate ?? 1;
  const warpSpan = (a, b) => warp(b) - warp(a);

  // ---- view state ----
  const minYear = Math.min(...periods.map((p) => p.start));
  const maxYear = Math.max(...periods.map((p) => p.end));
  const view = { x: warp(minYear), ppy: 1, y: 0 }; // x: axis-units at left edge; ppy: px per axis-unit; y: vertical pan
  let W = 0, H = 0, dpr = 1;
  let needsDraw = true;
  const invalidate = () => { needsDraw = true; };
  const images = new ImageCache(invalidate);

  const filter = { period: null, artist: null };
  let hover = null; // { type: 'artist'|'period', slug }
  let hitRegions = [];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    invalidate();
  }
  resize();
  window.addEventListener('resize', resize);

  // fit whole history on first show
  function fitAll() {
    const pad = 70;
    view.ppy = (W - pad * 2) / warpSpan(minYear, maxYear);
    view.x = warp(minYear) - pad / view.ppy;
    view.y = 0;
    invalidate();
  }
  fitAll();

  const yearToX = (yr) => (warp(yr) - view.x) * view.ppy;
  const xToYear = (x) => unwarp(view.x + x / view.ppy);

  // ---- expansion: exactly one period opens at a time ----
  // The old rule expanded any band past a width+zoom double threshold, so
  // several neighbours could open at once and push every artist row off
  // screen (or, for long low-density eras, never open at all). Now a single
  // candidate — the band that dominates the viewport, or the explicitly
  // focused one — eases open, and the layout centres it vertically.
  let focusSlug = null;

  const rowHFor = (p) =>
    Math.min(Math.max((H - 210 - HEADER_H) / p._artists.length, 44), 66);

  function updateExpansion() {
    const midYear = xToYear(W / 2);
    periods.forEach((p) => {
      const x0 = yearToX(p.start), x1 = yearToX(p.end);
      p._cov = Math.max((Math.min(x1, W) - Math.max(x0, 0)) / W, 0);
    });
    let idx = -1;
    if (focusSlug) {
      const i = periods.findIndex((p) => p.slug === focusSlug);
      if (i !== -1 && periods[i]._cov > 0.3) idx = i;
    }
    if (idx === -1) {
      // the narrowest band under the viewport centre that fills most of it
      let bestSpan = Infinity;
      periods.forEach((p, i) => {
        if (p._cov > 0.55 && midYear >= p.start && midYear <= p.end && p.end - p.start < bestSpan) {
          bestSpan = p.end - p.start;
          idx = i;
        }
      });
      if (idx === -1) {
        let bestCov = 0.75;
        periods.forEach((p, i) => { if (p._cov > bestCov) { bestCov = p._cov; idx = i; } });
      }
    }
    let animating = false;
    periods.forEach((p, i) => {
      const target = i === idx ? smoothstep(p._cov, 0.5, 0.8) : 0;
      p._e = p._e ?? 0;
      const d = target - p._e;
      if (Math.abs(d) > 0.004) { p._e += d * 0.16; animating = true; }
      else p._e = target;
    });
    if (animating) invalidate();
  }

  // ---- per-frame layout (pure — reads the eased p._e) ----
  function layout() {
    const heights = periods.map((p) => {
      const eh = HEADER_H + p._artists.length * rowHFor(p) + 14;
      return lerp(COMPACT_H, eh, p._e ?? 0);
    });
    const laneH = new Array(nLanes).fill(COMPACT_H);
    periods.forEach((p, i) => {
      // only let on-screen bands drive lane height so distant giants don't push layout
      const x0 = yearToX(p.start), x1 = yearToX(p.end);
      const visible = x1 > -80 && x0 < W + 80;
      if (visible) laneH[p._lane] = Math.max(laneH[p._lane], heights[i]);
    });
    const laneY = [];
    let acc = 0;
    for (let l = 0; l < nLanes; l++) { laneY.push(acc); acc += laneH[l] + LANE_GAP; }
    const totalH = acc - LANE_GAP;
    let baseY = Math.max((H - 46 - totalH) / 2, 84);
    // centre the open band on screen (blend in as it opens)
    let em = 0, ei = -1;
    periods.forEach((p, i) => { if ((p._e ?? 0) > em) { em = p._e; ei = i; } });
    if (ei !== -1) {
      const centered = (H - 46) / 2 - (laneY[periods[ei]._lane] + heights[ei] / 2);
      baseY = lerp(baseY, centered, smoothstep(em, 0.25, 0.9));
    }
    baseY += view.y;
    return { expanded: periods.map((p) => p._e ?? 0), heights, laneY, baseY, totalH };
  }

  // ---- drawing ----
  function draw() {
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    // background
    const bg = ctx.createRadialGradient(W / 2, H * 0.35, 80, W / 2, H / 2, Math.max(W, H) * 0.75);
    bg.addColorStop(0, '#1b1712');
    bg.addColorStop(1, '#100d09');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    drawAxis();

    updateExpansion();
    hitRegions = [];
    const { expanded, heights, laneY, baseY } = layout();

    periods.forEach((p, i) => {
      const x0 = yearToX(p.start);
      const x1 = yearToX(p.end);
      if (x1 < -100 || x0 > W + 100) return;
      const y = baseY + laneY[p._lane];
      const h = heights[i];
      const e = expanded[i];
      const dim = filter.period && filter.period !== p.slug ? 0.16 : 1;

      drawBand(p, x0, x1, y, h, e, dim);
      if (e > 0.03 && dim === 1) drawArtists(p, x0, x1, y, h, e);

      hitRegions.push({ type: 'period', slug: p.slug, x: x0, y, w: x1 - x0, h, expanded: e });
    });

    // vignette
    const vg = ctx.createLinearGradient(0, 0, 0, H);
    vg.addColorStop(0, 'rgba(16,13,9,.55)');
    vg.addColorStop(0.12, 'rgba(16,13,9,0)');
    vg.addColorStop(0.9, 'rgba(16,13,9,0)');
    vg.addColorStop(1, 'rgba(16,13,9,.6)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    ctx.restore();
  }

  function drawAxis() {
    const steps = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000];
    const last = xToYear(W);
    ctx.font = `500 11.5px ${SANS}`;
    ctx.textAlign = 'center';
    let yr = xToYear(0);
    let guard = 0;
    while (yr <= last && guard++ < 300) {
      // pick tick density from the local (era-weighted) pixel scale
      const pxPerYear = view.ppy * rateAt(yr);
      const step = steps.find((s) => s * pxPerYear >= 110) ?? 1;
      yr = Math.ceil(yr / step) * step;
      if (yr > last) break;
      const x = yearToX(yr);
      ctx.strokeStyle = 'rgba(244,239,229,.055)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H - 34);
      ctx.stroke();
      ctx.fillStyle = 'rgba(244,239,229,.42)';
      ctx.fillText(String(yr), x, H - 16);
      ctx.strokeStyle = 'rgba(200,164,90,.4)';
      ctx.beginPath();
      ctx.moveTo(x, H - 34);
      ctx.lineTo(x, H - 28);
      ctx.stroke();
      yr += step;
    }
    ctx.strokeStyle = 'rgba(200,164,90,.28)';
    ctx.beginPath();
    ctx.moveTo(0, H - 34);
    ctx.lineTo(W, H - 34);
    ctx.stroke();
  }

  function drawBand(p, x0, x1, y, h, e, dim) {
    const w = Math.max(x1 - x0, 4);
    const r = Math.min(12, h / 2);
    const isHover = hover?.type === 'period' && hover.slug === p.slug && e < 0.5;

    ctx.globalAlpha = dim;
    ctx.beginPath();
    ctx.roundRect(x0, y, w, h, r);
    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, rgba(p.color, 0.28));
    grad.addColorStop(1, rgba(p.color, 0.12));
    ctx.fillStyle = grad;
    ctx.fill();

    // compact bands are miniature galleries: a strip of the period's actual
    // paintings glazed in the period colour, fading away as the band opens
    const mA = (1 - e) * dim;
    if (mA > 0.02 && p._thumbs.length && w > 24) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x0, y, w, h, r);
      ctx.clip();
      const slotW = Math.max(h * 0.74, 64);
      const i0 = Math.max(Math.floor((0 - x0) / slotW), 0);
      const i1 = Math.min(Math.ceil((W - x0) / slotW), Math.ceil(w / slotW));
      for (let i = i0; i < i1; i++) {
        const img = images.get(p._thumbs[i % p._thumbs.length]);
        if (!img) continue;
        const sx = x0 + i * slotW;
        const s = Math.max(slotW / img.width, h / img.height); // cover-crop
        ctx.globalAlpha = mA * (isHover ? 1 : 0.92);
        ctx.drawImage(
          img,
          sx + (slotW - img.width * s) / 2,
          y + (h - img.height * s) / 2,
          img.width * s, img.height * s
        );
      }
      // period-colour glaze + bottom scrim so the label stays legible
      ctx.globalAlpha = mA;
      ctx.fillStyle = rgba(p.color, isHover ? 0.14 : 0.24);
      ctx.fillRect(x0, y, w, h);
      const scrim = ctx.createLinearGradient(0, y, 0, y + h);
      scrim.addColorStop(0, 'rgba(12,9,6,.30)');
      scrim.addColorStop(0.4, 'rgba(12,9,6,.08)');
      scrim.addColorStop(1, 'rgba(12,9,6,.82)');
      ctx.fillStyle = scrim;
      ctx.fillRect(x0, y, w, h);
      ctx.restore();
      ctx.globalAlpha = dim;
    }

    ctx.beginPath();
    ctx.roundRect(x0, y, w, h, r);
    ctx.strokeStyle = rgba(p.color, isHover ? 0.95 : 0.5);
    ctx.lineWidth = isHover ? 1.6 : 1;
    ctx.stroke();

    // left accent
    ctx.beginPath();
    ctx.roundRect(x0, y, 4, h, [r, 0, 0, r]);
    ctx.fillStyle = rgba(p.color, 0.9);
    ctx.fill();

    // label — bottom-left over the scrim when compact, top-left when open
    // (pinned to the viewport when the band scrolls off-left)
    const lx = Math.max(x0, 0) + 18;
    const labelColor = lighten(p.color, 0.62);
    ctx.textAlign = 'left';
    ctx.fillStyle = labelColor;
    let fs = lerp(15, 17, e);
    const labelY = y + lerp(h - 26, 30, e);
    const fullLabel = periodName(p).toUpperCase();
    let label = fullLabel;
    ctx.save();
    if (e < 0.7) { ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 6; }
    ctx.letterSpacing = '2.5px';
    // in narrow bands: drop tracking and shrink before resorting to ellipsis
    const avail = Math.max(x1 - lx - 10, 24);
    ctx.font = `600 ${fs}px ${SANS}`;
    let lw = ctx.measureText(label).width;
    if (lw > avail) {
      ctx.letterSpacing = '0.5px';
      fs = Math.max(fs * (avail / ctx.measureText(label).width), 9);
      ctx.font = `600 ${fs}px ${SANS}`;
      while (label.length > 4 && ctx.measureText(label + '…').width > avail) {
        label = label.slice(0, -1);
      }
      if (label !== fullLabel) label += '…';
      lw = ctx.measureText(label).width;
    }
    ctx.fillText(label, lx, labelY);
    ctx.font = `italic 12px ${SERIF}`;
    ctx.fillStyle = 'rgba(244,239,229,.72)';
    if (x1 - lx - lw > 150) {
      const sub = `${p.start} – ${p.end} · ` +
        t('timeline.artists', { n: p._artists.length }) +
        (isHover ? t('timeline.open') : '');
      ctx.fillText(sub, lx + lw + 14, labelY);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawArtists(p, x0, x1, y, h, e) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x0, y, x1 - x0, h, 10);
    ctx.clip();
    ctx.globalAlpha = e;

    const rowH = rowHFor(p);
    const pr = Math.min(PORTRAIT_R, rowH / 2 - 5);

    p._artists.forEach((a, row) => {
      const ry = y + HEADER_H + row * rowH + rowH / 2;
      if (ry > y + h) return;
      const start = a.active_start ?? p.start;
      const end = a.active_end ?? p.end;
      const ax0 = yearToX(start);
      const ax1 = yearToX(end);
      const dimA = filter.artist && filter.artist !== a.slug ? 0.25 : 1;
      const isHover = hover?.type === 'artist' && hover.slug === a.slug;
      const isFocus = filter.artist === a.slug;
      ctx.globalAlpha = e * dimA;

      // career span line
      ctx.strokeStyle = rgba(p.color, 0.55);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ax0, ry);
      ctx.lineTo(ax1, ry);
      ctx.stroke();
      // end ticks
      for (const tx of [ax0, ax1]) {
        ctx.beginPath();
        ctx.moveTo(tx, ry - 5);
        ctx.lineTo(tx, ry + 5);
        ctx.stroke();
      }

      // portrait node at career start, pinned inside both the viewport and
      // the band (careers often begin before the period's official start)
      const minX = Math.max(x0 + pr + 14, pr + 16);
      const px = Math.min(Math.max(ax0, minX), Math.max(ax1 - 30, minX));
      const img = images.get(a.portrait_thumb);
      ctx.save();
      ctx.beginPath();
      ctx.arc(px, ry, pr, 0, Math.PI * 2);
      ctx.fillStyle = '#2a251d';
      ctx.fill();
      ctx.clip();
      if (img) {
        const s = Math.max((pr * 2) / img.width, (pr * 2) / img.height);
        ctx.drawImage(img, px - (img.width * s) / 2, ry - (img.height * s) / 2 - img.height * s * 0.08, img.width * s, img.height * s);
      } else {
        ctx.fillStyle = rgba(p.color, 0.8);
        ctx.font = `500 ${Math.round(pr * 0.87)}px ${SERIF}`;
        ctx.textAlign = 'center';
        ctx.fillText(a.name[0], px, ry + pr * 0.3);
      }
      ctx.restore();
      ctx.beginPath();
      ctx.arc(px, ry, pr, 0, Math.PI * 2);
      ctx.strokeStyle = isHover || isFocus ? '#c8a45a' : rgba(p.color, 0.85);
      ctx.lineWidth = isHover || isFocus ? 2.5 : 1.5;
      ctx.stroke();

      // name + dates
      ctx.textAlign = 'left';
      ctx.font = `500 ${rowH < 54 ? 14 : 15}px ${SERIF}`;
      ctx.fillStyle = isHover ? '#ffffff' : 'rgba(244,239,229,.94)';
      const nameX = px + pr + 12;
      ctx.fillText(a.name, nameX, ry - 1);
      ctx.font = `italic 11.5px ${SERIF}`;
      ctx.fillStyle = 'rgba(244,239,229,.5)';
      const lived = `${a.birth_year ?? '?'} – ${a.death_year ?? ''}`;
      ctx.fillText(lived, nameX, ry + 15);

      const nameW = Math.max(ctx.measureText(a.name).width + 30, 150);
      hitRegions.push({
        type: 'artist', slug: a.slug, artist: a, period: p,
        x: px - pr, y: ry - pr, w: pr + nameW, h: pr * 2,
      });
    });

    ctx.restore();
  }

  // ---- interaction ----
  // one pointer drags/pans (and taps), two active touch pointers pinch-zoom
  let drag = null;
  const touches = new Map(); // pointerId → last position
  let pinch = null;          // { d, cx } — finger distance + midpoint x
  let pinched = false;       // true until every finger lifts (suppresses taps)
  canvas.addEventListener('pointerdown', (ev) => {
    touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    canvas.setPointerCapture(ev.pointerId);
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2 };
      pinched = true;
      drag = null;
      canvas.classList.remove('dragging');
      return;
    }
    drag = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y, moved: false };
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', (ev) => {
    const tp = touches.get(ev.pointerId);
    if (tp) { tp.x = ev.clientX; tp.y = ev.clientY; }
    if (pinch && touches.size >= 2) {
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2;
      if (d > 0 && pinch.d > 0) {
        zoomAt(cx, d / pinch.d);
        view.x += (pinch.cx - cx) / view.ppy; // the midpoint also pans
        clampView();
        invalidate();
      }
      pinch = { d, cx };
      return;
    }
    if (drag) {
      const dx = ev.clientX - drag.x;
      const dy = ev.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      view.x = drag.vx - dx / view.ppy;
      view.y = drag.vy + dy;
      clampView();
      invalidate();
    } else {
      updateHover(ev.clientX, ev.clientY);
    }
  });
  canvas.addEventListener('pointerup', (ev) => {
    touches.delete(ev.pointerId);
    if (touches.size < 2) pinch = null;
    if (pinched) {
      if (touches.size === 0) pinched = false;
      drag = null;
      canvas.classList.remove('dragging');
      return; // fingers coming off a pinch are not taps
    }
    canvas.classList.remove('dragging');
    const wasDrag = drag?.moved;
    drag = null;
    if (wasDrag) return;
    const hit = pick(ev.clientX, ev.clientY);
    if (hit?.type === 'artist') {
      onArtistClick?.(hit.artist, hit.period);
    } else if (hit?.type === 'period' && hit.expanded < 0.5) {
      focusPeriod(hit.slug, { setFilter: false });
    }
  });
  canvas.addEventListener('pointercancel', (ev) => {
    touches.delete(ev.pointerId);
    if (touches.size < 2) pinch = null;
    if (touches.size === 0) pinched = false;
    drag = null;
    canvas.classList.remove('dragging');
  });

  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    if (ev.ctrlKey || Math.abs(ev.deltaY) >= Math.abs(ev.deltaX)) {
      const factor = Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.012 : 0.0016));
      zoomAt(ev.clientX, factor);
    } else {
      view.x += ev.deltaX / view.ppy;
    }
    clampView();
    invalidate();
  }, { passive: false });

  // never let the visitor zoom out past "all of art history fills the
  // screen" — beyond that everything collapses into an unreadable clump
  const minPpy = () => (W - 140) / warpSpan(minYear, maxYear);

  function zoomAt(px, factor) {
    const u = view.x + px / view.ppy;
    view.ppy = Math.min(Math.max(view.ppy * factor, minPpy()), 160);
    view.x = u - px / view.ppy;
  }

  function clampView() {
    const span = W / view.ppy;
    view.x = Math.min(Math.max(view.x, warp(minYear) - span * 0.7), warp(maxYear) + span * 0.7 - span);
    const { totalH } = layout();
    const maxPan = Math.max(totalH - (H - 160), 0);
    view.y = Math.min(Math.max(view.y, -maxPan), 60);
  }

  function pick(mx, my) {
    // artists first (drawn above bands)
    for (const r of hitRegions) {
      if (r.type === 'artist' && mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return r;
    }
    for (const r of hitRegions) {
      if (r.type === 'period' && mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return r;
    }
    return null;
  }

  function updateHover(mx, my) {
    const hit = pick(mx, my);
    const next = hit ? { type: hit.type, slug: hit.slug, expanded: hit.expanded } : null;
    const changed = JSON.stringify(next) !== JSON.stringify(hover);
    hover = next;
    canvas.classList.toggle('pointing', Boolean(hit && (hit.type === 'artist' || hit.expanded < 0.5)));
    if (changed) invalidate();
  }

  // ---- programmatic focus (GSAP-tweened camera) ----
  function tweenView(target, dur = 1.1) {
    gsap.to(view, {
      ...target, duration: dur, ease: 'power3.inOut',
      onUpdate: () => { invalidate(); },
    });
  }

  function focusPeriod(slug, { setFilter = true } = {}) {
    const p = periods.find((q) => q.slug === slug);
    if (!p) return;
    if (setFilter) { filter.period = slug; filter.artist = null; }
    focusSlug = slug;
    const span = warpSpan(p.start, p.end);
    const ppy = Math.min(Math.max((W * 0.85) / span, minPpy()), 160);
    tweenView({ ppy, x: warp(p.start) - (W / ppy - span) / 2, y: 0 });
  }

  function focusArtist(slug) {
    for (const p of periods) {
      const a = p._artists.find((q) => q.slug === slug);
      if (!a) continue;
      filter.artist = slug;
      filter.period = null;
      focusSlug = p.slug; // expand this band even where periods overlap
      const start = a.active_start ?? p.start;
      const end = a.active_end ?? p.end;
      // zoom to the artist's period so their row context stays visible
      const span = Math.max(warpSpan(p.start, p.end), warpSpan(start, end) * 1.6);
      const ppy = Math.min(Math.max((W * 0.85) / span, minPpy()), 60);
      const cu = (warp(start) + warp(end)) / 2;
      tweenView({ ppy, x: cu - W / ppy / 2, y: 0 });
      return { artist: a, period: p };
    }
    return null;
  }

  function clearFilter() {
    filter.period = null;
    filter.artist = null;
    focusSlug = null;
    const ppy = (W - 140) / warpSpan(minYear, maxYear);
    tweenView({ ppy, x: warp(minYear) - 70 / ppy, y: 0 });
  }

  // ---- render loop (draw only when dirty) ----
  function frame() {
    if (needsDraw) { needsDraw = false; draw(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return { focusPeriod, focusArtist, clearFilter, resize, invalidate };
}
