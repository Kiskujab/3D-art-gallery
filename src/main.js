import gsap from 'gsap';
import { createTimeline } from './timeline/timeline.js';
import { createFilter } from './ui/filter.js';
import { createCardLayer } from './ui/card.js';
import { createSettings } from './ui/settings.js';
import { createMinimap } from './ui/minimap.js';
import { createQuickJump } from './ui/quickjump.js';
import { createInspectLayer } from './museum/inspect.js';
import { qualityOf, IS_TOUCH } from './settings.js';
import { isFav, listFavs, favCount, subscribeFavs } from './favourites.js';
import { initI18n, applyStatic, t, periodName } from './i18n.js';

const $ = (id) => document.getElementById(id);

// the three.js museum bundle loads lazily: prefetched when a card opens,
// awaited on entry — the timeline starts without the 3D engine
const loadMuseumModule = () => import('./museum/museum.js');

// The museum needs WebGL 2 plus either a mouse with pointer lock or — in
// touch mode — the on-screen controls; only truly incapable browsers are gated.
function incompatibleReason() {
  let gl2 = false;
  try { gl2 = !!document.createElement('canvas').getContext('webgl2'); } catch { /* blocked */ }
  if (!gl2) return t('gate.webgl');
  if (!IS_TOUCH && !('requestPointerLock' in Element.prototype)) return t('gate.pointerlock');
  return null;
}

async function loadData() {
  // the dataset is a static file baked into the build (scripts/build-data.mjs);
  // BASE_URL keeps the path working when the site is served under a subpath
  const res = await fetch(`${import.meta.env.BASE_URL}data/museum-data.json`);
  if (!res.ok) throw new Error(`data ${res.status}`);
  return res.json();
}

