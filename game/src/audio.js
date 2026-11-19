// Sound, synthesized: no audio files, no network — every sound is an oscillator or
// a noise buffer through a small bus graph (master -> music / sfx / engine), the
// audio-design skill's layout translated to the Web Audio API. Buses, not per-sound
// volumes; decibels at the edges; headroom on the master; a little random wobble on
// repeated sounds so they never sound robotic. Nothing plays before the first user
// gesture (the browser will not allow it), and every call is a safe no-op until then.
//
// Each weapon has its own voice now, so the ear knows which gun fired without
// looking: the pistol cracks, the SMG snaps thin and fast, the shotgun booms with
// a pellet spread, and the rifle snaps supersonic and answers itself with an
// echo off the buildings. main.js routes every shot through fire(weapon); shot()
// and boom() stay as the pistol and shotgun voices for anything that still calls
// them by the old names. The engine is three oscillators plus road noise that
// only wakes above a third of top speed, and the siren is a true hi-lo two-tone,
// not a wobble — a police car sounds like a police car.

import { RADIO } from './config.js';

// The master level, linear 0..1 — toDb at the edges turns it into decibels.
const MASTER_LEVEL = 0.8;

// The two siren tones, and how long each one sounds before the other takes over.
const SIREN_HI = 950;
const SIREN_LO = 720;
const SIREN_FLIP_MS = 450;

