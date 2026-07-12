// Quick jump (Ctrl/Cmd+K) — an in-museum overlay that teleports straight to
// any artist's gallery by name. Fed with museum.chain() so the indices it
// reports match museum.teleport(); main.js owns opening/closing around the
// pointer lock. On the timeline the same shortcut opens the Explore panel.

import gsap from 'gsap';
import { t, periodName } from '../i18n.js';

const norm = (s) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function createQuickJump({ root, onPick }) {
  let open = false;
  let entries = []; // museum.chain(): { name, slug, period, works, salon }
  let rows = [];
  let kb = 0;

  function setKb(i) {
    rows[kb]?.classList.remove('kb-focus');
    kb = Math.max(0, Math.min(i, rows.length - 1));
    rows[kb]?.classList.add('kb-focus');
    rows[kb]?.scrollIntoView({ block: 'nearest' });
  }

  function render() {
    const q = norm(root.querySelector('.qj-input').value.trim());
    const list = root.querySelector('.qj-list');
    list.innerHTML = '';
    rows = [];
    const hits = entries
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => !q || norm(e.name).includes(q) || norm(periodName(e.period)).includes(q));
    for (const { e, i } of hits.slice(0, 40)) {
      const b = document.createElement('button');
      b.className = 'qj-item';
      b.innerHTML = `<span class="swatch" style="background:${e.period.color}"></span>
        <span class="qj-name">${e.name}</span>
        <span class="qj-sub">${periodName(e.period)} · ${t('filter.works', { n: e.works })}</span>`;
      b.onclick = () => { hide(); onPick?.(i); };
      list.appendChild(b);
      rows.push(b);
    }
    if (!rows.length) {
      const none = document.createElement('div');
      none.className = 'filter-empty';
      none.textContent = t('qj.empty');
      list.appendChild(none);
    }
    kb = 0;
    setKb(0);
  }

  function show(chain) {
    entries = chain;
    open = true;
    root.hidden = false;
    root.innerHTML = `
      <div class="qj-panel">
        <input class="qj-input" type="text" placeholder="${t('qj.placeholder')}"
               autocomplete="off" spellcheck="false" aria-label="${t('qj.placeholder')}">
        <div class="qj-list"></div>
        <div class="qj-hint">${t('qj.hint')}</div>
      </div>`;
    const input = root.querySelector('.qj-input');
    input.addEventListener('input', render);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); setKb(kb + 1); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); setKb(kb - 1); }
      else if (ev.key === 'Enter') { ev.preventDefault(); rows[kb]?.click(); }
    });
    root.onpointerdown = (ev) => { if (ev.target === root) hide(); };
    render();
    gsap.fromTo(root.querySelector('.qj-panel'),
      { opacity: 0, y: -16 }, { opacity: 1, y: 0, duration: 0.28, ease: 'power2.out' });
    setTimeout(() => input.focus(), 20);
  }

  function hide() {
    if (!open) return;
    open = false;
    root.hidden = true;
    root.innerHTML = '';
  }

  return { show, hide, isOpen: () => open };
}
