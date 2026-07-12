# FUNKCIÓK — Idővonal Múzeum

16 korszak · 231 művész · 3 174 festmény (Wikipédia/Wikidata/Commons → Neon Postgres).

## Főmenü (topbar)
- Felfedezés: egyesített kereső (művész + korszak, ékezet-érzéketlen), Művészek/Korszakok fülek, ↑↓/⏎/ESC, szűrő-chip
- ♥ Szalonom gomb élő kedvenc-számlálóval → kedvencek terme
- Beállítások menü
- Ctrl/Cmd+K: az idővonalon a Felfedezést nyitja

## Idővonal
- Zoomolható vászon: 16 korszaksáv közös év-tengelyen; görgetés = zoom, húzás = pan
- Kinyíló korszak → művész-sorok (portré, karrier-vonal, évszámok); kattintás → művészkártya
- Mini-galéria képcsík a zárt sávokban, korszakszínek, hover-effektek
- Mobilon: pinch-zoom két ujjal, koppintás = megnyitás

## Művészkártya
- Portré, név, évek, leírás, Wikipédia-életrajz, korszak-badge, Wikipédia-link
- Magyar nyelven magyar kivonat + magyar wiki-link (202/231 művésznél)
- "Belépés a múzeumba" gomb (közben előtölti a 3D modult)

## 3D múzeum
- Művészenként egy terem, kronologikus lánc, a két végén körbeér; teremhossz a képszámhoz igazodik
- Streaming: csak az aktuális terem + 2 szomszéd él; gézfüggöny az ajtókban
- 10 korszakhű teremtípus + szalon; parketta, vakolat, lambéria, padok, ajtó-plakettek
- Fény: felülvilágító + RectAreaLight, képenként adaptív spot, max 6 árnyék, tükörpadló, ACES
- Képek: évszám szerinti akasztás, korszakfüggő keret, réz placard, minőségfüggő textúraméret
- ImageBitmap textúra-dekódolás → akadásmentes teremváltás

## Irányítás (asztali)
- Pointer lock + WASD/nyilak; Space/Shift repülés; fal/ajtó ütközés
- Kattintás képre = inspect · E = placard · F = kedvenc · T = túra · M = térkép · H = súgó · ESC
- Ctrl+K a múzeumban: gyorsugró kereső → teleport művészhez

## Mobil / érintés
- Virtuális joystick = séta; húzás = nézelődés; koppintás képre = inspect
- Lebegő gombok: 🗺 térkép · ▶ túra · ♥ kedvenc · ☰ menü
- Automatikusan alacsony minőség, tömörített UI kis képernyőn

## Inspect (festmény-nézet)
- Nagy felbontású kép, kattintás = zoom
- Cím, művész, év, Wikipédia-sztori, "Érdemes tudni" tények, licenc + Commons-kredit
- ♥ kedvencelés · 🔗 link másolása

## Túrák
- T: autopilóta képről képre, felirat-panel (cím/év/sztori); megálló a sztori hosszához igazodik
- Terem végén átsétál a következő galériába; kattintás = "innen gyalog"; tempó állítható
- Tematikus túrák a belépő overlay-ről: Portrék 677 · Tájképek 428 · Csendéletek 60 · Vallási 618 · Mitológia 187 · Festőnők 185 — csak egyező képeknél áll meg, teremugrással

## Szalon (kedvencek)
- F vagy inspect-♥ → szalon (localStorage); valódi terem a lánc végén, élőben újraakasztja magát
- Megosztás linkkel (`#/salon?p=…`): a címzett vendégként a te szalonodat járja, F-fel átvehet képeket
- Üresen meghívó tábla; számláló + törlés a beállításokban

## Térkép + súgó
- M: enfilade-csík korszakszínekkel, aktuális terem kiemelve, kattintás = teleport
- H: billentyű-/érintés-táblázat

## Linkek, megosztás
- `#/artist/<slug>` · `#/artist/<slug>/p/<qid|i N>` (kép előtt, inspect nyitva) · `#/salon`
- A címsor mindig az aktuális termet mutatja; böngésző vissza/előre működik
- Statikus OG-előnézet: `/a/<slug>/` és `/p/<slug>/<qid>/` (build-og.mjs generálja; Facebook/Discord kártya)

## VR (WebXR)
- "Belépés VR-ben" gomb headsettel; bal kar = siklás, jobb kar = snap-fordulás; streaming + ütközés VR-ben is

## Hang (procedurális, zero asset)
- Teremtónus, léptek, teremméret-függő visszhang, kedvenc-csengő; hangerő élőben

## Beállítások
- Nyelv (EN/HU) · minőség (5 fokozat) · hangerő · túra-tempó · kedvencek (számláló/megosztás/törlés) — localStorage

## Teljesítmény
- three.js külön lazy chunk (762 kB), induló csomag 127 kB, előtöltés a művészkártyáról
- Statikus adat: `data/museum-data.json` (4,6 MB minified, gzippel ~1,5 MB); hash-elt assetek 1 év cache

## Hosting (GitHub Pages — statikus)
- Élő: https://kiskujab.github.io/3D-art-gallery/ · repo: Kiskujab/3D-art-gallery
- Push a main-re → GitHub Actions build + deploy (`.github/workflows/deploy.yml`); se szerver, se DB, se secret
- Build: `build-data.mjs` (adat a dist-be) → vite (relatív base `./`) → `build-og.mjs` (megosztóoldalak)
- Képek hotlinkelve a Wikimedia Commonsról — a hostot nem terhelik
- 404.html: márkázott „nincs ilyen terem" oldal

## Adat-pipeline + helyi szerver
- `npm run etl`: wiki-fetch (bio, portré, festmények, sztorik, tények; cache-elt, udvarias sleep-ekkel)
- `npm run etl:hu`: magyar kivonatok · `npm run etl:genres`: műfaj/ábrázolás/gender — mindig az etl UTÁN futtatni
- `npm run build`: adat + OG-oldalak a dist-be (pre/post hook) → push = élő deploy
- `npm run db:load` (opcionális): Neon Postgres, qid-dedup → utána built szerver újraindítás
- `npm run serve` (:8787): dist + /api/data + /api/health (DB vagy JSON) · vite dev (:5173, statikus adat)

## Fejlesztői eszközök
- `scripts/drive.mjs`: headless-Chrome teszt (goto/click/key/eval/shot/emulate/tap)
- `window.__museum.debug()`: állapot-dump · `.claude/launch.json`: built + dev szerver
