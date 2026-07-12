// Procedurally generated material textures (canvas-based) so the gallery has
// rich PBR surfaces without shipping binary assets.

import * as THREE from 'three';

function canvasTexture(w, h, drawFn, { repeat = [1, 1], srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  drawFn(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const rand = (seed) => {
  let s = seed;
  return () => { s = (s * 16807 + 19487171) % 2147483647; return (s & 0xffff) / 0xffff; };
};

// ---- herringbone-ish oak floor ----
export function makeWoodTextures(repeat = [6, 6]) {
  const r = rand(7);
  const draw = (ctx, w, h) => {
    ctx.fillStyle = '#6b4f33';
    ctx.fillRect(0, 0, w, h);
    const plankW = w / 8, plankH = h / 2.2;
    for (let row = 0; row * plankH < h * 1.2; row++) {
      const off = (row % 2) * plankW * 0.5;
      for (let col = -1; col * plankW < w; col++) {
        const x = col * plankW + off, y = row * plankH;
        const tone = 0.82 + r() * 0.36;
        ctx.fillStyle = `rgb(${Math.round(104 * tone)},${Math.round(76 * tone)},${Math.round(48 * tone)})`;
        ctx.fillRect(x + 1.5, y + 1.5, plankW - 3, plankH - 3);
        // grain streaks
        ctx.globalAlpha = 0.16;
        for (let g = 0; g < 14; g++) {
          const gy = y + r() * plankH;
          ctx.strokeStyle = r() > 0.5 ? '#3d2c1a' : '#8f6d47';
          ctx.lineWidth = 0.6 + r() * 1.4;
          ctx.beginPath();
          ctx.moveTo(x, gy);
          ctx.bezierCurveTo(x + plankW * 0.3, gy + (r() - 0.5) * 9, x + plankW * 0.7, gy + (r() - 0.5) * 9, x + plankW, gy);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(28,18,10,.65)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 0.5, y + 0.5, plankW - 1, plankH - 1);
      }
    }
  };
  const map = canvasTexture(1024, 1024, draw, { repeat });
  const rough = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#5a5a5a'; // fairly polished
    ctx.fillRect(0, 0, w, h);
    const rr = rand(23);
    for (let i = 0; i < 2400; i++) {
      const v = 70 + rr() * 90;
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(rr() * w, rr() * h, 2.5, 2.5);
    }
  }, { repeat, srgb: false });
  return { map, roughnessMap: rough };
}

// ---- gallery plaster wall ----
export function makePlasterTextures(base = '#ece7dc', repeat = [3, 1.6]) {
  const r = rand(99);
  const map = canvasTexture(1024, 512, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 26000; i++) {
      const a = 0.02 + r() * 0.05;
      ctx.fillStyle = r() > 0.5 ? `rgba(120,110,95,${a})` : `rgba(255,255,250,${a})`;
      ctx.fillRect(r() * w, r() * h, 1.6, 1.6);
    }
  }, { repeat });
  const rough = canvasTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#c9c9c9';
    ctx.fillRect(0, 0, w, h);
    const rr = rand(41);
    for (let i = 0; i < 9000; i++) {
      const v = 175 + rr() * 60;
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(rr() * w, rr() * h, 2, 2);
    }
  }, { repeat, srgb: false });
  return { map, roughnessMap: rough };
}

// ---- brass wall placard beside each painting ----
export function makePlacardTexture(title, sub) {
  return canvasTexture(512, 288, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#f5f0e4');
    g.addColorStop(1, '#e6dfcd');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(90,75,50,.75)';
    ctx.lineWidth = 3;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.fillStyle = '#241e14';
    ctx.textAlign = 'left';
    const words = (title || 'Untitled').split(' ');
    let lines = [''];
    ctx.font = `500 34px Georgia, serif`;
    for (const wd of words) {
      const test = (lines[lines.length - 1] + ' ' + wd).trim();
      if (ctx.measureText(test).width > w - 80) lines.push(wd);
      else lines[lines.length - 1] = test;
    }
    lines = lines.slice(0, 3);
    lines.forEach((l, i) => ctx.fillText(l, 40, 74 + i * 44));
    ctx.font = `italic 26px Georgia, serif`;
    ctx.fillStyle = '#6b5b3e';
    ctx.fillText(sub, 40, 84 + lines.length * 44);
  });
}

// ---- gauze doorway curtain (alpha channel carries the translucency) ----
export function makeCurtainTexture(tint = '#ece2cb') {
  const t = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const r = rand(311);
    // vertical pleats: alpha swells on the folds, thins between them, so the
    // room beyond reads as light and colour but paintings stay illegible
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const pleat = 0.5 + 0.5 * Math.sin(u * Math.PI * 26 + Math.sin(u * 9) * 1.3);
      ctx.globalAlpha = 0.42 + pleat * 0.5;
      ctx.fillStyle = tint;
      ctx.fillRect(x, 0, 1, h);
      ctx.globalAlpha = (1 - pleat) * 0.3;
      ctx.fillStyle = '#4c3f2c';
      ctx.fillRect(x, 0, 1, h);
    }
    // loose weave: faint horizontal threads
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = '#ffffff';
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y + r() * 2, w, 1);
    // heavier hem at the bottom
    const hem = ctx.createLinearGradient(0, h - 46, 0, h);
    hem.addColorStop(0, 'rgba(60,48,32,0)');
    hem.addColorStop(1, 'rgba(60,48,32,.55)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = hem;
    ctx.fillRect(0, h - 46, w, 46);
  });
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// ---- ornate-ish frame profile color per era ----
export function frameMaterialSpec(year) {
  if (year != null && year >= 1900) {
    return { color: 0x1e1a16, metalness: 0.1, roughness: 0.42 }; // dark walnut float frame
  }
  return { color: 0xa8823c, metalness: 0.92, roughness: 0.28 }; // gilded gold
}
