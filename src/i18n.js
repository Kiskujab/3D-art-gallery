// Tiny i18n layer. All UI strings live in src/locales/<lang>.json (flat
// key → string maps with {placeholder} substitution); adding a language is
// a new JSON file + one entry in LANGUAGES (src/settings.js). Wikipedia
// content (bios, stories, painting titles) is shown as fetched — the
// only data we localize are the curated period names, keyed by slug.

import en from './locales/en.json';
import hu from './locales/hu.json';
import { loadSettings } from './settings.js';

const LOCALES = { en, hu };
let lang = 'en';

export function initI18n() {
  const wanted = loadSettings().lang;
  lang = LOCALES[wanted] ? wanted : 'en';
}

export function t(key, params = {}) {
  const s = LOCALES[lang][key] ?? LOCALES.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? params[k] : `{${k}}`));
}

export const periodName = (period) => LOCALES[lang][`period.${period.slug}`] ?? period.name;

export const currentLang = () => lang;

// stamps every element carrying data-i18n, plus the document chrome
export function applyStatic(root = document) {
  document.documentElement.lang = lang;
  document.title = t('app.title');
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
}
