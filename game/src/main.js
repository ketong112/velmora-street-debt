// Boot and the one loop: input is read every frame, the world advances in fixed 1/60 s
// steps (several in a slow frame, none in a fast one), and the renderer paints what is
// there. The game moves between four screens: title, play, paused and busted. On the title
// the camera drifts over the plaza while the city idles; in play Rook walks Port Velmora
// collecting cash drops toward his debt — or drives a car he just stole, with the police
// after him. Busted ends the run until Space starts it again.
//
// ?seed=N fixes the city. ?shot=start|play|end (with &seed=N) stages that scene instead
// of running the loop, paints it twice and sets window.__shotReady for a screenshot.
import { BEST_KEY, CAR, STEP, STORY } from './config.js';
import { createRandom } from './random.js';
import {
  EVENT_BUSTED,
  EVENT_COIN,
  EVENT_ENTER_CAR,
  EVENT_EXIT_CAR,
  EVENT_HEAT,
  EVENT_HIT_PED,
  EVENT_MISSION_DONE,
  EVENT_MISSION_EVADE,
  EVENT_MISSION_FAIL,
  EVENT_MISSION_HIDEOUT,
  EVENT_MISSION_PACKAGE,
  EVENT_MISSION_RETURN,
  EVENT_MISSION_START,
  EVENT_PISTOL,
  EVENT_PUNCH,
  EVENT_PUNCH_HIT,
  EVENT_SHOT,
  EVENT_SHOT_EMPTY,
  EVENT_SHOT_HIT,
  EVENT_SMOKE,
  EVENT_STEAL,
  createWorld,
} from './world.js';
import {
  ACTION_CONFIRM,
  ACTION_ENTER,
  ACTION_FIRE,
  ACTION_MUTE,
  ACTION_PAUSE,
  ACTION_PUNCH,
  createInput,
} from './input.js';
import { createRenderer, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { applySave, captureSave, clearSave, readSave, writeSave } from './save.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;
const SCREEN_BUSTED = 'busted';
// A punch that lands freezes the world for this long — the frame still renders,
// the simulation just does not advance. (Game feel: hit-stop, never a slowdown.)
const HIT_STOP_SECONDS = 0.07;
// How fast the chase camera eases back behind the car, per second.
const CHASE_CAM_RATE = 1.4;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const titleScreen = document.getElementById('screen-title');
const pauseScreen = document.getElementById('screen-pause');
const bustedScreen = document.getElementById('screen-busted');
const continueButton = document.getElementById('btn-continue');
const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas, createRandom(seed ^ 0x9e3779b9));
const hud = createHud();
const audio = createAudio();

// Read-only handle for live play-testing (like the renderer's window.__app): the
// world state, so a test can read positions, wanted level and police without guessing.
window.__world = world;
window.__audio = audio;

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best haul then lasts this visit only.
  }
}

function showOnly(screen) {
  titleScreen.classList.toggle('hidden', screen !== SCREEN_TITLE);
  pauseScreen.classList.toggle('hidden', screen !== SCREEN_PAUSED);
  bustedScreen.classList.toggle('hidden', screen !== SCREEN_BUSTED);
}

