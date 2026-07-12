// Settings dropdown in the topbar: language, render quality, sound volume
// (live), guided-tour pace (live) and the favourites count + clear.

import { QUALITY_LEVELS, LANGUAGES, TOUR_PACES, loadSettings, saveSettings } from '../settings.js';
import { favCount, clearFavs, subscribeFavs } from '../favourites.js';
import { t } from '../i18n.js';

export function createSettings({ root, onChange, onShareLink }) {
  const s = loadSettings();

  root.innerHTML = `
    <button class="settings-btn" aria-label="${t('settings.btn')}" title="${t('settings.btn')}">
      <span class="gear">⚙</span> ${t('settings.btn')}
    </button>
    <div class="settings-panel" hidden>
      <div class="settings-head">${t('settings.title')}</div>
      <label class="settings-row">
        <span class="settings-label">${t('settings.language')}</span>
        <select class="set-lang">
          ${LANGUAGES.map((l) => `<option value="${l.id}">${l.name}</option>`).join('')}
        </select>
      </label>
      <div class="settings-row settings-col">
        <span class="settings-label">${t('settings.quality')}</span>
        <div class="quality-opts">
          ${QUALITY_LEVELS.map((q, i) => `
            <button class="q-opt" data-i="${i}">
              <span class="q-dots">${'●'.repeat(i + 1)}${'○'.repeat(QUALITY_LEVELS.length - i - 1)}</span>
              <span class="q-text"><b>${t(`quality.${q.id}.name`)}</b><small>${t(`quality.${q.id}.hint`)}</small></span>
            </button>`).join('')}
        </div>
      </div>
      <label class="settings-row">
        <span class="settings-label">${t('settings.sound')}</span>
        <span class="sound-wrap">
          <input type="range" class="set-sound" min="0" max="100" step="5"
                 value="${Math.round((s.sound ?? 0.7) * 100)}" aria-label="${t('settings.sound')}">
          <span class="sound-val"></span>
        </span>
      </label>
      <div class="settings-row">
        <span class="settings-label">${t('settings.tourPace')}</span>
        <span class="pace-opts">
          ${TOUR_PACES.map((p) => `<button class="pace-opt" data-p="${p.value}">${t(`pace.${p.id}`)}</button>`).join('')}
        </span>
      </div>
      <div class="settings-row">
        <span class="settings-label">${t('settings.favs')}</span>
        <span class="fav-line">
          <span class="fav-count"></span>
          <button class="fav-share">${t('settings.favsShare')}</button>
          <button class="fav-clear">${t('settings.favsClear')}</button>
        </span>
      </div>
      <div class="settings-note">${t('settings.note')}</div>
    </div>`;

  const btn = root.querySelector('.settings-btn');
  const panel = root.querySelector('.settings-panel');
  const opts = [...root.querySelectorAll('.q-opt')];
  const paces = [...root.querySelectorAll('.pace-opt')];
  const langSel = root.querySelector('.set-lang');
  const soundSlider = root.querySelector('.set-sound');
  const soundVal = root.querySelector('.sound-val');
  const favCountEl = root.querySelector('.fav-count');
  const favClear = root.querySelector('.fav-clear');
  const favShare = root.querySelector('.fav-share');
  langSel.value = s.lang;

  const sync = () => {
    opts.forEach((o, i) => o.classList.toggle('active', i === s.quality));
    paces.forEach((o) => o.classList.toggle('active', Number(o.dataset.p) === (s.tourPace ?? 1)));
    soundVal.textContent = `${soundSlider.value}%`;
    const n = favCount();
    favCountEl.textContent = t('settings.favsCount', { n });
    favClear.hidden = n === 0;
    favShare.hidden = n === 0;
    btn.classList.toggle('open', !panel.hidden);
  };
  sync();
  subscribeFavs(sync);

  btn.onclick = () => { panel.hidden = !panel.hidden; sync(); };
  for (const o of opts) {
    o.onclick = () => {
      s.quality = Number(o.dataset.i);
      saveSettings(s);
      sync();
      onChange?.(s);
    };
  }
  for (const o of paces) {
    o.onclick = () => {
      s.tourPace = Number(o.dataset.p);
      saveSettings(s);
      sync();
      onChange?.(s);
    };
  }
  soundSlider.oninput = () => {
    s.sound = Number(soundSlider.value) / 100;
    saveSettings(s);
    sync();
    onChange?.(s);
  };
  favClear.onclick = clearFavs; // subscribeFavs re-syncs the row
  favShare.onclick = async () => {
    const link = onShareLink?.();
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      favShare.textContent = t('settings.favsShared');
      setTimeout(() => { favShare.textContent = t('settings.favsShare'); }, 1600);
    } catch { /* clipboard blocked — leave the label */ }
  };
  langSel.onchange = () => {
    s.lang = langSel.value;
    saveSettings(s);
    onChange?.(s);
    location.reload(); // every layer re-renders in the new language
  };
  document.addEventListener('click', (ev) => {
    if (!root.contains(ev.target) && !panel.hidden) { panel.hidden = true; sync(); }
  });

  return { get: () => s };
}
