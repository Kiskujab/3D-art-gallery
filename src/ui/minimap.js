// Museum map (M key) — the whole enfilade as a strip of galleries in
// chronological order, coloured by period. Hover names a gallery, click
// teleports there. Opened/closed by main.js; data comes from museum.chain().

import { t, periodName } from '../i18n.js';

export function createMinimap({ root, onJump }) {
  let open = false;
  let chain = [];
  let cur = -1;

  function setLabel(i = cur) {
    const label = root.querySelector('.mm-label');
    const e = chain[i];
    if (!label || !e) return;
    const here = i === cur ? '▲ ' : '';
    label.textContent = `${here}${e.name} — ${periodName(e.period)} · ${t('filter.works', { n: e.works })}`;
  }

  function render() {
    root.innerHTML = `
      <div class="mm-panel">
        <div class="mm-head">
          <span class="mm-title">${t('map.title')}</span>
          <span class="mm-tip">${t('map.hint')}</span>
        </div>
        <div class="mm-strip"></div>
        <div class="mm-label"></div>
      </div>`;
    const strip = root.querySelector('.mm-strip');
    chain.forEach((e, i) => {
      const b = document.createElement('button');
      b.className = 'mm-cell' + (i === cur ? ' current' : '') + (e.salon ? ' salon' : '');
      b.style.setProperty('--c', e.period.color);
      b.title = e.name;
      b.onclick = () => onJump?.(i);
      b.onmouseenter = () => setLabel(i);
      strip.appendChild(b);
    });
    strip.onmouseleave = () => setLabel();
    setLabel();
  }

  return {
    show(newChain, curIdx) {
      chain = newChain;
      cur = curIdx;
      render();
      root.hidden = false;
      open = true;
    },
    hide() {
      root.hidden = true;
      root.innerHTML = '';
      open = false;
    },
    isOpen: () => open,
  };
}