async function boot() {
  initI18n();
  applyStatic();

  const why = incompatibleReason();
  if (why) {
    $('loading').hidden = true;
    $('gate-reason').textContent = why;
    $('device-gate').hidden = false;
    return; // the app never loads on an incompatible device
  }

  const status = $('loading-status');
  let data;
  try {
    data = await loadData();
  } catch {
    status.textContent = t('loading.error');
    return;
  }
  const nArtists = data.periods.reduce((s, p) => s + p.artists.length, 0);
  status.textContent = t('loading.counts', { periods: data.periods.length, artists: nArtists });

  // ---------- layers ----------
  let museum = null;
  let museumOn = false; // true from enterMuseum() until exitMuseum()
  let currentArtist = null;
  let currentPeriod = null;

  // ---------- share links ----------
  // #/artist/<slug> spawns you straight in that gallery; #/salon in your own.
  // The hash tracks the room you're in, so the address bar is always shareable.
  const bySlug = new Map();
  const favLookup = new Map(); // image_url → { slug, idx } for salon share links
  for (const p of data.periods)
    for (const a of p.artists) {
      if (a.paintings?.some((x) => x.image_url)) bySlug.set(a.slug, { artist: a, period: p });
      (a.paintings ?? []).forEach((x, idx) => {
        if (x.image_url) favLookup.set(x.image_url, { slug: a.slug, idx });
      });
    }

  let sharedParam = null; // the p= list while walking someone else's shared salon

  function parseHash() {
    if (location.hash === '#/salon' || location.hash.startsWith('#/salon?')) {
      const m = location.hash.match(/^#\/salon\?p=([a-z0-9.,-]+)$/i);
      return { slug: '__salon', shared: m ? m[1] : null };
    }
    const m = location.hash.match(/^#\/artist\/([a-z0-9-]+)(?:\/p\/([a-z0-9]+))?$/i);
    return m ? { slug: m[1], pid: m[2] ?? null } : null;
  }

  // #/salon?p=slug.idx,… — decode a friend's favourites into painting objects
  function resolveShared(param) {
    const out = [];
    for (const tok of (param ?? '').split(',')) {
      const m = tok.match(/^([a-z0-9-]+)\.(\d+)$/i);
      const hit = m && bySlug.get(m[1]);
      const p = hit?.artist.paintings?.[Number(m[2])];
      if (p?.image_url && !out.includes(p)) out.push(p);
    }
    return out;
  }

  function salonShareLink() {
    const ids = listFavs()
      .map((u) => favLookup.get(u))
      .filter(Boolean)
      .map((x) => `${x.slug}.${x.idx}`);
    return ids.length
      ? `${location.origin}${location.pathname}#/salon?p=${ids.join(',')}`
      : null;
  }

  function targetFor(h) {
    if (!h) return null;
    if (h.slug === '__salon') {
      const shared = h.shared ?? null;
      const paintings = shared
        ? resolveShared(shared)
        : listFavs().map((u) => ({ image_url: u }));
      return {
        artist: { name: t(shared ? 'fav.sharedRoomName' : 'fav.roomName'), slug: '__salon', paintings },
        period: { slug: '__salon', name: t(shared ? 'fav.sharedRoomSub' : 'fav.roomSub'), color: '#c8a45a' },
        shared,
      };
    }
    const hit = bySlug.get(h.slug);
    return hit ? { ...hit, pid: h.pid ?? null } : null;
  }
  const hashFor = (a) => (a.slug === '__salon'
    ? (sharedParam ? `#/salon?p=${sharedParam}` : '#/salon')
    : `#/artist/${a.slug}`);

  // the enter overlay's sub-line ("Baroque · 14 works from Wikimedia Commons";
  // the salon isn't a Commons collection, so it just counts your favourites)
  function overlaySub(a, p) {
    const n = (a.paintings ?? []).filter((x) => x.image_url).length;
    return a.slug === '__salon'
      ? `${periodName(p)} · ${t('filter.works', { n })}`
      : t('museum.works', { period: periodName(p), n });
  }

  const inspect = createInspectLayer({
    layer: $('inspect-layer'),
    onClose: () => {
      // return the visitor to the walk
      if (museum && !$('museum-view').hidden) museum.lock();
    },
  });

  const card = createCardLayer({
    layer: $('card-layer'),
    onEnterMuseum: (artist, period) => {
      card.hide();
      enterMuseum(artist, period);
    },
  });

  // unhide before creating the timeline so the canvas has real dimensions
  $('timeline-view').hidden = false;
  const timeline = createTimeline({
    canvas: $('timeline-canvas'),
    data,
    onArtistClick: (artist, period) => {
      loadMuseumModule(); // prefetch the 3D bundle while the visitor reads the card
      card.show(artist, period);
    },
  });

  const settings = createSettings({
    root: $('settings-root'),
    onChange: (s) => {
      // sound + tour pace apply live; quality waits for the next entry
      museum?.setVolume(s.sound);
      museum?.setTourPace(s.tourPace);
    },
    onShareLink: salonShareLink,
  });

  const filter = createFilter({
    root: $('filter-root'),
    data,
    onPeriod: (slug) => timeline.focusPeriod(slug),
    onArtist: (slug) => {
      const hit = timeline.focusArtist(slug);
      if (hit) {
        loadMuseumModule();
        setTimeout(() => card.show(hit.artist, hit.period), 950);
      }
    },
    onClear: () => timeline.clearFilter(),
  });

  // ---------- salon button — the favourites wall, one click from the menu ----------
  $('salon-root').innerHTML = `
    <button class="salon-btn" title="${t('salon.btn')}">
      <span class="salon-heart">♥</span><span class="salon-label">${t('salon.btn')}</span>
      <span class="salon-count" hidden></span>
    </button>`;
  const salonCountEl = $('salon-root').querySelector('.salon-count');
  const syncSalonBtn = () => {
    const n = favCount();
    salonCountEl.hidden = n === 0;
    salonCountEl.textContent = n;
  };
  syncSalonBtn();
  subscribeFavs(syncSalonBtn);
  $('salon-root').querySelector('.salon-btn').onclick = () => {
    if (museumOn) return;
    card.hide();
    const tgt = targetFor({ slug: '__salon' });
    enterMuseum(tgt.artist, tgt.period);
  };

  // ---------- guided tour caption + museum map ----------
  const minimap = createMinimap({
    root: $('minimap-root'),
    onJump: (i) => {
      museum?.teleport(i);
      closeMap(true); // click gesture → straight back into the walk
    },
  });

  // ---------- quick jump (Ctrl/Cmd+K) ----------
  let qjWanted = false;
  const quickJump = createQuickJump({
    root: $('quickjump-root'),
    onPick: (i) => {
      qjWanted = false;
      museum?.teleport(i);
      museum?.lock(); // pick gesture → straight into the walk
    },
  });
  function closeQuickJump(relock) {
    qjWanted = false;
    quickJump.hide();
    if (relock && museum) museum.lock();
    else if (museumOn) $('museum-enter-overlay').hidden = false;
  }

  // the floating caption panel serves both the tour ('tour') and the E-key
  // placard ('peek') — only the hint line differs; F re-renders the ♥ line
  let captionState = null;
  function showCaption(p, artistOfP, mode = 'tour') {
    const el = $('tour-caption');
    if (!p) {
      captionState = null;
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    const rerender = captionState?.p === p; // fav toggle → no re-animation
    captionState = { p, artist: artistOfP, mode };
    el.innerHTML = `
      <div class="tc-title">${p.title}</div>
      <div class="tc-meta">${artistOfP.name}${p.year ? ` · ${p.year}` : ''}</div>
      ${p.story ? `<p class="tc-story">${p.story}</p>` : ''}
      <div class="tc-fav">${isFav(p.image_url) ? t('fav.added') : t('fav.add')}</div>
      <div class="tc-hint">${t(mode === 'peek' ? 'placard.hint' : 'tour.hint')}</div>`;
    el.hidden = false;
    if (!rerender)
      gsap.fromTo(el, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' });
  }

  // ---------- controls help (H) ----------
  let vrOk = false;
  function helpOpen() {
    return !$('help-root').hidden;
  }
  function helpToggle(force) {
    const el = $('help-root');
    const show = force ?? el.hidden;
    if (!show) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    const rows = IS_TOUCH ? [
      [t('help.k.joystick'), t('help.move')],
      [t('help.k.drag'), t('help.look')],
      [t('help.k.tap'), t('help.inspect')],
      ['♥', t('help.fav')],
      ['▶', t('help.tour')],
      ['🗺', t('help.map')],
      ...(vrOk ? [['VR', t('help.vr')]] : []),
    ] : [
      ['W A S D', t('help.move')],
      [t('help.k.mouse'), t('help.look')],
      ['Space · Shift', t('help.fly')],
      [t('help.k.click'), t('help.inspect')],
      ['E', t('help.placard')],
      ['F', t('help.fav')],
      ['T', t('help.tour')],
      ['M', t('help.map')],
      ['H', t('help.help')],
      ['ESC', t('help.esc')],
      ...(vrOk ? [['VR', t('help.vr')]] : []),
    ];
    el.innerHTML = `
      <div class="hp-panel">
        <div class="hp-title">${t('help.title')}</div>
        <div class="hp-rows">${rows.map(([k, l]) => `<span class="hp-key">${k}</span><span class="hp-label">${l}</span>`).join('')}</div>
        <div class="hp-share">${t('help.share')}</div>
      </div>`;
    el.hidden = false;
    gsap.fromTo(el, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' });
  }

  let toastTl = null;
  function favToast(added) {
    const el = $('fav-toast');
    el.textContent = added ? t('fav.toast.on') : t('fav.toast.off');
    el.hidden = false;
    toastTl?.kill();
    toastTl = gsap.timeline({ onComplete: () => { el.hidden = true; } })
      .fromTo(el, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.25, ease: 'power2.out' })
      .to(el, { opacity: 0, duration: 0.5, delay: 1.7 });
  }

  function startTour() {
    if (!museum) return;
    $('museum-enter-overlay').hidden = true;
    $('crosshair').style.visibility = 'hidden';
    museum.startTour();
  }

  // thematic tour chips on the enter overlay — only themes with matches
  // (counts come from the Wikidata genre/depicts/gender enrichment)
  function renderThemeChips() {
    const root = $('enter-themes');
    if (!museum) { root.hidden = true; return; }
    const counts = museum.themeCounts();
    const ids = Object.keys(counts).filter((id) => counts[id] > 0);
    if (!ids.length) { root.hidden = true; root.innerHTML = ''; return; }
    root.innerHTML = `<div class="et-title">${t('themes.title')}</div>`
      + ids.map((id) => `<button class="et-chip" data-theme="${id}">${t(`theme.${id}`)} · ${counts[id]}</button>`).join('');
    root.hidden = false;
    for (const btn of root.querySelectorAll('.et-chip')) {
      btn.onclick = () => {
        if (!museum) return;
        $('museum-enter-overlay').hidden = true;
        $('crosshair').style.visibility = 'hidden';
        museum.startThemeTour(btn.dataset.theme);
      };
    }
  }

  function openMap() {
    if (!museum) return;
    minimapWanted = true; // set before unlock/stopTour so the overlay stays away
    museum.stopTour();
    $('museum-enter-overlay').hidden = true;
    if (museum.isLocked()) museum.unlock();
    minimap.show(museum.chain(), museum.currentIndex());
  }

  function closeMap(relock) {
    minimapWanted = false;
    minimap.hide();
    if (relock && museum) museum.lock();
    else $('museum-enter-overlay').hidden = false;
  }

  let minimapWanted = false;
  document.addEventListener('keydown', (ev) => {
    if (!museum || $('museum-view').hidden || inspect.isOpen()) return;
    if (quickJump.isOpen()) {
      if (ev.key === 'Escape') closeQuickJump(false);
      return; // typing in the quick-jump field must not toggle panels
    }
    if (ev.code === 'KeyM') {
      minimap.isOpen() ? closeMap(false) : openMap();
    } else if (ev.code === 'KeyH') {
      helpToggle();
    } else if (ev.code === 'KeyT') {
      if (minimap.isOpen()) closeMap(false);
      if (museum.isTouring()) museum.stopTour(); // onTourEnd brings the overlay back
      else startTour();
    } else if (ev.key === 'Escape') {
      if (helpOpen()) helpToggle(false);
      else if (minimap.isOpen()) closeMap(false);
      else if (museum.isTouring()) museum.stopTour();
    }
  });

  // Ctrl/Cmd+K — quick search: in the museum a teleport list, on the timeline Explore
  document.addEventListener('keydown', (ev) => {
    if (!((ev.ctrlKey || ev.metaKey) && ev.code === 'KeyK')) return;
    ev.preventDefault();
    if (inspect.isOpen()) return;
    if (museumOn && museum && !$('museum-view').hidden) {
      if (quickJump.isOpen()) { closeQuickJump(false); return; }
      qjWanted = true;
      museum.stopTour();
      minimapWanted = false;
      minimap.hide();
      helpToggle(false);
      $('museum-enter-overlay').hidden = true;
      if (museum.isLocked()) museum.unlock();
      quickJump.show(museum.chain());
    } else if (!museumOn) {
      filter.open();
    }
  });

  // ---------- museum lifecycle ----------
  function enterMuseum(artist, period, opts = {}) {
    museumOn = true;
    currentArtist = artist;
    currentPeriod = period;
    sharedParam = artist.slug === '__salon' ? opts.shared ?? null : null;
    if (location.hash !== hashFor(artist)) location.hash = hashFor(artist); // shareable link (+ Back exits)
    const mv = $('museum-view');
    const tv = $('timeline-view');

    $('enter-artist-name').textContent = artist.name;
    $('enter-artist-sub').textContent = overlaySub(artist, period);
    $('museum-title').textContent = `${artist.name} — ${periodName(period)}`;

    // cinematic swap: timeline fades to black, museum fades up
    gsap.to(tv, {
      opacity: 0, duration: 0.6, ease: 'power2.in',
      onComplete: async () => {
        tv.hidden = true;
        tv.style.opacity = 1;
        mv.hidden = false;
        $('museum-hud').hidden = false;
        $('touch-hud').hidden = !IS_TOUCH;
        $('museum-enter-overlay').hidden = false;
        gsap.fromTo(mv, { opacity: 0 }, { opacity: 1, duration: 0.8 });

        let createMuseum;
        try {
          ({ createMuseum } = await loadMuseumModule());
        } catch {
          exitMuseum(); // chunk failed to load (offline?) — back to the timeline
          return;
        }
        if (!museumOn) return; // exited while the 3D bundle was downloading
        museum = createMuseum({
          canvas: $('museum-canvas'),
          artist, period, data,
          quality: qualityOf(settings.get()),
          onInspect: (p, a) => inspect.show(p, a ?? currentArtist),
          onExit: exitMuseum,
          onRoomChange: (a, p) => {
            currentArtist = a;
            currentPeriod = p;
            $('museum-title').textContent = `${a.name} — ${periodName(p)}`;
            // keep the enter overlay fresh (ESC mid-walk shows the room you're in)
            $('enter-artist-name').textContent = a.name;
            $('enter-artist-sub').textContent = overlaySub(a, p);
            history.replaceState(null, '', hashFor(a)); // wandering keeps the link shareable
          },
          onTourStop: (p, a) => showCaption(p, a, 'tour'),
          onTourEnd: (reason) => {
            $('crosshair').style.visibility = '';
            if (reason !== 'resume' && !minimapWanted && !qjWanted) $('museum-enter-overlay').hidden = false;
          },
          onPeek: (p, a) => showCaption(p, a, 'peek'),
          onXR: (active) => {
            if (active) {
              minimapWanted = false;
              minimap.hide();
              helpToggle(false);
              showCaption(null);
              $('museum-enter-overlay').hidden = true;
              $('crosshair').style.visibility = 'hidden';
            } else {
              $('crosshair').style.visibility = '';
              $('museum-enter-overlay').hidden = false;
            }
          },
          onFav: (p, a, added) => {
            favToast(added);
            if (captionState?.p === p) showCaption(p, captionState.artist, captionState.mode);
          },
          sound: settings.get().sound,
          tourPace: settings.get().tourPace,
          salonPaintings: sharedParam ? artist.paintings : null,
        });
        // painting deep link: stand before the work and open it
        if (opts.pid) {
          const hit = museum.focusPainting(opts.pid);
          if (hit) {
            $('museum-enter-overlay').hidden = true;
            inspect.show(hit.p, hit.artist);
          }
        }
        museum.onUnlock(() => {
          if (!inspect.isOpen() && !museum.isTouring() && !minimap.isOpen() && !minimapWanted &&
              !quickJump.isOpen() && !qjWanted)
            $('museum-enter-overlay').hidden = false;
        });
        renderThemeChips();
        window.__museum = museum;
      },
    });
  }

  function exitMuseum() {
    museumOn = false;
    if (museum) { museum.dispose(); museum = null; window.__museum = null; }
    sharedParam = null;
    if (parseHash()) history.replaceState(null, '', location.pathname + location.search);
    minimapWanted = false;
    minimap.hide();
    qjWanted = false;
    quickJump.hide();
    helpToggle(false);
    showCaption(null);
    $('crosshair').style.visibility = '';
    const mv = $('museum-view');
    const tv = $('timeline-view');
    gsap.to(mv, {
      opacity: 0, duration: 0.5,
      onComplete: () => {
        mv.hidden = true;
        mv.style.opacity = 1;
        $('museum-hud').hidden = true;
        tv.hidden = false;
        timeline.resize();
        timeline.invalidate();
        gsap.fromTo(tv, { opacity: 0 }, { opacity: 1, duration: 0.6 });
        // no placard card for the salon — it isn't a real artist
        if (currentArtist && currentArtist.slug !== '__salon') card.show(currentArtist, currentPeriod);
      },
    });
  }

  $('enter-museum-btn').onclick = () => {
    $('museum-enter-overlay').hidden = true;
    museum?.lock();
  };
  $('enter-tour-btn').onclick = startTour;
  $('museum-exit').onclick = exitMuseum;
  $('enter-back-btn').onclick = exitMuseum;

  // floating touch buttons (the HUD only shows them in touch mode)
  $('th-map').onclick = () => { if (museum) minimap.isOpen() ? closeMap(false) : openMap(); };
  $('th-tour').onclick = () => {
    if (!museum) return;
    museum.isTouring() ? museum.stopTour() : startTour();
  };
  $('th-fav').onclick = () => museum?.favCurrent();
  if (IS_TOUCH) $('crosshair').style.display = 'none'; // no centre-aim on touch
  $('museum-help').onclick = () => helpToggle(); // touch devices have no H key
  $('th-menu').onclick = () => {
    if (!museum) return;
    helpToggle(false);
    if (minimap.isOpen()) closeMap(false);
    else if (museum.isTouring()) museum.stopTour();
    else if (museum.isLocked()) museum.unlock();
    else $('museum-enter-overlay').hidden = false;
  };

  // the VR button appears only when an immersive-vr headset is available
  $('enter-vr-btn').onclick = () => museum?.enterVR().catch(() => {});
  if (navigator.xr?.isSessionSupported) {
    navigator.xr.isSessionSupported('immersive-vr')
      .then((ok) => { vrOk = ok; $('enter-vr-btn').hidden = !ok; })
      .catch(() => {});
  }

  // back/forward buttons and hand-edited links drive the museum too
  window.addEventListener('hashchange', () => {
    const h = parseHash();
    if (!h) {
      if (museumOn) exitMuseum();
      return;
    }
    if (museumOn) {
      if (!museum) return;
      // a salon link whose guest list differs needs a fresh museum instance —
      // the hanging salonPaintings option is fixed at creation time
      if (h.slug === '__salon' && (h.shared ?? null) !== sharedParam) {
        const target = targetFor(h);
        museum.dispose();
        museum = null;
        window.__museum = null;
        enterMuseum(target.artist, target.period, { shared: target.shared });
        return;
      }
      const openDeepLink = () => {
        if (!h.pid) return;
        const hit = museum.focusPainting(h.pid);
        if (hit) {
          $('museum-enter-overlay').hidden = true;
          inspect.show(hit.p, hit.artist);
        }
      };
      if (currentArtist?.slug === h.slug) { openDeepLink(); return; } // our own hash write (or a painting jump)
      const i = museum.chain().findIndex((c) => c.slug === h.slug);
      if (i >= 0) {
        museum.teleport(i);
        openDeepLink();
      }
    } else {
      const target = targetFor(h);
      if (!target) return;
      card.hide();
      enterMuseum(target.artist, target.period, { pid: target.pid, shared: target.shared });
    }
  });

  // a shared link spawns you straight in that gallery (or before that painting)
  const startTarget = targetFor(parseHash());
  if (startTarget) enterMuseum(startTarget.artist, startTarget.period, { pid: startTarget.pid, shared: startTarget.shared });

  // ---------- reveal ----------
  const loading = $('loading');
  gsap.to(loading, {
    opacity: 0, duration: 0.8, delay: 0.35, ease: 'power2.in',
    onComplete: () => { loading.hidden = true; },
  });
}

boot();
