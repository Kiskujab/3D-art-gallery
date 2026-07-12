// Painting inspect view — zoomed high-res image beside an ivory panel with
// the title, year, story and fun facts (all Wikipedia-sourced).

import gsap from 'gsap';
import { t } from '../i18n.js';
import { isFav, toggleFav } from '../favourites.js';

export function createInspectLayer({ layer, onClose }) {
  function show(p, artist) {
    layer.hidden = false;
    const facts = (p.facts ?? []).map((f) => `<li>${f}</li>`).join('');
    // paintings with a Wikidata id get a share button — /p/<slug>/<qid> serves
    // an og: preview page that bounces to the in-museum deep link
    const canShare = Boolean(p.qid && artist?.slug && artist.slug !== '__salon');
    layer.innerHTML = `
      <div class="inspect-img-wrap">
        <img src="${p.image_url}" alt="${p.title}">
      </div>
      <aside class="inspect-panel">
        <h2>${p.title}</h2>
        <div class="inspect-meta">${artist.name}${p.year ? ` · ${p.year}` : ''}</div>
        <button class="inspect-fav"></button>${canShare ? `<button class="inspect-share">${t('inspect.copyLink')}</button>` : ''}
        ${p.story ? `<p class="inspect-story">${p.story}</p>` : ''}
        ${facts ? `<div class="inspect-facts"><h3>${t('inspect.facts')}</h3><ul>${facts}</ul></div>` : ''}
        <p class="inspect-license">
          ${t('inspect.imageCredit')}${p.license ? ` · ${p.license}` : ''}
          ${p.wikipedia_url ? ` · <a href="${p.wikipedia_url}" target="_blank" rel="noopener">${t('inspect.wikiArticle')}</a>` : ''}
        </p>
      </aside>
      <button class="inspect-close" aria-label="${t('card.close')}">✕</button>`;

    // heart it for the personal salon at the end of the enfilade
    const favBtn = layer.querySelector('.inspect-fav');
    const syncFav = () => {
      const on = isFav(p.image_url);
      favBtn.classList.toggle('on', on);
      favBtn.textContent = on ? t('fav.btn.added') : t('fav.btn.add');
    };
    syncFav();
    favBtn.onclick = () => { toggleFav(p.image_url); syncFav(); };

    const shareBtn = layer.querySelector('.inspect-share');
    if (shareBtn) {
      shareBtn.onclick = async () => {
        // resolve against the app's directory, not the site root — GitHub
        // Pages serves the app under /<repo>/ (trailing slash: no redirect hop)
        const url = new URL(`p/${artist.slug}/${p.qid}/`, new URL('./', location.href)).href;
        try {
          await navigator.clipboard.writeText(url);
          shareBtn.textContent = t('inspect.copied');
          setTimeout(() => { shareBtn.textContent = t('inspect.copyLink'); }, 1600);
        } catch { /* clipboard blocked — leave the label */ }
      };
    }

    const img = layer.querySelector('img');
    let zoomed = false;
    img.onclick = () => {
      zoomed = !zoomed;
      gsap.to(img, { scale: zoomed ? 1.7 : 1, duration: 0.45, ease: 'power3.out' });
      img.style.cursor = zoomed ? 'zoom-out' : 'zoom-in';
    };

    gsap.fromTo(layer, { opacity: 0 }, { opacity: 1, duration: 0.35 });
    gsap.fromTo(layer.querySelector('.inspect-img-wrap img'),
      { opacity: 0, scale: 0.92 },
      { opacity: 1, scale: 1, duration: 0.6, ease: 'power3.out' });
    gsap.fromTo(layer.querySelector('.inspect-panel'),
      { x: 60, opacity: 0 },
      { x: 0, opacity: 1, duration: 0.5, delay: 0.08, ease: 'power3.out' });

    layer.querySelector('.inspect-close').onclick = hide;
  }

  function hide() {
    if (layer.hidden) return;
    gsap.to(layer, {
      opacity: 0, duration: 0.25,
      onComplete: () => {
        layer.hidden = true;
        layer.innerHTML = '';
        layer.style.opacity = 1;
        onClose?.();
      },
    });
  }

  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') hide(); });

  return { show, hide, isOpen: () => !layer.hidden };
}
