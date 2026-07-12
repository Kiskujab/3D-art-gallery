// Procedural museum sound — everything is synthesized with WebAudio (noise
// buffers, filters, a generated impulse response), no audio assets shipped.
// Two layers: a room tone whose colour follows the ten room types, and
// footsteps that feed a reverb send scaled by the room's volume, so the big
// salons echo and the small cabinets stay dry. The AudioContext is created
// lazily inside a user gesture (resume()).

// per-room-type character of the air: lowpass cutoff (Hz) + level multiplier
const ROOM_TONES = {
  'ivory':      { cut: 520, lvl: 1.0 },
  'salon-red':  { cut: 380, lvl: 1.15 },
  'green':      { cut: 440, lvl: 1.0 },
  'prussian':   { cut: 360, lvl: 1.05 },
  'rose':       { cut: 480, lvl: 0.95 },
  'sand':       { cut: 560, lvl: 0.9 },
  'ochre':      { cut: 400, lvl: 1.0 },
  'charcoal':   { cut: 300, lvl: 0.9 },
  'white-cube': { cut: 950, lvl: 1.1 }, // modern gallery: brighter HVAC hiss
  'umber':      { cut: 280, lvl: 1.2 }, // old, dark rooms rumble
  'fav-salon':  { cut: 420, lvl: 1.1 },
};

export function createMuseumAudio(initialVolume = 0.7) {
  let ctx = null;
  let master, wetIn, toneGain, toneFilter, noiseBuf;
  let volume = initialVolume;
  let wanted = null; // last setRoom() params, applied once the ctx exists
  let stepFlip = 1;

  // perceived-loudness curve: slider 0–1 → gain
  const masterGain = () => volume * volume * 0.9;

  // exponentially decaying stereo noise = a perfectly serviceable hall IR
  function makeImpulse(seconds) {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
      }
    }
    return buf;
  }

  function makeNoiseBuffer(seconds, brown) {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * white) / 1.02; d[i] = last * 3.5; }
      else d[i] = white;
    }
    return buf;
  }

  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = masterGain();
    master.connect(ctx.destination);

    // one shared hall reverb; per-room "echo weight" is the send level
    const convolver = ctx.createConvolver();
    convolver.buffer = makeImpulse(2.6);
    const wetOut = ctx.createGain();
    wetOut.gain.value = 0.8;
    wetIn = ctx.createGain();
    wetIn.gain.value = 0.2;
    wetIn.connect(convolver);
    convolver.connect(wetOut);
    wetOut.connect(master);

    // room tone: looping brown noise, gently breathing
    const tone = ctx.createBufferSource();
    tone.buffer = makeNoiseBuffer(4, true);
    tone.loop = true;
    toneFilter = ctx.createBiquadFilter();
    toneFilter.type = 'lowpass';
    toneFilter.frequency.value = 450;
    toneGain = ctx.createGain();
    toneGain.gain.value = 0.0;
    tone.connect(toneFilter);
    toneFilter.connect(toneGain);
    toneGain.connect(master);
    tone.start();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06; // slow "air" swell
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.004;
    lfo.connect(lfoDepth);
    lfoDepth.connect(toneGain.gain);
    lfo.start();

    noiseBuf = makeNoiseBuffer(1.5, false); // reused by every footstep

    if (wanted) applyRoom();
    return true;
  }

  function applyRoom() {
    const { preset, len, w } = wanted;
    const spec = ROOM_TONES[preset.name] ?? { cut: 450, lvl: 1 };
    // room volume drives the echo: ~9.5×14 cabinets stay dry, long salons ring
    const size01 = Math.min(Math.max((w * len - 130) / 260, 0), 1);
    const T = ctx.currentTime;
    toneFilter.frequency.setTargetAtTime(spec.cut, T, 0.8);
    toneGain.gain.setTargetAtTime(0.016 * spec.lvl, T, 0.8);
    wetIn.gain.setTargetAtTime(0.1 + size01 * 0.55, T, 0.6);
  }

  return {
    // must be called from a user gesture (click) so the browser lets it play
    resume() {
      if (volume === 0 && !ctx) return;
      if (ensure() && ctx.state === 'suspended') ctx.resume().catch(() => {});
    },

    setRoom(preset, len, w) {
      wanted = { preset, len, w };
      if (ctx) applyRoom();
    },

    // one footstep: a lowpassed noise thud + faint heel tick, alternating
    // slightly left/right, sent into the reverb so big rooms echo
    step(speed01 = 1) {
      if (!ctx || ctx.state !== 'running') return;
      const t0 = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 220 + Math.random() * 160;
      f.Q.value = 1.1;
      const g = ctx.createGain();
      const peak = (0.30 + Math.random() * 0.12) * (0.6 + speed01 * 0.4);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(peak, t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.10);
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      stepFlip = -stepFlip;
      if (pan) pan.pan.value = stepFlip * 0.12;
      src.connect(f);
      f.connect(g);
      const out = pan ? (g.connect(pan), pan) : g;
      out.connect(master);
      out.connect(wetIn);
      src.start(t0, Math.random() * 1.2, 0.14);

      // heel tick on some steps
      if (Math.random() > 0.4) {
        const tick = ctx.createBufferSource();
        tick.buffer = noiseBuf;
        const hf = ctx.createBiquadFilter();
        hf.type = 'highpass';
        hf.frequency.value = 2600;
        const tg = ctx.createGain();
        tg.gain.setValueAtTime(0.05, t0 + 0.004);
        tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.03);
        tick.connect(hf);
        hf.connect(tg);
        tg.connect(master);
        tg.connect(wetIn);
        tick.start(t0 + 0.004, Math.random() * 1.2, 0.04);
      }
    },

    // little two-note chime when a painting is hearted (down when removed)
    favBlip(added) {
      if (!ctx || ctx.state !== 'running') return;
      const t0 = ctx.currentTime;
      const notes = added ? [659.25, 880] : [440, 329.63];
      notes.forEach((freq, i) => {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = freq;
        const g = ctx.createGain();
        const at = t0 + i * 0.09;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.linearRampToValueAtTime(0.055, at + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
        o.connect(g);
        g.connect(master);
        o.start(at);
        o.stop(at + 0.4);
      });
    },

    setVolume(v) {
      volume = v;
      if (ctx) master.gain.setTargetAtTime(masterGain(), ctx.currentTime, 0.1);
      if (v > 0) this.resume();
    },

    state: () => (ctx ? ctx.state : 'off'),

    dispose() {
      try { ctx?.close(); } catch { /* already closed */ }
      ctx = null;
    },
  };
}