// Road noise only wakes above this much of top speed, then ramps to full.
const ROAD_NOISE_FROM = 0.35;
const ROAD_NOISE_MAX = 0.05;

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
   * `delay` starts it later (for two-note sounds and echoes), `slideTo` bends
   * its pitch down (or up) across the note.
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

  /**
   * A one-shot burst of filtered noise, freed when it ends. `delay` starts it
   * later — the shotgun's pellet spread and the rifle's echo are just delayed
   * bursts of the same helper. `bus` is the sfx bus unless the caller says otherwise.
   */
  function noise(dur, vol, filterFreq, filterType, q, delay = 0, bus = sfxBus) {
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    filter.Q.value = q ?? 1;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
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

  /** The pistol: one sharp crack — a bandpass noise burst with a square click under it. */
  function pistolShot() {
    if (!ctx) return;
    noise(0.09, 0.55, 1800, 'bandpass', 0.8);
    tone(220, 0.06, 'square', 0.2, sfxBus, 60);
  }

  /**
   * The SMG: a thinner, faster snap than the pistol — higher filter, shorter
   * burst, less low end, and a faint metallic ping on top. It fires at 0.12 s
   * intervals, so the sound stays light enough to overlap itself without mud.
   */
  function smgShot() {
    if (!ctx) return;
    noise(0.06, 0.42, 2400, 'bandpass', 1.2);
    tone(300, 0.04, 'square', 0.14, sfxBus, 90);
    tone(1400, 0.05, 'triangle', 0.06, sfxBus);
  }

  /**
   * The shotgun: a deep low boom under a noise crack, then the pellet spread —
   * two more bursts staggered a few hundredths apart, so the blast has width.
   * The loudest gun in the game, and the slowest to pump.
   */
  function shotgunBlast() {
    if (!ctx) return;
    noise(0.28, 0.7, 500, 'lowpass');
    tone(110, 0.22, 'sine', 0.55, sfxBus, 40);
    noise(0.07, 0.5, 1800, 'bandpass', 0.8);
    // The spread: pellets landing a fraction apart, each its own small burst.
    noise(0.05, 0.3, 1400, 'bandpass', 1.0, 0.02);
    noise(0.05, 0.22, 1100, 'bandpass', 1.0, 0.04);
  }

  /**
   * The rifle: a supersonic snap — the highest, sharpest crack in the game —
   * a deep thump under it, and then the sound coming back off the buildings:
   * a first echo a beat later, a fainter one after that. Nothing else in the
   * game answers itself, so a rifle shot is unmistakable at any distance.
   */
  function rifleShot() {
    if (!ctx) return;
    noise(0.05, 0.7, 3200, 'bandpass', 1.5);
    tone(90, 0.18, 'sine', 0.5, sfxBus, 35);
    // The echo off the towers: the same crack, quieter, twice.
    noise(0.08, 0.25, 1800, 'bandpass', 0.8, 0.13);
    noise(0.08, 0.12, 1200, 'bandpass', 0.8, 0.26);
  }

  /** Build the engine's voices once: two saws (one detuned, for chorus), a sub, and road noise. */
  function buildEngine() {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 55;
    const chorus = ctx.createOscillator();
    chorus.type = 'sawtooth';
    chorus.frequency.value = 55;
    chorus.detune.value = 8; // a few cents apart: the two saws beat, like a real engine
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 28;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    filter.Q.value = 1.2;
    osc.connect(filter);
    chorus.connect(filter);
    sub.connect(filter);
    filter.connect(engineBus);
    osc.start();
    chorus.start();
    sub.start();
    // Road noise: the same white noise, looped through a bandpass, its own gain
    // so it can stay silent at low speed and wash in as the car gets fast.
    const roadSrc = ctx.createBufferSource();
    roadSrc.buffer = noiseBuffer;
    roadSrc.loop = true;
    const roadFilter = ctx.createBiquadFilter();
    roadFilter.type = 'bandpass';
    roadFilter.frequency.value = 700;
    roadFilter.Q.value = 0.7;
    const roadGain = ctx.createGain();
    roadGain.gain.value = 0;
    roadSrc.connect(roadFilter);
    roadFilter.connect(roadGain);
    roadGain.connect(engineBus);
    roadSrc.start();
    return { osc, chorus, sub, filter, roadGain };
  }

  /** Build the siren's two voices: a high and a low square wave, each with its own gain. */
  function buildSiren() {
    const hi = ctx.createOscillator();
    hi.type = 'square';
    hi.frequency.value = SIREN_HI;
    const hiGain = ctx.createGain();
    hiGain.gain.value = 0;
    hi.connect(hiGain);
    hiGain.connect(sfxBus);
    hi.start();
    const lo = ctx.createOscillator();
    lo.type = 'square';
    lo.frequency.value = SIREN_LO;
    const loGain = ctx.createGain();
    loGain.gain.value = 0;
    lo.connect(loGain);
    loGain.connect(sfxBus);
    lo.start();
    return { hiGain, loGain, timer: null, phase: false };
  }

  /** One siren flip: the high tone sounds, then the low one — hi-lo, hi-lo. */
  function sirenFlip() {
    if (!sirenNodes) return;
    sirenNodes.phase = !sirenNodes.phase;
    const t = ctx.currentTime;
    sirenNodes.hiGain.gain.setTargetAtTime(sirenNodes.phase ? 0.04 : 0, t, 0.05);
    sirenNodes.loGain.gain.setTargetAtTime(sirenNodes.phase ? 0 : 0.04, t, 0.05);
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
    /**
     * Fire a named weapon — 'pistol', 'smg', 'shotgun' or 'rifle'. main.js calls
     * this with the gun that fired, so the sound always follows the weapon.
     * An unknown name falls back to the pistol crack rather than silence.
     */
    fire(weapon) {
      if (!ctx) return;
      if (weapon === 'smg') smgShot();
      else if (weapon === 'shotgun') shotgunBlast();
      else if (weapon === 'rifle') rifleShot();
      else pistolShot();
    },
    /** The pistol's crack, on its own. */
    pistolShot,
    /** The SMG's thin fast snap, on its own. */
    smgShot,
    /** The shotgun's boom and pellet spread, on its own. */
    shotgunBlast,
    /** The rifle's supersonic snap and building echo, on its own. */
    rifleShot,
    /** The old name for the pistol crack — kept so older callers still sound right. */
    shot() {
      pistolShot();
    },
    /** The old name for the shotgun blast — kept so older callers still sound right. */
    boom() {
      shotgunBlast();
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
     * The engine hum: two saws (one detuned, for chorus) plus a sub, whose pitch
     * and loudness follow the car's speed, through a low-pass that opens as it
     * revs — and road noise washing in above a third of top speed. speed01 is
     * 0..1; 0 silences it. The oscillators keep running silently when the car
     * stops: stopping and restarting them on every enter/exit would click, and
     * a silent oscillator costs nothing.
     */
    engineSet(speed01, inCar) {
      if (!ctx) return;
      if (!inCar || speed01 <= 0.01) {
        if (engineNodes) {
          engineBus.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
          engineNodes.roadGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
        }
        return;
      }
      if (!engineNodes) engineNodes = buildEngine();
      const t = ctx.currentTime;
      engineNodes.osc.frequency.setTargetAtTime(55 + 70 * speed01, t, 0.08);
      engineNodes.chorus.frequency.setTargetAtTime(55 + 75 * speed01, t, 0.08);
      engineNodes.sub.frequency.setTargetAtTime(28 + 30 * speed01, t, 0.08);
      engineNodes.filter.frequency.setTargetAtTime(400 + 900 * speed01, t, 0.08);
      engineBus.gain.setTargetAtTime(0.05 + 0.07 * speed01, t, 0.08);
      const road = Math.max(0, (speed01 - ROAD_NOISE_FROM) / (1 - ROAD_NOISE_FROM));
      engineNodes.roadGain.gain.setTargetAtTime(ROAD_NOISE_MAX * road, t, 0.15);
    },
    /**
     * The siren: a true hi-lo two-tone — the high square sounds, then the low
     * one, flipping every SIREN_FLIP_MS. Audible only while the wanted level is
     * above zero; off means both tones silent and the flip timer stopped.
     */
    sirenSet(on) {
      if (!ctx) return;
      if (!sirenNodes) sirenNodes = buildSiren();
      if (on) {
        if (sirenNodes.timer === null) {
          sirenNodes.phase = false;
          sirenFlip();
          sirenNodes.timer = window.setInterval(sirenFlip, SIREN_FLIP_MS);
        }
      } else {
        if (sirenNodes.timer !== null) {
          window.clearInterval(sirenNodes.timer);
          sirenNodes.timer = null;
        }
        const t = ctx.currentTime;
        sirenNodes.hiGain.gain.setTargetAtTime(0, t, 0.2);
        sirenNodes.loGain.gain.setTargetAtTime(0, t, 0.2);
      }
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
    /**
     * R cycles the station and restarts the loop on it. A short tuning blip
     * marks the switch, so the ear hears the dial move. Returns the new index.
     */
    radioNext() {
      station = (station + 1) % RADIO.length;
      if (ctx) {
        tone(1250, 0.05, 'triangle', 0.08, sfxBus);
        tone(900, 0.05, 'triangle', 0.06, sfxBus, undefined, 0.06);
      }
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
