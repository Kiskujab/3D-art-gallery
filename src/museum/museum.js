// First-person museum — an endless enfilade of galleries, one room per
// artist, chained chronologically through centered doorways (wrapping at the
// ends of art history). Only the current room and its two neighbours exist
// at any moment, and the neighbours are bare architectural shells — a gauze
// curtain hangs in every doorway so you see light and colour through it but
// never an unrendered painting. A neighbour's paintings, spotlights and
// textures are hung only when you walk up to its door (and taken down again
// when you retreat), so at most two rooms are ever fully populated. Ten
// era-appropriate room types vary the architecture. One Reflector floor and
// the six shadow-casting spotlights always follow the room the visitor is in.

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { makeWoodTextures, makePlasterTextures, makePlacardTexture, makeCurtainTexture, frameMaterialSpec } from './textures.js';
import { QUALITY_LEVELS, IS_TOUCH } from '../settings.js';
import { t, periodName } from '../i18n.js';
import { listFavs, toggleFav, subscribeFavs } from '../favourites.js';
import { createMuseumAudio } from './audio.js';

const WALL_H = 4.7;
const HANG_Y = 2.05;
const SPACING = 3.9;
const DOOR_W = 2.0;
const DOOR_H = 3.1;
// distances (from the shared doorway) at which a neighbouring shell gets its
// paintings hung / taken down again — the gap between them is hysteresis
const POPULATE_DIST = 6.5;
const DEPOPULATE_DIST = 9.5;
// WebGL caps fragment-shader texture units at 16; every shadow map binds
// into every lit material, so even Very High keeps the spot budget at 6.

// ---- ten room types ----
const PRESETS = [
  { name: 'ivory',     wall: '#e9e3d6', floor: 0xffffff, trim: 0x2c2118, light: 0xfff0d8, sky: 0xf7ecd4, bench: 0x241a11, w: 10.5 },
  { name: 'salon-red', wall: '#7a332c', floor: 0xcdb99d, trim: 0x8a6a34, light: 0xffe9c4, sky: 0xf3ddb4, bench: 0x1c1410, w: 11.5 },
  { name: 'green',     wall: '#48584c', floor: 0xd8cbb2, trim: 0x241c12, light: 0xfff2da, sky: 0xf1e8d2, bench: 0x201811, w: 10.5 },
  { name: 'prussian',  wall: '#3d4d66', floor: 0xc4b49a, trim: 0x1c1a16, light: 0xffedca, sky: 0xeee2c8, bench: 0x181410, w: 11 },
  { name: 'rose',      wall: '#a5766f', floor: 0xe4d7bf, trim: 0x3a2a22, light: 0xfff0dc, sky: 0xf6ead4, bench: 0x2a1f16, w: 10 },
  { name: 'sand',      wall: '#d9cdb4', floor: 0xf0e4cc, trim: 0x4a3826, light: 0xfff4e2, sky: 0xf8f0dc, bench: 0x2e2418, w: 10 },
  { name: 'ochre',     wall: '#bfa06b', floor: 0xbca88c, trim: 0x33281a, light: 0xffedc8, sky: 0xf2e2c0, bench: 0x241c12, w: 10.5 },
  { name: 'charcoal',  wall: '#45413c', floor: 0xaaa296, trim: 0x141210, light: 0xf6efe2, sky: 0xe9e4d8, bench: 0x121110, w: 11 },
  { name: 'white-cube',wall: '#f3f2ee', floor: 0xdfdcd4, trim: 0x8e8b84, light: 0xffffff, sky: 0xffffff, bench: 0x3a3a3a, w: 12 },
  { name: 'umber',     wall: '#5f4a36', floor: 0xbfa284, trim: 0x1e150c, light: 0xffe9c0, sky: 0xefdcb8, bench: 0x191209, w: 9.5 },
  // the visitor's personal salon (index 10 — never picked by ERA_PRESETS)
  { name: 'fav-salon', wall: '#4a3543', floor: 0xd9c9ab, trim: 0x8a6a34, light: 0xffe9c4, sky: 0xf3ddb4, bench: 0x1c1410, w: 11.5 },
];

// era-appropriate pair per period; the artist's index picks between the two
const ERA_PRESETS = {
  medieval: [9, 6], gothic: [3, 9], renaissance: [1, 2], baroque: [1, 3],
  rococo: [4, 5], neoclassicism: [0, 5], romanticism: [2, 3], realism: [6, 9],
  impressionism: [0, 4], 'post-impressionism': [5, 6], expressionism: [7, 1],
  cubism: [7, 3], surrealism: [3, 7], 'abstract-expressionism': [8, 7],
  'pop-art': [8, 0], contemporary: [8, 7],
};
const presetFor = (period, idx) => {
  if (period.slug === '__salon') return PRESETS[10];
  const pair = ERA_PRESETS[period.slug] ?? [0, 5];
  return PRESETS[pair[idx % 2]];
};

let renderer = null;
let pmremEnv = null;
let rendererAA = null;

function getRenderer(canvas, q) {
  // antialiasing is baked into the WebGL context, so a quality change across
  // that boundary needs a fresh canvas + renderer; everything else is live
  if (renderer && rendererAA !== q.antialias) {
    renderer.dispose();
    pmremEnv?.dispose();
    renderer = null;
    pmremEnv = null;
    const fresh = canvas.cloneNode(false);
    canvas.replaceWith(fresh);
    canvas = fresh;
  }
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: q.antialias, powerPreference: 'high-performance' });
    rendererAA = q.antialias;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false; // static scene → bake on demand
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.xr.enabled = true;
    RectAreaLightUniformsLib.init();
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmremEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.prCap));
  renderer.shadowMap.enabled = q.shadows;
  return { r: renderer, canvas };
}

// Touch devices can't pointer-lock, so this shim mirrors the exact
// PointerLockControls surface the museum uses (lock/unlock/isLocked/
// 'lock'+'unlock' events/moveRight/moveForward/dispose): "locked" is just a
// flag that arms one-finger drag-look on the canvas; short touches are
// reported through onTap so the museum can raycast the tapped painting.
function createTouchControls(camera, dom) {
  const listeners = { lock: [], unlock: [] };
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const _v = new THREE.Vector3();
  const PITCH = Math.PI / 2 - 0.05;
  let drag = null;
  const ctl = {
    isLocked: false,
    onTap: null, // (clientX, clientY) — set by the museum
    lock() { if (!ctl.isLocked) { ctl.isLocked = true; listeners.lock.forEach((f) => f()); } },
    unlock() { if (ctl.isLocked) { ctl.isLocked = false; listeners.unlock.forEach((f) => f()); } },
    addEventListener(type, fn) { listeners[type]?.push(fn); },
    removeEventListener(type, fn) {
      const i = listeners[type]?.indexOf(fn) ?? -1;
      if (i >= 0) listeners[type].splice(i, 1);
    },
    // same maths as PointerLockControls: strafing/walking stay on the xz-plane
    moveRight(d) {
      _v.setFromMatrixColumn(camera.matrix, 0);
      camera.position.addScaledVector(_v, d);
    },
    moveForward(d) {
      _v.setFromMatrixColumn(camera.matrix, 0);
      _v.crossVectors(camera.up, _v);
      camera.position.addScaledVector(_v, d);
    },
    dispose() {
      dom.removeEventListener('pointerdown', down);
      dom.removeEventListener('pointermove', move);
      dom.removeEventListener('pointerup', up);
      dom.removeEventListener('pointercancel', cancel);
    },
  };
  function down(ev) {
    if (!ev.isPrimary) return;
    drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, t: performance.now(), moved: 0 };
  }
  function move(ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    drag.x = ev.clientX; drag.y = ev.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (!ctl.isLocked) return; // a tour or overlay owns the camera
    euler.setFromQuaternion(camera.quaternion);
    euler.y -= dx * 0.0042;
    euler.x = THREE.MathUtils.clamp(euler.x - dy * 0.0042, -PITCH, PITCH);
    camera.quaternion.setFromEuler(euler);
  }
  function up(ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    const tap = drag.moved < 12 && performance.now() - drag.t < 350;
    drag = null;
    if (tap) ctl.onTap?.(ev.clientX, ev.clientY);
  }
  function cancel() { drag = null; }
  dom.addEventListener('pointerdown', down);
  dom.addEventListener('pointermove', move);
  dom.addEventListener('pointerup', up);
  dom.addEventListener('pointercancel', cancel);
  return ctl;
}

