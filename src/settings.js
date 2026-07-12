// Persisted user settings: language + render quality. Quality levels scale
// the museum's five big GPU costs — render resolution, the mirror floor
// (a full second render of the scene every frame), shadow-map count/size,
// painting texture size and antialiasing.

export const LANGUAGES = [
  { id: 'en', name: 'English' },
  { id: 'hu', name: 'Magyar' },
];

// Phones/tablets (or any coarse-only pointer) run in touch mode: on-screen
// joystick + drag-look + tap-inspect instead of pointer lock, lighter
// default quality. iPadOS masquerades as MacIntel, hence the touch-points check.
export const IS_TOUCH = typeof matchMedia === 'function' && (
  /Android|iPhone|iPad|iPod|Mobile|Silk|IEMobile|Opera Mini/i.test(navigator.userAgent ?? '')
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  || (matchMedia('(any-pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches)
);

// Display names/hints live in src/locales/*.json as quality.<id>.name/.hint.
// texWidth must be one of Wikimedia's allowed thumbnail buckets
// (250/330/500/960/1280/1920) — other widths return HTTP 400.
export const QUALITY_LEVELS = [
  { id: 'very-low',
    prCap: 0.75, antialias: false, shadows: false, shadowSpots: 0, shadowMapSize: 512,
    mirror: false, mirrorRes: 0, texWidth: 500, aniso: 1 },
  { id: 'low',
    prCap: 1, antialias: false, shadows: false, shadowSpots: 0, shadowMapSize: 512,
    mirror: false, mirrorRes: 0, texWidth: 960, aniso: 2 },
  { id: 'medium',
    prCap: 1.5, antialias: true, shadows: true, shadowSpots: 4, shadowMapSize: 512,
    mirror: false, mirrorRes: 0, texWidth: 960, aniso: 4 },
  { id: 'high',
    prCap: 2, antialias: true, shadows: true, shadowSpots: 6, shadowMapSize: 1024,
    mirror: true, mirrorRes: 1024, texWidth: 1280, aniso: 8 },
  { id: 'very-high',
    prCap: 2, antialias: true, shadows: true, shadowSpots: 6, shadowMapSize: 2048,
    mirror: true, mirrorRes: 1536, texWidth: 1920, aniso: 16 },
];

// guided-tour pace multipliers (stroll speed up, dwell time down)
export const TOUR_PACES = [
  { id: 'slow', value: 0.75 },
  { id: 'normal', value: 1 },
  { id: 'fast', value: 1.3 },
];

const KEY = 'timeline-museum-settings';

export function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { /* fresh visit */ }
  return { lang: 'en', quality: IS_TOUCH ? 1 : 3, sound: 0.7, tourPace: 1, ...s };
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

export const qualityOf = (s) =>
  QUALITY_LEVELS[Math.min(Math.max(s.quality ?? 3, 0), QUALITY_LEVELS.length - 1)];
