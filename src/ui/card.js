// Artist card — a museum placard: ivory stock, double-rule frame, engraved
// typography. Entrance/exit animated with GSAP.

import gsap from 'gsap';
import { t, periodName, currentLang } from '../i18n.js';

export function createCardLayer({ layer, onEnterMuseum }) {
  let openCard = null;

  function show(artist, period) {
    layer.hidden = false;
    const lived = [artist.birth_year, artist.death_year].filter((x) => x != null).join(' – ')
      + (artist.death_year == null && artist.birth_year != null ? ' –' : '');
    // Hungarian UI prefers the huwiki extract when the ETL found one
    const hu = currentLang() === 'hu';
    const desc = (hu && artist.description_hu) || artist.description || '';
    const bio = (hu && artist.bio_hu) || artist.bio || '';
    const wikiUrl = (hu && artist.wikipedia_url_hu) || artist.wikipedia_url;
    layer.innerHTML = `
      <article class="placard" role="dialog" aria-label="${artist.name}">
        <button class="placard-close" aria-label="${t('card.close')}">✕</button>
        <div class="placard-frame">
          <div class="placard-head">
            ${artist.portrait_thumb
              ? `<img class="placard-portrait" src="${artist.portrait_thumb}" alt="Portrait of ${artist.name}" onerror="this.remove()">`
              : ''}
            <div class="placard-title">
              <h2>${artist.name}</h2>
              <div class="placard-dates">${lived}</div>
              <div class="placard-desc">${desc}</div>
              <span class="placard-period" style="color:${period.color}">${periodName(period)} · ${period.start}–${period.end}</span>
            </div>
          </div>
          <hr class="placard-rule">
          <p class="placard-bio">${bio}</p>
          <div class="placard-actions">
            <button class="enter-btn">${t('card.enter')}</button>
            <a class="wiki-link" href="${wikiUrl}" target="_blank" rel="noopener">${t('card.wiki')}</a>
          </div>
        </div>
      </article>`;

    const card = layer.querySelector('.placard');
    openCard = card;
    gsap.fromTo(layer, { opacity: 0 }, { opacity: 1, duration: 0.3 });
    gsap.fromTo(card,
      { opacity: 0, y: 34, scale: 0.96, rotateX: 6 },
      { opacity: 1, y: 0, scale: 1, rotateX: 0, duration: 0.55, ease: 'power3.out' });

    layer.querySelector('.placard-close').onclick = hide;
    layer.onclick = (ev) => { if (ev.target === layer) hide(); };
    layer.querySelector('.enter-btn').onclick = () => {
      onEnterMuseum?.(artist, period);
    };
  }

  function hide() {
    if (!openCard) return;
    const card = openCard;
    openCard = null;
    gsap.to(card, { opacity: 0, y: 20, scale: 0.97, duration: 0.28, ease: 'power2.in' });
    gsap.to(layer, {
      opacity: 0, duration: 0.3, delay: 0.05,
      onComplete: () => { layer.hidden = true; layer.innerHTML = ''; layer.style.opacity = 1; },
    });
  }

  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') hide(); });

  return { show, hide };
}
