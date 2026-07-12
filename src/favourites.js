// Favourited paintings, keyed by their (unique) Commons image URL and kept
// in localStorage. The museum hangs them together in a personal salon room
// at the end of the chronological chain; settings shows a count + clear.

const KEY = 'timeline-museum-favs';
let favs = null;
const listeners = new Set();

function load() {
  if (!favs) {
    try { favs = new Set(JSON.parse(localStorage.getItem(KEY)) ?? []); }
    catch { favs = new Set(); }
  }
  return favs;
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify([...load()])); }
  catch { /* private mode — favourites last for the session only */ }
}

const notify = () => { for (const fn of listeners) fn(); };

export const isFav = (url) => load().has(url);
export const listFavs = () => [...load()];
export const favCount = () => load().size;

export function toggleFav(url) {
  const s = load();
  const added = !s.has(url);
  added ? s.add(url) : s.delete(url);
  persist();
  notify();
  return added;
}

export function clearFavs() {
  load().clear();
  persist();
  notify();
}

export function subscribeFavs(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
