// Explore — the collection chooser. One button opens a panel with a search
// field (artists + periods together), two browsable tabs (Artists grouped by
// period / Periods), keyboard navigation, and GSAP entrances.

import gsap from 'gsap';
import { t, periodName } from '../i18n.js';

const norm = (s) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function createFilter({ root, data, onPeriod, onArtist, onClear }) {
  const artists = data.periods.flatMap((p) => p.artists.map((a) => ({ ...a, _period: p })));
  artists.sort((a, b) => (a.active_start ?? 0) - (b.active_start ?? 0));

  root.innerHTML = `
    <button class="filter-btn" aria-expanded="false" aria-haspopup="true">
      <span class="label">${t('filter.explore')}</span>
      <span class="active-chip" hidden><span class="chip-text"></span><span class="chip-x" title="${t('filter.clearFilterTitle')}">✕</span></span>
      <span class="chev">▾</span>
    </button>
    <div class="filter-panel" role="dialog" aria-label="${t('filter.dialogAria')}">
      <div class="filter-search">
        <span class="fs-icon">⌕</span>
        <input type="text" class="fs-input" placeholder="${t('filter.searchPlaceholder')}"
               autocomplete="off" spellcheck="false" aria-label="${t('filter.searchAria')}" />
        <button class="fs-clear" hidden title="${t('filter.clearSearch')}">✕</button>
      </div>
      <div class="filter-tabs">
        <button class="filter-tab active" data-tab="artists">${t('filter.tabArtists')}</button>
        <button class="filter-tab" data-tab="periods">${t('filter.tabPeriods')}</button>
        <div class="tab-ink"></div>
      </div>
      <div class="filter-list" tabindex="-1"></div>
      <div class="filter-foot"><span class="ff-count"></span><span class="ff-keys">${t('filter.keys')}</span></div>
    </div>`;

  const btn = root.querySelector('.filter-btn');
  const chip = root.querySelector('.active-chip');
  const chipText = root.querySelector('.chip-text');
  const chipX = root.querySelector('.chip-x');
  const panel = root.querySelector('.filter-panel');
  const input = root.querySelector('.fs-input');
  const fsClear = root.querySelector('.fs-clear');
  const tabsRow = root.querySelector('.filter-tabs');
  const tabs = [...root.querySelectorAll('.filter-tab')];
  const ink = root.querySelector('.tab-ink');
  const list = root.querySelector('.filter-list');
  const count = root.querySelector('.ff-count');

  let open = false;
  let tab = 'artists';
  let active = null;        // { kind, label }
  let rows = [];            // navigable row elements, in visual order
  let kb = -1;              // keyboard-focused index into rows

  // ---------- rendering ----------

  function periodRow(p) {
    const el = document.createElement('button');
    el.className = 'filter-item';
    el.innerHTML = `<span class="swatch" style="background:${p.color}"></span>
      <span class="fi-name">${periodName(p)}</span>
      <span class="fi-sub">${p.start} – ${p.end} · ${t('filter.artistsCount', { n: p.artists.length })}</span>`;
    el.onclick = () => pick({ kind: 'period', label: periodName(p) }, () => onPeriod?.(p.slug));
    return el;
  }

  function artistRow(a) {
    const el = document.createElement('button');
    el.className = 'filter-item';
    const initial = a.name.trim()[0]?.toUpperCase() ?? '·';
    const portrait = a.portrait_thumb
      ? `<img class="fi-portrait" loading="lazy" src="${a.portrait_thumb}" alt=""
           onerror="this.outerHTML='<span class=&quot;fi-mono&quot;>${initial}</span>'">`
      : `<span class="fi-mono">${initial}</span>`;
    const dates = a.active_start
      ? `${a.active_start}–${a.active_end ?? ''}`
      : periodName(a._period);
    el.innerHTML = `${portrait}
      <span class="fi-name">${a.name}<small>${periodName(a._period)}</small></span>
      <span class="fi-sub">${dates}<small>${t('filter.works', { n: a.paintings.length })}</small></span>`;
    el.onclick = () => pick({ kind: 'artist', label: a.name }, () => onArtist?.(a.slug));
    return el;
  }

  function header(text, color) {
    const el = document.createElement('div');
    el.className = 'filter-group-head';
    el.innerHTML = `${color ? `<span class="swatch" style="background:${color}"></span>` : ''}<span>${text}</span>`;
    return el;
  }

  function renderList() {
    list.innerHTML = '';
    rows = [];
    kb = -1;
    const q = norm(input.value.trim());
    const frag = document.createDocumentFragment();

    if (active && !q) {
      const clear = document.createElement('button');
      clear.className = 'filter-item clear-item';
      clear.textContent = t('filter.clearFilter', { label: active.label });
      clear.onclick = () => { setActive(null); onClear?.(); close(); };
      frag.appendChild(clear);
      rows.push(clear);
    }

    if (q) {
      // unified search across both kinds
      const ps = data.periods.filter((p) => norm(p.name).includes(q) || norm(periodName(p)).includes(q));
      const as = artists.filter((a) =>
        norm(a.name).includes(q) || norm(a._period.name) === q || norm(periodName(a._period)) === q);
      if (ps.length) {
        frag.appendChild(header(t('filter.headPeriods')));
        for (const p of ps) { const r = periodRow(p); frag.appendChild(r); rows.push(r); }
      }
      if (as.length) {
        frag.appendChild(header(t('filter.headArtists')));
        for (const a of as) { const r = artistRow(a); frag.appendChild(r); rows.push(r); }
      }
      if (!ps.length && !as.length) {
        const none = document.createElement('div');
        none.className = 'filter-empty';
        none.textContent = t('filter.noMatch', { q: input.value.trim() });
        frag.appendChild(none);
      }
      const n = ps.length + as.length;
      count.textContent = n === 1 ? t('filter.resultOne') : t('filter.results', { n });
    } else if (tab === 'periods') {
      for (const p of data.periods) { const r = periodRow(p); frag.appendChild(r); rows.push(r); }
      count.textContent = t('filter.periodsCount', { n: data.periods.length });
    } else {
      for (const p of data.periods) {
        frag.appendChild(header(`${periodName(p)} · ${p.start}–${p.end}`, p.color));
        for (const a of p.artists) {
          const r = artistRow({ ...a, _period: p });
          frag.appendChild(r);
          rows.push(r);
        }
      }
      count.textContent = t('filter.artistsCount', { n: artists.length });
    }

    list.appendChild(frag);
    list.scrollTop = 0;
    gsap.fromTo(list.children,
      { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: 0.28, stagger: { each: 0.014, from: 0 },
        ease: 'power2.out', overwrite: true, clearProps: 'opacity,transform' });
  }

  function setKb(i) {
    if (kb >= 0) rows[kb]?.classList.remove('kb-focus');
    kb = i;
    if (kb >= 0) {
      rows[kb].classList.add('kb-focus');
      rows[kb].scrollIntoView({ block: 'nearest' });
    }
  }

  function pick(a, fire) {
    setActive(a);
    fire();
    close();
  }

  function setActive(a) {
    active = a;
    chip.hidden = !a;
    chipText.textContent = a ? a.label : '';
  }

  // ---------- open / close ----------

  function positionInk(animated = true) {
    const el = tabs.find((t) => t.dataset.tab === tab);
    gsap.to(ink, {
      x: el.offsetLeft, width: el.offsetWidth,
      duration: animated ? 0.35 : 0, ease: 'power3.out',
    });
  }

  function openPanel() {
    open = true;
    btn.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    panel.style.visibility = 'visible';
    gsap.fromTo(panel,
      { opacity: 0, y: -14, scale: 0.98, transformOrigin: 'top left' },
      { opacity: 1, y: 0, scale: 1, duration: 0.38, ease: 'power3.out', overwrite: true });
    input.value = '';
    fsClear.hidden = true;
    renderList();
    positionInk(false);
    setTimeout(() => input.focus(), 30);
  }

  function close() {
    if (!open) return;
    open = false;
    btn.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    input.blur();
    gsap.to(panel, {
      opacity: 0, y: -10, scale: 0.98, duration: 0.24, ease: 'power2.in', overwrite: true,
      onComplete: () => { if (!open) panel.style.visibility = 'hidden'; },
    });
  }

  // ---------- wiring ----------

  btn.onclick = (ev) => {
    if (ev.target === chipX) return;
    open ? close() : openPanel();
  };
  chipX.onclick = (ev) => {
    ev.stopPropagation();
    setActive(null);
    onClear?.();
  };

  tabs.forEach((t) => {
    t.onclick = () => {
      if (tab === t.dataset.tab) return;
      tab = t.dataset.tab;
      tabs.forEach((x) => x.classList.toggle('active', x === t));
      positionInk();
      renderList();
    };
  });

  input.addEventListener('input', () => {
    fsClear.hidden = input.value === '';
    tabsRow.classList.toggle('muted', input.value.trim() !== '');
    renderList();
  });
  fsClear.onclick = () => {
    input.value = '';
    fsClear.hidden = true;
    tabsRow.classList.remove('muted');
    renderList();
    input.focus();
  };

  panel.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); setKb(Math.min(kb + 1, rows.length - 1)); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); setKb(Math.max(kb - 1, 0)); }
    else if (ev.key === 'Enter' && kb >= 0) { ev.preventDefault(); rows[kb].click(); }
    else if (ev.key === 'Tab') { ev.preventDefault(); tabs[tab === 'artists' ? 1 : 0].click(); }
  });

  document.addEventListener('pointerdown', (ev) => {
    if (open && !root.contains(ev.target)) close();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && open) close();
  });

  return { close, open: () => { if (!open) openPanel(); }, setActive };
}