function runShot(name) {
  const scene = stageShot(name, world);
  hud.update(world.state, 0, scene.view.yaw ?? Math.PI);
  let painted = 0;
  function paint() {
    renderer.draw(world.state, scene.screen, scene.view, 0.016, false);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  showOnly(scene.screen);
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let best = readBest();
  let accumulator = 0;
  let last = performance.now();
  let orbitAngle = 0.65;
  let firstFrame = true;
  let coined = false; // set when a drop is collected this frame; the renderer pops on it
  let enterPressed = false; // the E press for this frame's step
  let punchPressed = false; // the F press for this frame's step
  let firePressed = false; // the G press for this frame's step
  let hitStop = 0; // a punch that lands freezes the world for a beat (game feel)

  // Screen readers (and anyone watching the page's text) hear the screen changes and each drop.
  function announce(message) {
    status.textContent = message;
  }

  /** The Continue button, when a save exists: what it says, and whether it shows. */
  function refreshContinue() {
    const save = readSave();
    if (!save) {
      continueButton.classList.add('hidden');
      return;
    }
    const done = save.missionsDone.length;
    const job = done === 0 ? 'The First Drop' : done === 1 ? 'The Midnight Parcel' : done === 2 ? 'The Getaway' : 'all jobs done';
    continueButton.textContent = `Continue — $${save.cash.toLocaleString('en-US')} banked · next: ${job}`;
    continueButton.classList.remove('hidden');
  }

  /** A fresh run starts with no press queued: an E/F/G from the title screen must not fire on frame one. */
  function clearPresses() {
    enterPressed = false;
    punchPressed = false;
    firePressed = false;
  }

  function startGame() {
    world.reset();
    clearSave();
    accumulator = 0;
    clearPresses();
    hitStop = 0;
    screen = SCREEN_PLAY;
    showOnly(screen);
    audio.musicStop();
    hud.toast(`Debt ${STORY.debt.toLocaleString('en-US')} — collect the green drops.`, 4);
    announce(`Playing. Collect cash drops to pay the ${STORY.debt} debt.`);
  }

  function continueGame() {
    const save = readSave();
    world.reset();
    if (save) {
      applySave(world.state, save);
      best = Math.max(best, save.best);
    }
    accumulator = 0;
    clearPresses();
    hitStop = 0;
    screen = SCREEN_PLAY;
    showOnly(screen);
    audio.musicStop();
    hud.toast(`Welcome back — debt $${(STORY.debt - world.state.cash).toLocaleString('en-US')} left.`, 4);
    announce('Playing. Save loaded.');
  }

  function pauseGame() {
    if (screen !== SCREEN_PLAY) return;
    screen = SCREEN_PAUSED;
    showOnly(screen);
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    announce('Paused.');
  }

  function resumeGame() {
    screen = SCREEN_PLAY;
    showOnly(screen);
    announce('Playing.');
  }

  function bustGame() {
    screen = SCREEN_BUSTED;
    showOnly(screen);
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    announce('Busted. The Velmora police caught you. Press Space to try again.');
  }

  function handleActions() {
    const actions = input.takeActions();
    if (actions & ACTION_ENTER) enterPressed = true;
    if (actions & ACTION_PUNCH) punchPressed = true;
    if (actions & ACTION_FIRE) firePressed = true;
    if (actions & ACTION_MUTE) {
      const muted = audio.toggleMute();
      if (screen === SCREEN_PLAY) hud.toast(muted ? 'Sound off (M to turn back on).' : 'Sound on.', 2);
    }
    if (actions & ACTION_CONFIRM && screen === SCREEN_TITLE) startGame();
    // Busted: retry from the last autosave when there is one, from scratch otherwise.
    else if (actions & ACTION_CONFIRM && screen === SCREEN_BUSTED) {
      if (readSave()) continueGame();
      else startGame();
    }
    else if (actions & ACTION_PAUSE && screen === SCREEN_PLAY) pauseGame();
    else if (actions & (ACTION_PAUSE | ACTION_CONFIRM) && screen === SCREEN_PAUSED) resumeGame();
    if (input.takeLockLost() && screen === SCREEN_PLAY) pauseGame();
  }

  function step() {
    if (screen === SCREEN_TITLE) {
      orbitAngle += STEP * 0.045;
      world.step(STEP, 0, 0, Math.PI, false, true);
      return;
    }
    // A punch that landed freezes the world for a beat — the frame still renders,
    // the simulation just does not advance. (Game feel: hit-stop, never a slowdown.)
    if (hitStop > 0) {
      hitStop -= STEP;
      return;
    }
    const move = input.move();
    const opts = {};
    if (enterPressed) opts.enter = true;
    if (punchPressed) opts.punch = true;
    if (firePressed) opts.fire = true;
    enterPressed = false;
    punchPressed = false;
    firePressed = false;
    const events = world.step(STEP, move.x, move.z, input.yaw(), input.sprint(), false, opts);
    if (events & EVENT_COIN) {
      coined = true;
      audio.chime();
      hud.toast(`Drop collected +$250 — ${world.state.dropsCollected} so far.`);
      announce(`Drop collected. Cash ${world.state.cash}.`);
      if (world.state.cash > best) {
        best = world.state.cash;
        saveBest(best);
      }
    }
    if (events & EVENT_STEAL) {
      hud.toast('You stole the car! The law noticed. ★', 4);
      announce('Car stolen. Wanted level one star.');
    } else if (events & EVENT_ENTER_CAR) {
      hud.toast('You are in. W to drive, S to brake.', 3);
    } else if (events & EVENT_EXIT_CAR) {
      hud.toast('Out of the car.', 2);
    }
    if (events & EVENT_HIT_PED) {
      hud.toast('You hit a walker! Wanted ★', 4);
      announce('You hit a pedestrian. Wanted level up.');
    }
    if (events & EVENT_PUNCH_HIT) {
      hitStop = HIT_STOP_SECONDS;
      audio.thud();
      hud.toast('Punch landed!', 2);
    } else if (events & EVENT_PUNCH) {
      // A whiff: the arm still went out, nothing connected. No toast — it is every-day.
    }
    if (events & EVENT_SHOT_HIT) {
      audio.shot();
      hud.toast('Hit!', 2);
    } else if (events & EVENT_SHOT) {
      audio.shot();
    } else if (events & EVENT_SHOT_EMPTY) {
      audio.click();
      hud.toast('Out of ammo — the pistol is dry.', 3);
    }
    if (events & EVENT_PISTOL) {
      audio.chime();
      hud.toast('Pistol picked up — G to fire, 12 rounds.', 4);
      announce('Pistol picked up.');
    }
    if (events & EVENT_HEAT) {
      hud.toast('The law noticed your speeding! ★', 4);
      announce('Wanted level up: speeding on the job.');
    }
    if (events & EVENT_SMOKE) {
      hud.toast('Your car is falling apart — smoke!', 4);
      announce('The car is smoking. It will stall if it takes more hits.');
    }
    if (events & EVENT_MISSION_START) {
      const mission = world.state.missions.list[world.state.missions.index];
      if (mission) {
        hud.toast(`${mission.label}: ${mission.intro}`, 6);
        announce(`Mission: ${mission.label}.`);
      }
    }
    if (events & EVENT_MISSION_RETURN) {
      hud.toast('$1,500 collected — return to the plaza!', 5);
      announce('Mission: return to the plaza.');
    }
    if (events & EVENT_MISSION_PACKAGE) {
      hud.toast('Parcel secured — drive it across town, fast!', 5);
      announce('Parcel picked up. Deliver it before the timer ends.');
    }
    if (events & EVENT_MISSION_FAIL) {
      audio.fail();
      hud.toast('Too slow — the parcel missed its window. Try again.', 5);
      announce('Delivery failed. The job resets to the pickup.');
    }
    if (events & EVENT_MISSION_EVADE) {
      hud.toast('Three stars! Lose the heat, then reach the hideout.', 5);
      announce('Three stars. Lose the heat.');
    }
    if (events & EVENT_MISSION_HIDEOUT) {
      hud.toast("Heat's off — reach the hideout!", 5);
      announce('Heat lost. Reach the hideout.');
    }
    if (events & EVENT_MISSION_DONE) {
      const done = world.state.missions.list[world.state.missions.index - 1];
      const payout = done && done.payout ? ` +$${done.payout.toLocaleString('en-US')}` : '';
      audio.fanfare();
      hud.toast(`Mission complete: ${done ? done.label : 'done'}!${payout}`, 5);
      announce('Mission complete.');
      // Autosave on a safe boundary: the job is done, the state is consistent.
      if (world.state.cash > best) {
        best = world.state.cash;
        saveBest(best);
      }
      writeSave(captureSave(world.state, best));
      refreshContinue();
    }
    if (events & EVENT_BUSTED) bustGame();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions();
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      accumulator += dt;
      let guard = 0;
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY) && guard < 8) {
        step();
        accumulator -= STEP;
        guard += 1;
      }
      // Eight steps is the spiral-of-death guard: a long stall drops the backlog
      // instead of replaying it, so the game never runs minutes of catch-up at once.
      if (guard === 8) accumulator = 0;
    } else {
      accumulator = 0;
    }
    // Behind the wheel the camera eases back behind the car (chase cam, from the
    // camera-systems skill: exponential smoothing, so the feel is the same at any FPS).
    // The mouse still looks around; the easing only re-centres behind the car.
    if (screen === SCREEN_PLAY && world.state.inCar && world.state.currentCar) {
      const car = world.state.currentCar;
      const targetYaw = car.heading + Math.PI;
      let delta = targetYaw - input.yaw();
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      input.setYaw(input.yaw() + delta * (1 - Math.exp(-CHASE_CAM_RATE * dt)));
    }
    const view =
      screen === SCREEN_TITLE
        // Above the tallest tower (42 m), so the orbit never clips through one.
        ? { mode: 'orbit', angle: orbitAngle, radius: 88, height: 48 }
        : { mode: 'follow', yaw: input.yaw(), pitch: input.pitch() };
    renderer.draw(world.state, screen, view, dt, coined);
    coined = false;
    hud.update(world.state, dt, input.yaw());
    // Sound follows the state every frame: the engine hums with the car's speed,
    // the siren wails while the wanted level is above zero, the title plays its loop.
    if (screen === SCREEN_PLAY) {
      const car = world.state.currentCar;
      audio.engineSet(
        car ? Math.min(1, Math.abs(car.speed) / CAR.maxSpeed) : 0,
        world.state.inCar,
      );
      audio.sirenSet(world.state.wanted > 0);
    } else {
      audio.engineSet(0, false);
      audio.sirenSet(false);
      if (screen === SCREEN_TITLE) audio.musicStart();
    }
    if (firstFrame) {
      firstFrame = false;
      window.__ready = true;
    }
  }

  // Leaving the tab pauses a running game rather than letting the city run unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) pauseGame();
  });

  // The browser only lets sound start after a gesture: unlock on the first one,
  // and start the title loop from there.
  const unlockOnce = () => {
    audio.unlock();
    if (screen === SCREEN_TITLE) audio.musicStart();
  };
  window.addEventListener('pointerdown', unlockOnce);
  window.addEventListener('keydown', unlockOnce);

  continueButton.addEventListener('click', () => {
    audio.unlock();
    if (screen === SCREEN_TITLE) continueGame();
  });

  refreshContinue();
  showOnly(screen);
  announce('Velmora Street Debt. Press Space or click to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
