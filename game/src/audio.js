// Sound, synthesized: no audio files, no network — every sound is an oscillator or
// a noise buffer through a small bus graph (master -> music / sfx / engine), the
// audio-design skill's layout translated to the Web Audio API. Buses, not per-sound
// volumes; decibels at the edges; headroom on the master; a little random wobble on
// repeated sounds so they never sound robotic. Nothing plays before the first user
// gesture (the browser will not allow it), and every call is a safe no-op until then.

import { RADIO } from './config.js';

// The master level, linear 0..1 — toDb at the edges turns it into decibels.
const MASTER_LEVEL = 0.8;

/** Linear 0..1 to decibels, the way ears hear it. */
function toDb(linear) {
  return 20 * Math.log10(Math.max(0.0001, linear));
}

export function createAudio() {
  let ctx = null;
  let master = null;
  let musicBus = null;
  let sfxBus = null;
  let engineBus = null;
  let noiseBuffer = null;
  let engineNodes = null;
  let sirenNodes = null;
  let musicTimer = null;
  let musicStep = 0;
  let station = 0; // the radio station, 0..RADIO.length-1; R cycles it, M mutes all of it
  let muted = false;
  try {
    muted = window.localStorage.getItem('velmora.muted') === '1';
  } catch {
    muted = false;
  }

  /** Build the graph on the first gesture; safe to call any number of times. */
  function unlock() {
    if (ctx) {
      if (ctx.state === 'suspended') void ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) return;
    try {
      ctx = new AC();
    } catch {
      // No audio device (some headless setups): the game plays on silently.
      ctx = null;
      return;
    }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : Math.pow(10, toDb(MASTER_LEVEL) / 20);
    // A limiter on the master: a safety net against clipping, never the mixer.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    master.connect(limiter);
    limiter.connect(ctx.destination);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.5;
    musicBus.connect(master);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.9;
    sfxBus.connect(master);
    engineBus = ctx.createGain();
    engineBus.gain.value = 0;
    engineBus.connect(master);
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }

  /**
   * A one-shot oscillator with an attack/decay envelope, freed when it ends.
   * `delay` starts it later (for two-note sounds), `slideTo` bends its pitch.
   */
  function tone(freq, dur, type, vol, bus, slideTo, delay = 0) {
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(bus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  /** A one-shot burst of filtered noise, freed when it ends. */
  function noise(dur, vol, filterFreq, filterType, q) {
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    filter.Q.value = q ?? 1;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(sfxBus);
    src.start();
    src.stop(ctx.currentTime + dur + 0.05);
  }

  /** One chord of the current station: its notes, its wave, its pace. */
  function playChord(step) {
    if (!ctx || musicTimer === null) return;
    const stationDef = RADIO[station];
    const notes = stationDef.chords[step % stationDef.chords.length];
    const seconds = stationDef.seconds;
    for (const freq of notes) {
      const osc = ctx.createOscillator();
      osc.type = stationDef.wave;
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(stationDef.vol, ctx.currentTime + 0.5);
      gain.gain.setValueAtTime(stationDef.vol, ctx.currentTime + seconds - 0.6);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + seconds);
      osc.connect(gain);
      gain.connect(musicBus);
      osc.start();
      osc.stop(ctx.currentTime + seconds + 0.05);
    }
  }

  /** Restart the chord loop on the current station's pace (after a station change). */
  function restartMusic() {
    if (musicTimer !== null) {
      window.clearInterval(musicTimer);
      musicTimer = null;
    }
    if (!ctx) return;
    musicStep = 0;
    // The timer goes in first: playChord only plays while a loop is live, and
    // the first chord should sound now, not a whole pace later.
    musicTimer = window.setInterval(() => {
      musicStep += 1;
      playChord(musicStep);
    }, RADIO[station].seconds * 1000);
    playChord(0);
  }

  return {
    unlock,
    isMuted() {
      return muted;
    },
    /** M toggles the master bus; the choice survives a reload. */
    toggleMute() {
      muted = !muted;
      try {
        window.localStorage.setItem('velmora.muted', muted ? '1' : '0');
      } catch {
        // Storage can be off: the mute then lasts this visit only.
      }
      if (master) master.gain.setTargetAtTime(muted ? 0 : Math.pow(10, toDb(MASTER_LEVEL) / 20), ctx.currentTime, 0.05);
      return muted;
    },
    /** A drop collected: two bright notes, a touch of random wobble each time. */
    chime() {
      if (!ctx) return;
      const wobble = 1 + (Math.random() - 0.5) * 0.06;
      tone(660 * wobble, 0.14, 'sine', 0.16, sfxBus);
      // The second note lands a beat after the first: schedule it, don't block.
      tone(880 * wobble, 0.21, 'sine', 0.14, sfxBus, undefined, 0.09);
    },
    /** A punch landing: a low thump plus a burst of filtered noise. */
    thud() {
      if (!ctx) return;
      tone(140, 0.13, 'sine', 0.5, sfxBus, 45);
      noise(0.09, 0.3, 320, 'lowpass');
    },
    /** A gunshot: a sharp noise crack with a low click under it. */
    shot() {
      if (!ctx) return;
      noise(0.09, 0.55, 1800, 'bandpass', 0.8);
      tone(220, 0.06, 'square', 0.2, sfxBus, 60);
    },
    /** A shotgun blast: a deep low boom under a noise crack — nothing like the pistol. */
    boom() {
      if (!ctx) return;
      noise(0.28, 0.7, 500, 'lowpass');
      tone(110, 0.22, 'sine', 0.55, sfxBus, 40);
      noise(0.07, 0.5, 1800, 'bandpass', 0.8);
    },
    /** The trigger on an empty magazine: a small dry click. */
    click() {
      if (!ctx) return;
      tone(1200, 0.03, 'square', 0.12, sfxBus);
    },
    /** A mission done: the C-major arpeggio, rising — C5, E5, G5. */
    fanfare() {
      if (!ctx) return;
      const C5 = 523.25;
      const E5 = 659.25;
      const G5 = 783.99;
      tone(C5, 0.16, 'triangle', 0.2, sfxBus);
      tone(E5, 0.16, 'triangle', 0.2, sfxBus);
      tone(G5, 0.3, 'triangle', 0.22, sfxBus);
    },
    /** A mission failed: two falling notes. */
    fail() {
      if (!ctx) return;
      tone(392, 0.2, 'triangle', 0.18, sfxBus, 311);
      tone(311, 0.3, 'triangle', 0.16, sfxBus, 233);
    },
    /**
     * The engine hum: a sawtooth whose pitch and loudness follow the car's speed,
     * through a low-pass that opens as it revs. speed01 is 0..1; 0 silences it.
     */
    engineSet(speed01, inCar) {
      if (!ctx) return;
      if (!inCar || speed01 <= 0.01) {
        // The oscillators keep running silently: stopping and restarting them on
        // every enter/exit would click, and a silent oscillator costs nothing.
        if (engineNodes) engineBus.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
        return;
      }
      if (!engineNodes) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 55;
        const sub = ctx.createOscillator();
        sub.type = 'sine';
        sub.frequency.value = 28;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 500;
        filter.Q.value = 1.2;
        osc.connect(filter);
        sub.connect(filter);
        filter.connect(engineBus);
        osc.start();
        sub.start();
        engineNodes = { osc, sub, filter };
      }
      const t = ctx.currentTime;
      engineNodes.osc.frequency.setTargetAtTime(55 + 70 * speed01, t, 0.08);
      engineNodes.sub.frequency.setTargetAtTime(28 + 30 * speed01, t, 0.08);
      engineNodes.filter.frequency.setTargetAtTime(400 + 900 * speed01, t, 0.08);
      engineBus.gain.setTargetAtTime(0.05 + 0.07 * speed01, t, 0.08);
    },
    /**
     * The siren: a square wave wailing between two tones on a slow LFO, audible
     * only while the wanted level is above zero.
     */
    sirenSet(on) {
      if (!ctx) return;
      if (!sirenNodes) {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = 850;
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.6;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 150;
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        const gain = ctx.createGain();
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(sfxBus);
        osc.start();
        lfo.start();
        sirenNodes = { gain };
      }
      sirenNodes.gain.gain.setTargetAtTime(on ? 0.045 : 0, ctx.currentTime, 0.2);
    },
    /** The radio loop: the current station's chords, one at a time. On the title
     * screen it is the title music; in play it is the car radio. R cycles stations. */
    musicStart() {
      if (!ctx || musicTimer !== null) return;
      restartMusic();
    },
    musicStop() {
      if (musicTimer !== null) {
        window.clearInterval(musicTimer);
        musicTimer = null;
      }
    },
    /** R cycles the station and restarts the loop on it. Returns the new index. */
    radioNext() {
      station = (station + 1) % RADIO.length;
      if (musicTimer !== null) restartMusic();
      return station;
    },
    /** The station index the loop is on (0 until R is pressed). */
    radioStation() {
      return station;
    },
    /** The station's name, for the HUD. */
    radioName() {
      return RADIO[station].name;
    },
  };
}