export function createMuseum({ canvas, artist, period, data, onInspect, onExit, onRoomChange, onTourStop, onTourEnd, onPeek, onFav, onXR, quality, sound, tourPace, salonPaintings }) {
  const q = quality ?? QUALITY_LEVELS[3];
  const got = getRenderer(canvas, q);
  const r = got.r;
  canvas = got.canvas;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0906);
  scene.environment = pmremEnv;
  scene.environmentIntensity = 0.18;
  scene.add(new THREE.HemisphereLight(0xfff5e6, 0x35281a, 0.34));

  // ---- the chronological chain of artists (wraps → infinite wandering) ----
  const seq = [];
  for (const p of data.periods) {
    for (const a of p.artists) {
      if (a.paintings?.some((x) => x.image_url)) seq.push({ artist: a, period: p });
    }
  }
  seq.sort((x, y) => (x.artist.active_start ?? x.period.start) - (y.artist.active_start ?? y.period.start));

  // ---- the personal salon: favourited paintings, hung together at the end
  // of art history (between the newest artist and the wrap back to the oldest)
  const favIndex = new Map();
  for (const e of seq)
    for (const p of e.artist.paintings) if (p.image_url) favIndex.set(p.image_url, { p, artist: e.artist });
  // a guest salon (shared link) hangs the sender's list instead of local favs
  const resolveFavs = () => (salonPaintings
    ? salonPaintings.filter((p) => p.image_url)
    : listFavs().map((u) => favIndex.get(u)?.p).filter(Boolean));
  const salonEntry = {
    salon: true,
    artist: { name: t(salonPaintings ? 'fav.sharedRoomName' : 'fav.roomName'), slug: '__salon', paintings: resolveFavs() },
    period: { slug: '__salon', name: t(salonPaintings ? 'fav.sharedRoomSub' : 'fav.roomSub'), color: '#c8a45a' },
  };
  seq.push(salonEntry);
  // rooms are laid out end to end, so the salon's length is frozen for the
  // visit (with headroom); paintings hearted mid-walk squeeze in until the
  // next museum entry re-measures
  const salonLen = Math.ceil(Math.max(resolveFavs().length, 8) / 2) * SPACING + 5;

  const mod = (n, m) => ((n % m) + m) % m;
  const startIdx = Math.max(seq.findIndex((x) => x.artist.slug === artist.slug), 0);
  const entryFor = (k) => seq[mod(startIdx + k, seq.length)];

  const paintingsOf = (e) => e.artist.paintings.filter((p) => p.image_url);
  const lenFor = (e) => {
    if (e.salon) return salonLen;
    const perSide = Math.ceil(paintingsOf(e).length / 2);
    return Math.max(perSide * SPACING + 5, 14);
  };
  // room k spans z ∈ [zTopFor(k) − len(k), zTopFor(k)]; forward in time is −z
  const zTops = new Map([[0, 0]]);
  function zTopFor(k) {
    if (zTops.has(k)) return zTops.get(k);
    const z = k > 0
      ? zTopFor(k - 1) - lenFor(entryFor(k - 1))
      : zTopFor(k + 1) + lenFor(entryFor(k));
    zTops.set(k, z);
    return z;
  }

  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 120);
  camera.position.set(0, 1.65, -1.7);
  // in VR the headset owns the camera, so locomotion moves this rig instead;
  // on desktop the rig stays at the origin and the controls move the camera
  const player = new THREE.Group();
  player.add(camera);
  scene.add(player);

  const texLoader = new THREE.TextureLoader();
  texLoader.crossOrigin = 'anonymous';

  // paintings decode off the main thread where the browser allows it, so
  // hanging a room doesn't hitch the walk; falls back to TextureLoader
  const bmpLoader = typeof createImageBitmap === 'function'
    ? new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'flipY' }).setCrossOrigin('anonymous')
    : null;
  function loadPaintingTexture(url, onLoad) {
    const fallback = () => texLoader.load(url, onLoad);
    if (!bmpLoader) return fallback();
    bmpLoader.load(url, (bmp) => {
      const tex = new THREE.Texture(bmp);
      tex.flipY = false; // the bitmap was already flipped at decode time
      tex.needsUpdate = true;
      onLoad(tex);
    }, undefined, fallback);
  }

  // procedural sound: room tone + footsteps (the context wakes on a gesture)
  const audio = createMuseumAudio(sound ?? 0.7);

  // one gauze texture shared by every doorway curtain (skipped by disposal)
  const curtainTex = makeCurtainTexture();

  let shadowsDirty = true;
  let bakeFrames = 0;
  const rebake = () => { shadowsDirty = true; bakeFrames = 0; };

  // Average luminance of a painting (0–1); lets each spotlight adapt so
  // white canvases aren't blown out and dark ones aren't murky.
  function paintingLuminance(img) {
    try {
      const s = 32;
      const c = document.createElement('canvas');
      c.width = c.height = s;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, s, s);
      const d = ctx.getImageData(0, 0, s, s).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4)
        sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      return sum / (d.length / 4) / 255;
    } catch {
      return null;
    }
  }

  // ---- room construction ----
  const rooms = new Map(); // k → room record

  function buildRoom(k) {
    const entry = entryFor(k);
    const preset = presetFor(entry.period, mod(startIdx + k, seq.length));
    const len = lenFor(entry);
    const w = preset.w;
    const zTop = zTopFor(k);
    const zc = zTop - len / 2;
    const g = new THREE.Group();
    const room = {
      k, group: g, len, w, zTop, preset,
      artist: entry.artist, period: entry.period, entry,
      clickable: [], spots: [], curtains: [], floorMat: null,
      populated: false, artGroup: null,
    };

    const wood = makeWoodTextures([w / 2.2, len / 2.2]);
    const plaster = makePlasterTextures(preset.wall, [len / 4, 1.35]);
    const plasterEnd = makePlasterTextures(preset.wall, [w / 4, 1.35]);

    room.floorMat = new THREE.MeshStandardMaterial({
      map: wood.map, roughnessMap: wood.roughnessMap,
      color: preset.floor, roughness: 0.55, metalness: 0.06,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, len), room.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0.012, zc);
    floor.receiveShadow = true;
    g.add(floor);

    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(w, len),
      new THREE.MeshStandardMaterial({ color: 0xdcd6c8, roughness: 0.95 })
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, WALL_H, zc);
    g.add(ceiling);

    const wallMat = new THREE.MeshStandardMaterial({
      map: plaster.map, roughnessMap: plaster.roughnessMap, roughness: 0.94, metalness: 0,
    });
    const wallMatEnd = new THREE.MeshStandardMaterial({
      map: plasterEnd.map, roughnessMap: plasterEnd.roughnessMap, roughness: 0.94, metalness: 0,
    });
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, WALL_H), wallMat);
      m.position.set(side * (w / 2), WALL_H / 2, zc);
      m.rotation.y = side === -1 ? Math.PI / 2 : -Math.PI / 2;
      m.receiveShadow = true;
      g.add(m);
    }

    const trimMat = new THREE.MeshStandardMaterial({ color: preset.trim, roughness: 0.4, metalness: 0.15 });

    // end walls with a centered doorway; each faces into this room and sits
    // 2cm inside the boundary so neighbouring rooms' walls never z-fight.
    // `dir` is the direction INTO this room along z: far wall +1, entrance -1.
    function doorWall(zBoundary, dir, neighborEntry) {
      const z = zBoundary + dir * 0.02;
      const ry = dir === 1 ? 0 : Math.PI;
      const segW = (w - DOOR_W) / 2;
      for (const side of [-1, 1]) {
        const seg = new THREE.Mesh(new THREE.PlaneGeometry(segW, WALL_H), wallMatEnd);
        seg.position.set(side * (DOOR_W / 2 + segW / 2), WALL_H / 2, z);
        seg.rotation.y = ry;
        seg.receiveShadow = true;
        g.add(seg);
      }
      const lintel = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_W, WALL_H - DOOR_H), wallMatEnd);
      lintel.position.set(0, DOOR_H + (WALL_H - DOOR_H) / 2, z);
      lintel.rotation.y = ry;
      lintel.receiveShadow = true;
      g.add(lintel);

      // portal casing protruding into this room
      const jambD = 0.14, jambW = 0.16;
      for (const side of [-1, 1]) {
        const jamb = new THREE.Mesh(new THREE.BoxGeometry(jambW, DOOR_H + 0.16, jambD), trimMat);
        jamb.position.set(side * (DOOR_W / 2 + jambW / 2 - 0.02), (DOOR_H + 0.16) / 2, z + dir * jambD * 0.5);
        jamb.castShadow = true;
        g.add(jamb);
      }
      const header = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W + jambW * 2, 0.22, jambD), trimMat);
      header.position.set(0, DOOR_H + 0.16, z + dir * jambD * 0.5);
      header.castShadow = true;
      g.add(header);

      // plaque above the door naming the neighbouring gallery
      const plaque = new THREE.Mesh(
        new THREE.PlaneGeometry(1.3, 0.42),
        new THREE.MeshStandardMaterial({
          map: makePlacardTexture(neighborEntry.artist.name, periodName(neighborEntry.period)),
          roughness: 0.6,
        })
      );
      plaque.position.set(0, DOOR_H + 0.62, z + dir * 0.04);
      plaque.rotation.y = ry;
      g.add(plaque);

      // baseboard segments flanking the door
      for (const side of [-1, 1]) {
        const bb = new THREE.Mesh(new THREE.BoxGeometry(segW, 0.18, 0.06), trimMat);
        bb.position.set(side * (DOOR_W / 2 + segW / 2), 0.09, z + dir * 0.03);
        g.add(bb);
      }

      // gauze curtain filling the doorway: light and colour pass through,
      // the neighbouring room's contents don't — so neighbours can stay
      // bare shells until you walk up to them. Fades open on approach.
      const curtain = new THREE.Mesh(
        new THREE.PlaneGeometry(DOOR_W + 0.44, DOOR_H + 0.06),
        new THREE.MeshStandardMaterial({
          map: curtainTex, transparent: true, opacity: 1,
          side: THREE.DoubleSide, depthWrite: false, roughness: 1, metalness: 0,
        })
      );
      curtain.position.set(0, (DOOR_H + 0.06) / 2, z + dir * 0.1);
      curtain.rotation.y = ry;
      curtain.renderOrder = 2;
      g.add(curtain);
      room.curtains.push({ mesh: curtain, z: zBoundary });
    }
    doorWall(zTop - len, 1, entryFor(k + 1)); // far → next artist (forward in time)
    doorWall(zTop, -1, entryFor(k - 1));      // entrance → previous artist

    // baseboards + picture rail along the side walls
    for (const side of [-1, 1]) {
      const bb = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, len), trimMat);
      bb.position.set(side * (w / 2 - 0.03), 0.09, zc);
      g.add(bb);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, len), trimMat);
      rail.position.set(side * (w / 2 - 0.025), WALL_H - 0.55, zc);
      g.add(rail);
    }

    // skylight strip + area wash
    const skyStrip = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, len - 4),
      new THREE.MeshStandardMaterial({ color: preset.sky, emissive: preset.sky, emissiveIntensity: 0.5 })
    );
    skyStrip.rotation.x = Math.PI / 2;
    skyStrip.position.set(0, WALL_H - 0.02, zc);
    g.add(skyStrip);
    const areaLight = new THREE.RectAreaLight(preset.light, 3.2, 1.6, len - 4);
    areaLight.position.set(0, WALL_H - 0.05, zc);
    areaLight.rotation.x = -Math.PI / 2;
    g.add(areaLight);

    // benches
    const benchMat = new THREE.MeshStandardMaterial({ color: preset.bench, roughness: 0.35, metalness: 0.1 });
    const nBenches = Math.max(1, Math.round(len / 12));
    for (let b = 0; b < nBenches; b++) {
      const bz = zc + (b - (nBenches - 1) / 2) * 10;
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.09, 2.0), benchMat);
      top.position.set(0, 0.46, bz);
      top.castShadow = true;
      g.add(top);
      for (const [lx, lz] of [[-0.2, -0.85], [0.2, -0.85], [-0.2, 0.85], [0.2, 0.85]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.44, 0.07), benchMat);
        leg.position.set(lx, 0.22, bz + lz);
        leg.castShadow = true;
        g.add(leg);
      }
    }

    scene.add(g);
    rooms.set(k, room);
    return room;
  }

  // ---- hanging the paintings (deferred until the visitor approaches) ----
  function populateRoom(room) {
    if (room.populated) return;
    room.populated = true;
    const { entry, preset, len, w, zTop } = room;
    if (entry.salon) entry.artist.paintings = resolveFavs(); // pick up hearts
    const ag = new THREE.Group();
    room.artGroup = ag;
    room.group.add(ag);

    function hang(p, pos, ry, spotFrom) {
      const aspect = p.width && p.height ? p.width / p.height : 1.25;
      let h = aspect > 1.4 ? 1.45 : 1.75;
      let pw = h * aspect;
      if (pw > 2.9) { pw = 2.9; h = pw / aspect; }

      const grp = new THREE.Group();
      grp.position.copy(pos);
      grp.rotation.y = ry;

      // warm canvas-toned placeholder while the image streams in
      const mat = new THREE.MeshStandardMaterial({ color: 0x746c5e, roughness: 0.85, metalness: 0 });
      const canvasMesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, h), mat);
      canvasMesh.position.z = 0.045;
      // in the salon each painting keeps its real painter for captions/inspect
      const owner = (entry.salon && favIndex.get(p.image_url)?.artist) || entry.artist;
      canvasMesh.userData.painting = p;
      canvasMesh.userData.artist = owner;
      canvasMesh.castShadow = true;
      grp.add(canvasMesh);
      room.clickable.push(canvasMesh);

      const spot = new THREE.SpotLight(preset.light, 90, 0, 1, 0.45, 1.6);
      // gallery walls stream a thumbnail sized to the quality mode; the
      // inspect view always keeps the full-size image
      const texUrl = (p.image_url || '').replace(/\/1920px-/, `/${q.texWidth}px-`);
      loadPaintingTexture(texUrl, (t) => {
        if (!ag.parent) { t.image?.close?.(); t.dispose(); return; } // room was taken down mid-load
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = q.aniso;
        mat.map = t;
        mat.color.set(0xffffff);
        mat.needsUpdate = true;
        const lum = paintingLuminance(t.image);
        if (lum != null) {
          // bright canvases get dimmer light (detail survives tone mapping),
          // dark ones a stronger one
          spot.intensity = 90 * THREE.MathUtils.clamp(0.5 / Math.max(lum, 0.15), 0.45, 1.35);
        }
        rebake();
      });

      const spec = frameMaterialSpec(p.year ?? entry.artist.active_start);
      const frameMat = new THREE.MeshPhysicalMaterial({
        color: spec.color, metalness: spec.metalness, roughness: spec.roughness,
        clearcoat: 0.5, clearcoatRoughness: 0.25, envMapIntensity: 1.4,
      });
      const bw = 0.1, bd = 0.09;
      for (const [sw, sh, sx, sy] of [
        [pw + bw * 2, bw, 0, h / 2 + bw / 2],
        [pw + bw * 2, bw, 0, -h / 2 - bw / 2],
        [bw, h, -pw / 2 - bw / 2, 0],
        [bw, h, pw / 2 + bw / 2, 0],
      ]) {
        const seg = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, bd), frameMat);
        seg.position.set(sx, sy, 0.02);
        seg.castShadow = true;
        grp.add(seg);
      }

      const placard = new THREE.Mesh(
        new THREE.PlaneGeometry(0.46, 0.26),
        new THREE.MeshStandardMaterial({
          map: makePlacardTexture(p.title, entry.salon ? owner.name : p.year ? String(p.year) : entry.artist.name),
          roughness: 0.6,
        })
      );
      placard.position.set(pw / 2 + bw + 0.35, -0.35, 0.02);
      grp.add(placard);
      ag.add(grp);

      const target = new THREE.Object3D();
      target.position.copy(pos);
      spot.position.copy(spotFrom);
      const dist = spotFrom.distanceTo(pos);
      spot.angle = Math.min(Math.atan((Math.max(pw, h) / 2 + 0.55) / dist), 0.85);
      spot.castShadow = false; // assigned to the current room's budget later
      spot.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      spot.shadow.bias = -0.0004;
      spot.shadow.radius = 5;
      spot.shadow.camera.near = 0.5;
      spot.shadow.camera.far = dist + 4;
      ag.add(spot, target);
      spot.target = target;
      room.spots.push(spot);
    }

    // hang chronologically (undated works last) so walking the room reads the
    // painter's career left to right; the salon keeps the visitor's own order
    let list = paintingsOf(entry);
    if (!entry.salon) list = [...list].sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity));
    const perSide = Math.ceil(list.length / 2);
    list.forEach((p, i) => {
      const side = i % 2 === 0 ? -1 : 1;
      const idx = Math.floor(i / 2);
      const z = zTop - 2.4 - (idx + 0.5) * ((len - 4.8) / perSide);
      hang(
        p,
        new THREE.Vector3(side * (w / 2 - 0.06), HANG_Y, z),
        side === -1 ? Math.PI / 2 : -Math.PI / 2,
        new THREE.Vector3(side * (w / 2 - 2.6), WALL_H - 0.35, z)
      );
    });

    // an empty salon greets you with an invitation instead of bare walls
    if (entry.salon && list.length === 0) {
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(2.6, 1.46),
        new THREE.MeshStandardMaterial({
          map: makePlacardTexture(t('fav.emptyTitle'), t('fav.emptySub')),
          roughness: 0.6,
        })
      );
      sign.position.set(-w / 2 + 0.08, HANG_Y, zTop - len / 2);
      sign.rotation.y = Math.PI / 2;
      ag.add(sign);
    }
    rebake();
  }

  function disposeTree(node) {
    node.traverse((o) => {
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        for (const key of ['map', 'roughnessMap', 'normalMap', 'emissiveMap']) {
          if (m[key] && m[key] !== curtainTex) {
            m[key].image?.close?.(); // free ImageBitmap memory eagerly
            m[key].dispose?.();
          }
        }
        m.dispose?.();
      }
      if (o.isLight) o.dispose?.();
    });
  }

  // take a room's paintings/spotlights down again (visitor retreated)
  function depopulateRoom(room) {
    if (!room.populated) return;
    room.populated = false;
    room.group.remove(room.artGroup);
    disposeTree(room.artGroup);
    room.artGroup = null;
    room.clickable.length = 0;
    room.spots.length = 0;
  }

  function disposeRoom(k) {
    const room = rooms.get(k);
    if (!room) return;
    scene.remove(room.group);
    disposeTree(room.group);
    rooms.delete(k);
  }

  const ensureRoom = (k) => rooms.get(k) ?? buildRoom(k);

  // ---- the one Reflector + the shadow budget follow the current room ----
  let mirror = null;
  function setMirror(room) {
    if (!q.mirror) return; // matte floor modes skip the second scene render
    if (mirror) {
      scene.remove(mirror);
      mirror.geometry?.dispose?.();
      mirror.dispose?.();
    }
    mirror = new Reflector(new THREE.PlaneGeometry(room.w, room.len), {
      textureWidth: q.mirrorRes, textureHeight: q.mirrorRes, color: 0x777777, clipBias: 0.003,
    });
    mirror.rotation.x = -Math.PI / 2;
    mirror.position.set(0, 0.001, room.zTop - room.len / 2);
    mirror.visible = !r.xr.isPresenting; // the Reflector is single-eye — hidden in VR
    scene.add(mirror);
  }

  // hand the shadow-casting budget (max 6 spots) to one room's spotlights
  function assignShadowBudget(room) {
    for (const rm of rooms.values()) for (const s of rm.spots) s.castShadow = false;
    let n = 0;
    if (q.shadows) {
      room.spots.forEach((s, i) => {
        if (n < q.shadowSpots && i % 2 === 0) { s.castShadow = true; n++; }
      });
      room.spots.forEach((s) => {
        if (n < q.shadowSpots && !s.castShadow) { s.castShadow = true; n++; }
      });
    }
    rebake();
  }

  let currentK = null;
  function setCurrent(k) {
    if (k === currentK) return;
    currentK = k;
    const room = ensureRoom(k);
    ensureRoom(k - 1);
    ensureRoom(k + 1);
    for (const kk of [...rooms.keys()]) if (Math.abs(kk - k) > 1) disposeRoom(kk);
    populateRoom(room);

    setMirror(room);
    for (const rm of rooms.values()) {
      const isCurrent = rm === room;
      const showMirror = isCurrent && q.mirror && !r.xr.isPresenting;
      if (rm.floorMat.transparent !== showMirror) {
        rm.floorMat.transparent = showMirror;
        rm.floorMat.opacity = showMirror ? 0.86 : 1;
        rm.floorMat.needsUpdate = true;
      }
      // only the current room's curtains hang in its doorways; neighbours'
      // duplicates at the shared boundaries stay hidden (no double gauze)
      for (const c of rm.curtains) c.mesh.visible = isCurrent;
    }
    assignShadowBudget(room);
    audio.setRoom(room.preset, room.len, room.w);
    onRoomChange?.(room.artist, room.period);
  }
  setCurrent(0);

  // paintings hearted (or removed) mid-walk re-hang the salon immediately
  const unsubFavs = subscribeFavs(() => {
    if (salonPaintings) return; // a guest salon shows the shared list, not local favs
    for (const room of rooms.values()) {
      if (room.entry.salon && room.populated) {
        depopulateRoom(room);
        populateRoom(room);
        if (room.k === currentK) assignShadowBudget(room);
      }
    }
  });

  // ---- controls ----
  const controls = IS_TOUCH ? createTouchControls(camera, canvas) : new PointerLockControls(camera, canvas);

  // bottom-left virtual joystick (touch mode): analog WASD, shown while walking
  const joy = { x: 0, y: 0, el: null };
  if (IS_TOUCH) {
    const base = document.createElement('div');
    base.className = 'joystick';
    base.innerHTML = '<div class="joy-knob"></div>';
    canvas.parentElement.appendChild(base);
    joy.el = base;
    const knob = base.firstElementChild;
    const R = 44; // knob travel radius, px
    let jid = null;
    const end = (ev) => {
      if (ev.pointerId !== jid) return;
      jid = null;
      joy.x = 0; joy.y = 0;
      knob.style.transform = '';
    };
    base.addEventListener('pointerdown', (ev) => {
      jid = ev.pointerId;
      base.setPointerCapture(jid);
    });
    base.addEventListener('pointermove', (ev) => {
      if (ev.pointerId !== jid) return;
      const rect = base.getBoundingClientRect();
      let dx = ev.clientX - (rect.left + rect.width / 2);
      let dy = ev.clientY - (rect.top + rect.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > R) { dx *= R / len; dy *= R / len; }
      joy.x = dx / R; joy.y = dy / R;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    });
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);
    // walking is the only time the stick makes sense (tours drive themselves)
    joy.el.style.display = 'none';
    controls.addEventListener('lock', () => { joy.el.style.display = ''; });
    controls.addEventListener('unlock', () => { joy.el.style.display = 'none'; });
  }

  const keys = new Set();
  const onKey = (down) => (ev) => {
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Space'].includes(ev.code)) {
      down ? keys.add(ev.code) : keys.delete(ev.code);
      ev.preventDefault();
    }
  };
  const kd = onKey(true), ku = onKey(false);
  document.addEventListener('keydown', kd);
  document.addEventListener('keyup', ku);

  const vel = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const clock = new THREE.Clock();
  const _lastPos = new THREE.Vector3(camera.position.x, 0, camera.position.z);
  let stepAcc = 0;

  // ---- guided tour: an autopilot that strolls the enfilade chronologically,
  // gliding from painting to painting and pausing at each one while the
  // caption panel (onTourStop) tells its story. Runs without pointer lock. ----
  const TOUR_SPEED = 1.55; // m/s — museum stroll
  const TOUR_TURN = 2.4;   // gaze easing rate
  let pace = tourPace ?? 1; // settings multiplier: stroll speed up, dwell down

  // ---- thematic tours: predicates over the Wikidata enrichment (P136 genre
  // + P180 depicts labels in English, artist P21 gender). A theme tour walks
  // only matching paintings, hopping galleries when a room runs out. ----
  const kw = (p, words) => {
    const hay = [...(p.genres ?? []), ...(p.depicts ?? [])].join(' | ').toLowerCase();
    return words.some((w) => hay.includes(w));
  };
  const THEMES = {
    portraits: (p) => kw(p, ['portrait']),
    landscapes: (p) => kw(p, ['landscape', 'cityscape', 'seascape', 'veduta', 'marine art']),
    stillLife: (p) => kw(p, ['still life', 'still-life']),
    religious: (p) => kw(p, ['religious', 'sacred art', 'christian art', 'madonna', 'crucifixion', 'jesus', 'virgin mary', 'saint', 'biblical', 'annunciation', 'adoration']),
    myth: (p) => kw(p, ['mytholog', 'venus', 'apollo', 'diana', 'nymph', 'cupid', 'bacchus', 'muse']),
    women: (p, a) => a?.gender === 'female',
  };
  const themeMatches = (p, a, themeId) => Boolean(THEMES[themeId]?.(p, a));

  const tour = { active: false, phase: 'idle', idx: 0, dwell: 0, path: [], look: new THREE.Vector3(), theme: null };
  const _tv = new THREE.Vector3();
  const _tm = new THREE.Matrix4();
  const _tq = new THREE.Quaternion();

  // E-key placard: the story panel for whatever painting the crosshair rests
  // on, shown without breaking the pointer lock (peek.mesh = open placard)
  const peek = { mesh: null };
  function setPeek(mesh) {
    if (peek.mesh === mesh) return;
    peek.mesh = mesh;
    onPeek?.(mesh ? mesh.userData.painting : null, mesh?.userData.artist);
  }

  function tourStand(mesh) {
    const wp = new THREE.Vector3();
    mesh.getWorldPosition(wp);
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.getWorldQuaternion(new THREE.Quaternion()));
    const stand = wp.clone().addScaledVector(n, 2.7);
    stand.y = 1.65;
    return { stand, look: wp };
  }

  function tourAimNext() {
    const rm = rooms.get(currentK);
    if (tour.idx < rm.clickable.length) {
      const s = tourStand(rm.clickable[tour.idx]);
      tour.path = [s.stand];
      tour.look.copy(s.look);
      tour.phase = 'walk';
    } else {
      // done with this gallery — through the far doorway, forward in time
      const zDoor = rm.zTop - rm.len;
      tour.path = [
        new THREE.Vector3(0, 1.65, zDoor + 1.3),
        new THREE.Vector3(0, 1.65, zDoor - 1.5),
      ];
      tour.look.set(0, 1.6, zDoor - 6);
      tour.phase = 'door';
    }
  }

  // next matching painting in the current room; when the room is exhausted,
  // teleport to the nearest gallery ahead that still has a match
  function themeAimNext() {
    const rm = rooms.get(currentK);
    for (let i = tour.idx; i < rm.clickable.length; i++) {
      const m = rm.clickable[i];
      if (m.userData.painting && themeMatches(m.userData.painting, m.userData.artist, tour.theme)) {
        tour.idx = i;
        const s = tourStand(m);
        tour.path = [s.stand];
        tour.look.copy(s.look);
        tour.phase = 'walk';
        return;
      }
    }
    for (let dk = 1; dk <= seq.length; dk++) {
      const e = entryFor(currentK + dk);
      if (e.salon) continue;
      if (paintingsOf(e).some((p) => themeMatches(p, e.artist, tour.theme))) {
        setCurrent(currentK + dk);
        const room = rooms.get(currentK);
        camera.position.set(0, 1.65, room.zTop - 1.2);
        camera.lookAt(0, 1.6, room.zTop - room.len);
        vel.set(0, 0, 0);
        tour.idx = 0;
        themeAimNext(); // lands on the match .some() just proved exists
        return;
      }
    }
    stopTour('end'); // no matches anywhere (UI only offers themes with hits)
  }

  const aimNext = () => (tour.theme ? themeAimNext() : tourAimNext());

  function startThemeTour(themeId) {
    if (!THEMES[themeId] || r.xr.isPresenting) return false;
    stopTour();
    tour.theme = themeId;
    tour.active = true;
    vel.set(0, 0, 0);
    setPeek(null);
    audio.resume();
    if (controls.isLocked) controls.unlock();
    populateRoom(rooms.get(currentK));
    tour.idx = 0;
    themeAimNext();
    return tour.active;
  }

  function startTour() {
    if (tour.active || r.xr.isPresenting) return;
    tour.theme = null;
    tour.active = true; // set before unlock so the host can tell why it fired
    vel.set(0, 0, 0);
    setPeek(null);
    audio.resume();
    if (controls.isLocked) controls.unlock();
    const rm = rooms.get(currentK);
    populateRoom(rm);
    // begin at the nearest painting so a mid-room start doesn't walk backwards
    let best = 0, bd = Infinity;
    rm.clickable.forEach((c, i) => {
      c.getWorldPosition(_tv);
      const d = _tv.distanceTo(camera.position);
      if (d < bd) { bd = d; best = i; }
    });
    tour.idx = best;
    tourAimNext();
  }

  function stopTour(reason = 'stop') {
    if (!tour.active) return;
    tour.active = false;
    tour.phase = 'idle';
    tour.theme = null;
    tour.path = [];
    onTourStop?.(null);
    onTourEnd?.(reason);
  }

  function tickTour(dt) {
    if (tour.phase === 'walk' || tour.phase === 'door') {
      const tgt = tour.path[0];
      const d = camera.position.distanceTo(tgt);
      const step = TOUR_SPEED * pace * dt;
      if (d <= step) {
        camera.position.copy(tgt);
        tour.path.shift();
        if (!tour.path.length) {
          if (tour.phase === 'walk') {
            const rm = rooms.get(currentK);
            const mesh = rm.clickable[tour.idx];
            const p = mesh?.userData.painting;
            if (p) {
              // linger long enough to read the story, then move on
              tour.dwell = THREE.MathUtils.clamp(5 + (p.story?.length ?? 0) / 26, 7, 18) / pace;
              tour.phase = 'dwell';
              onTourStop?.(p, mesh.userData.artist);
            } else {
              tour.idx++;
              aimNext();
            }
          } else {
            tour.idx = 0; // arrived in the next gallery (setCurrent already fired)
            aimNext();
          }
        }
      } else {
        camera.position.addScaledVector(_tv.copy(tgt).sub(camera.position).normalize(), step);
      }
    } else if (tour.phase === 'dwell') {
      tour.dwell -= dt;
      if (tour.dwell <= 0) {
        onTourStop?.(null);
        tour.idx++;
        aimNext();
      }
    }
    // ease the gaze toward the current point of interest (roll-free lookAt)
    _tm.lookAt(camera.position, tour.look, camera.up);
    _tq.setFromRotationMatrix(_tm);
    camera.quaternion.slerp(_tq, 1 - Math.exp(-TOUR_TURN * dt));
    // room handover when the autopilot crosses a doorway
    const rm = rooms.get(currentK);
    if (camera.position.z > rm.zTop + 0.02) setCurrent(currentK - 1);
    else if (camera.position.z < rm.zTop - rm.len - 0.02) setCurrent(currentK + 1);
  }

  const raycaster = new THREE.Raycaster();
  const _center = new THREE.Vector2(0, 0);
  function aimedMesh(maxDist = 9, ndc = _center) {
    camera.updateMatrixWorld();
    raycaster.setFromCamera(ndc, camera);
    const clickable = [...rooms.values()].flatMap((rm) => rm.clickable);
    const hits = raycaster.intersectObjects(clickable, false);
    return hits.length && hits[0].distance < maxDist ? hits[0].object : null;
  }

  function onClick() {
    if (IS_TOUCH) return; // taps are handled below (browsers fire click after touch)
    audio.resume();
    if (tour.active) {
      // click = "I'll walk from here" — hand the camera straight back
      stopTour('resume');
      controls.lock();
      return;
    }
    if (!controls.isLocked) return;
    const mesh = aimedMesh(9);
    if (mesh) {
      controls.unlock();
      onInspect?.(mesh.userData.painting, mesh.userData.artist);
    }
  }
  canvas.addEventListener('click', onClick);
  controls.addEventListener('unlock', () => setPeek(null));

  // touch mode: a short tap resumes walking during a tour, otherwise it
  // inspects the painting under the finger (raycast from the tap point)
  const _ndc = new THREE.Vector2();
  if (IS_TOUCH) {
    controls.onTap = (x, y) => {
      audio.resume();
      if (tour.active) {
        stopTour('resume');
        controls.lock();
        return;
      }
      if (!controls.isLocked) return;
      const rect = canvas.getBoundingClientRect();
      _ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
      const mesh = aimedMesh(9, _ndc);
      if (mesh) {
        controls.unlock();
        onInspect?.(mesh.userData.painting, mesh.userData.artist);
      }
    };
  }

  // E reads the placard of the painting under the crosshair; F hearts it
  // for the salon (during a tour dwell, F hearts the captioned painting)
  function onActionKey(ev) {
    if (ev.code === 'KeyE') {
      if (!controls.isLocked || tour.active) return;
      const m = aimedMesh(10);
      setPeek(m === peek.mesh ? null : m);
    } else if (ev.code === 'KeyF') {
      let mesh = null;
      if (controls.isLocked && !tour.active) mesh = aimedMesh(10) ?? peek.mesh;
      else if (tour.active && tour.phase === 'dwell') mesh = rooms.get(currentK)?.clickable[tour.idx];
      const p = mesh?.userData.painting;
      if (!p) return;
      const added = toggleFav(p.image_url);
      audio.favBlip(added);
      onFav?.(p, mesh.userData.artist, added);
    }
  }
  document.addEventListener('keydown', onActionKey);

  // walls of the current room; the doorway band is passable below the lintel
  function clampWorld(p) {
    const room = rooms.get(currentK);
    const zHi = room.zTop - 0.5;
    const zLo = room.zTop - room.len + 0.5;
    const doorX = DOOR_W / 2 - 0.32;
    if (!(Math.abs(p.x) < doorX && p.y < DOOR_H - 0.25)) {
      p.z = THREE.MathUtils.clamp(p.z, zLo, zHi);
    } else if (p.z > zHi || p.z < zLo) {
      p.x = THREE.MathUtils.clamp(p.x, -doorX, doorX); // inside the doorway band
    }
    p.x = THREE.MathUtils.clamp(p.x, -room.w / 2 + 0.5, room.w / 2 - 0.5);
    return p;
  }

  // ---- WebXR: the headset owns the camera and locomotion moves the rig —
  // the left thumbstick glides toward your gaze, the right snap-turns 45°
  // (comfort turning). The mirror floor is hidden while presenting because
  // the Reflector renders from a single eye and looks wrong in stereo.
  const _wp = new THREE.Vector3();
  const _xrPos = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);
  const _te = new THREE.Euler();
  let _xrYaw = 0;
  let xrSnapReady = true;

  function setMirrorLive(on) {
    if (!mirror) return;
    mirror.visible = on;
    const rm = rooms.get(currentK);
    if (rm) {
      rm.floorMat.transparent = on;
      rm.floorMat.opacity = on ? 0.86 : 1;
      rm.floorMat.needsUpdate = true;
    }
  }

  async function enterVR() {
    if (!navigator.xr || r.xr.isPresenting) return;
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor'],
    });
    await r.xr.setSession(session);
  }

  function onSessionStart() {
    stopTour();
    setPeek(null);
    if (controls.isLocked) controls.unlock();
    // the rig takes over the walk position; the headset supplies height + gaze
    player.position.set(camera.position.x, 0, camera.position.z);
    _xrPos.set(camera.position.x, 1.65, camera.position.z);
    _xrYaw = 0;
    vel.set(0, 0, 0);
    setMirrorLive(false);
    audio.resume();
    onXR?.(true);
  }

  function onSessionEnd() {
    // hand the walk back to the desktop controls where the headset left off
    player.position.set(0, 0, 0);
    player.rotation.set(0, 0, 0);
    camera.position.set(_xrPos.x, 1.65, _xrPos.z);
    camera.quaternion.setFromEuler(_te.set(0, _xrYaw, 0, 'YXZ'));
    setMirrorLive(true);
    onXR?.(false);
  }
  r.xr.addEventListener('sessionstart', onSessionStart);
  r.xr.addEventListener('sessionend', onSessionEnd);

  function tickXR(dt) {
    let mx = 0, mz = 0, turn = 0;
    for (const src of r.xr.getSession().inputSources) {
      const a = src.gamepad?.axes;
      if (!a || a.length < 2) continue;
      const x = a[2] ?? a[0], y = a[3] ?? a[1]; // xr-standard keeps sticks at 2/3
      if (src.handedness === 'right') turn = x;
      else { mx += x; mz += y; }
    }
    if (Math.abs(turn) > 0.65 && xrSnapReady) {
      xrSnapReady = false;
      const ang = -Math.sign(turn) * Math.PI / 4;
      camera.getWorldPosition(_wp); // pivot the rig around where you stand
      player.position.sub(_wp).applyAxisAngle(_up, ang).add(_wp);
      player.rotation.y += ang;
    } else if (Math.abs(turn) < 0.3) xrSnapReady = true;
    _xrYaw = _te.setFromQuaternion(camera.getWorldQuaternion(_tq), 'YXZ').y;
    if (Math.hypot(mx, mz) > 0.15) {
      const sin = Math.sin(_xrYaw), cos = Math.cos(_xrYaw);
      const speed = 2.1; // m/s — a gentler glide than the desktop walk
      player.position.x += (mx * cos + mz * sin) * speed * dt;
      player.position.z += (mz * cos - mx * sin) * speed * dt;
    }
    // collision + room handover on the headset's world position
    camera.getWorldPosition(_wp);
    _xrPos.copy(_wp);
    clampWorld(_xrPos);
    player.position.x += _xrPos.x - _wp.x;
    player.position.z += _xrPos.z - _wp.z;
    const room = rooms.get(currentK);
    if (_xrPos.z > room.zTop + 0.02) setCurrent(currentK - 1);
    else if (_xrPos.z < room.zTop - room.len - 0.02) setCurrent(currentK + 1);
  }

  function resize() {
    if (r.xr.isPresenting) return; // XR manages its own framebuffer
    const w = canvas.clientWidth, h = canvas.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    r.setSize(w, h, false);
  }
  window.addEventListener('resize', resize);
  resize();

  let disposed = false;
  function animate() {
    if (disposed) return;
    const dt = Math.min(clock.getDelta(), 0.05);

    if (r.xr.isPresenting) {
      tickXR(dt);
    } else if (tour.active) {
      tickTour(dt);
    } else if (controls.isLocked) {
      const speed = 3.4;
      dir.set(
        (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + joy.x,
        0,
        (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) + joy.y
      );
      if (dir.lengthSq() > 1) dir.normalize(); // keep the joystick analog
      // fly: Space rises, Shift descends
      const fly = (keys.has('Space') ? 1 : 0) -
                  (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1 : 0);
      vel.x += dir.x * speed * dt * 9;
      vel.z += dir.z * speed * dt * 9;
      vel.y += fly * speed * dt * 7.5;
      vel.multiplyScalar(Math.max(1 - dt * 8, 0));
      controls.moveRight(vel.x * dt);
      controls.moveForward(-vel.z * dt);
      camera.position.y += vel.y * dt;

      // collision: walls of the current room, doorways passable below the
      // lintel, room handover when the boundary is crossed
      const room = rooms.get(currentK);
      clampWorld(camera.position);
      camera.position.y = THREE.MathUtils.clamp(camera.position.y, 1.65, WALL_H - 0.45);

      if (camera.position.z > room.zTop + 0.02) setCurrent(currentK - 1);
      else if (camera.position.z < room.zTop - room.len - 0.02) setCurrent(currentK + 1);

      // an open placard closes once you wander off (or its room was struck)
      if (peek.mesh) {
        peek.mesh.getWorldPosition(_tv);
        let rootNode = peek.mesh;
        while (rootNode.parent) rootNode = rootNode.parent;
        if (rootNode !== scene || _tv.distanceTo(camera.position) > 8) setPeek(null);
      }
    }

    // footsteps: cadence follows actual ground movement (walk, autopilot or
    // VR glide); flying and teleport jumps stay silent
    {
      camera.getWorldPosition(_wp); // == camera.position on desktop; adds the rig in VR
      const moved = Math.hypot(_wp.x - _lastPos.x, _wp.z - _lastPos.z);
      _lastPos.set(_wp.x, 0, _wp.z);
      if (dt > 0 && moved < 1 && (_wp.y < 1.75 || r.xr.isPresenting)) {
        const sp = moved / dt;
        if (sp > 0.25) {
          stepAcc += moved;
          if (stepAcc >= 0.74) { stepAcc = 0; audio.step(Math.min(sp / 3.4, 1)); }
        } else stepAcc = Math.min(stepAcc, 0.4);
      }
    }

    // neighbours hang their paintings only when the visitor nears the shared
    // doorway (taken down again on retreat), and the gauze curtain fades
    // open over the last couple of metres so you never clip through cloth
    const cur = rooms.get(currentK);
    if (cur) {
      const dPrev = cur.zTop - _wp.z;             // to the entrance door
      const dNext = _wp.z - (cur.zTop - cur.len); // to the far door
      const prev = rooms.get(currentK - 1);
      const next = rooms.get(currentK + 1);
      if (prev) {
        if (dPrev < POPULATE_DIST) populateRoom(prev);
        else if (dPrev > DEPOPULATE_DIST) depopulateRoom(prev);
      }
      if (next) {
        if (dNext < POPULATE_DIST) populateRoom(next);
        else if (dNext > DEPOPULATE_DIST) depopulateRoom(next);
      }
      for (const c of cur.curtains) {
        const d = Math.hypot(_wp.x, _wp.z - c.z);
        c.mesh.material.opacity = THREE.MathUtils.smoothstep(d, 0.55, 2.6);
      }
    }

    // re-bake shadow maps for a few frames after any change settles
    if (shadowsDirty && bakeFrames < 5) {
      r.shadowMap.needsUpdate = true;
      bakeFrames++;
      if (bakeFrames >= 5) shadowsDirty = false;
    }

    r.render(scene, camera);
  }
  // not rAF — an active WebXR session has to drive the loop itself
  r.setAnimationLoop(animate);

  function dispose() {
    disposed = true;
    r.setAnimationLoop(null);
    r.xr.removeEventListener('sessionstart', onSessionStart);
    r.xr.removeEventListener('sessionend', onSessionEnd);
    r.xr.getSession()?.end().catch(() => {});
    document.removeEventListener('keydown', kd);
    document.removeEventListener('keyup', ku);
    document.removeEventListener('keydown', onActionKey);
    canvas.removeEventListener('click', onClick);
    window.removeEventListener('resize', resize);
    unsubFavs();
    audio.dispose();
    if (controls.isLocked) controls.unlock();
    controls.dispose?.();
    joy.el?.remove();
    if (mirror) {
      scene.remove(mirror);
      mirror.geometry?.dispose?.();
      mirror.dispose?.();
    }
    for (const k of [...rooms.keys()]) disposeRoom(k);
    curtainTex.dispose();
  }

  return {
    controls,
    dispose,
    lock: () => { audio.resume(); controls.lock(); },
    unlock: () => controls.unlock(),
    isLocked: () => controls.isLocked,
    onUnlock: (fn) => controls.addEventListener('unlock', fn),
    rebakeShadows: rebake,
    startTour,
    startThemeTour,
    // how many paintings match each theme across the whole museum — the
    // host only offers chips for themes that actually have works
    themeCounts: () => {
      const out = {};
      for (const id of Object.keys(THEMES)) out[id] = 0;
      for (const e of seq) {
        if (e.salon) continue;
        for (const p of paintingsOf(e))
          for (const id of Object.keys(THEMES))
            if (themeMatches(p, e.artist, id)) out[id]++;
      }
      return out;
    },
    stopTour,
    isTouring: () => tour.active,
    setVolume: (v) => audio.setVolume(v),
    setTourPace: (p) => { pace = p; },
    // touch ♥ button — hearts what F would: the captioned painting during a
    // tour dwell, otherwise the painting in the middle of the view
    favCurrent: () => {
      let mesh = null;
      if (tour.active && tour.phase === 'dwell') mesh = rooms.get(currentK)?.clickable[tour.idx];
      else mesh = aimedMesh(12) ?? peek.mesh;
      const p = mesh?.userData.painting;
      if (!p) return false;
      const added = toggleFav(p.image_url);
      audio.favBlip(added);
      onFav?.(p, mesh.userData.artist, added);
      return true;
    },
    enterVR,
    // the whole enfilade in chronological order, for the minimap
    chain: () => seq.map((e) => ({
      name: e.artist.name, slug: e.artist.slug, period: e.period,
      salon: !!e.salon, works: e.salon ? resolveFavs().length : paintingsOf(e).length,
    })),
    currentIndex: () => mod(startIdx + currentK, seq.length),
    teleport: (seqIdx) => {
      stopTour();
      setPeek(null);
      audio.resume();
      // pick the wrap of this artist nearest to where the visitor stands
      let k = seqIdx - startIdx;
      k += Math.round((currentK - k) / seq.length) * seq.length;
      setCurrent(k);
      const rm = rooms.get(k);
      camera.position.set(0, 1.65, rm.zTop - 1.7);
      camera.lookAt(0, 1.62, rm.zTop - rm.len);
      vel.set(0, 0, 0);
    },
    currentEntry: () => {
      const rm = rooms.get(currentK);
      return { artist: rm.artist, period: rm.period };
    },
    aimAtPainting: (i = 0) => {
      const rm = rooms.get(currentK);
      const c = rm.clickable[((i % rm.clickable.length) + rm.clickable.length) % rm.clickable.length];
      const wp = new THREE.Vector3();
      c.getWorldPosition(wp);
      const n = new THREE.Vector3(0, 0, 1).applyQuaternion(c.getWorldQuaternion(new THREE.Quaternion()));
      camera.position.copy(wp.clone().add(n.multiplyScalar(3)));
      camera.position.y = 1.65;
      camera.lookAt(wp);
    },
    // deep link (#/artist/<slug>/p/<pid>): stand before a painting by qid or
    // hang-order index ("i3") and hand it back so the host can open inspect
    focusPainting: (pid) => {
      const rm = rooms.get(currentK);
      if (!rm || !pid) return null;
      populateRoom(rm);
      const mesh = /^i\d+$/.test(pid)
        ? rm.clickable[Number(pid.slice(1))] ?? null
        : rm.clickable.find((c) => c.userData.painting.qid === pid) ?? null;
      if (!mesh) return null;
      const s = tourStand(mesh);
      camera.position.copy(s.stand);
      camera.lookAt(s.look);
      vel.set(0, 0, 0);
      return { p: mesh.userData.painting, artist: mesh.userData.artist };
    },
    debug: () => ({
      k: currentK,
      quality: q.id,
      touring: tour.active,
      tourPhase: tour.phase,
      tourIdx: tour.idx,
      tourTheme: tour.theme,
      pace,
      favs: listFavs().length,
      peek: peek.mesh?.userData.painting.title ?? null,
      audio: audio.state(),
      xr: r.xr.isPresenting,
      pixelRatio: r.getPixelRatio(),
      shadows: r.shadowMap.enabled,
      mirror: Boolean(mirror),
      z: Number(camera.position.z.toFixed(2)),
      x: Number(camera.position.x.toFixed(2)),
      rooms: [...rooms.values()].map((rm) => ({
        k: rm.k, artist: rm.artist.name, zTop: Number(rm.zTop.toFixed(1)),
        len: rm.len, preset: rm.preset.name, populated: rm.populated,
        n: rm.clickable.length,
        texOk: rm.clickable.filter((c) => c.material.map).length,
        first: rm.clickable[0]?.userData.painting.title,
        curtains: rm.curtains.map((c) => Number(c.mesh.material.opacity.toFixed(2))),
      })),
    }),
  };
}
