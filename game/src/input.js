// Keyboard and pointer input for a third-person game. Held keys give a move vector
// (forward/strafe) and a sprint flag; the mouse steers the camera through pointer lock,
// taken on click. One-shot presses (start, pause) are queued as bit flags and taken once
// by the loop, so a press between two frames is never lost and never counted twice.

import { CAMERA } from './config.js';

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_ENTER = 4;
export const ACTION_PUNCH = 8;
export const ACTION_FIRE = 16;
export const ACTION_MUTE = 32;
export const ACTION_RADIO = 64;
export const ACTION_WEAPON = 128;

const FORWARD = new Set(['KeyW', 'ArrowUp']);
const BACK = new Set(['KeyS', 'ArrowDown']);
const LEFT = new Set(['KeyA', 'ArrowLeft']);
const RIGHT = new Set(['KeyD', 'ArrowRight']);
const SPRINT = new Set(['ShiftLeft', 'ShiftRight']);
const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const ENTER = new Set(['KeyE']);
const PUNCH = new Set(['KeyF']);
const FIRE = new Set(['KeyG']);
const MUTE = new Set(['KeyM']);
const RADIO = new Set(['KeyR']);
const WEAPON = new Set(['KeyQ']);
const BUY = new Set(['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9']);

// The camera starts slightly above level, looking down the avenue a touch.
const START_PITCH = 0.22;

export function createInput(target) {
  const keys = new Set();
  let actions = 0;
  let buyDigit = 0; // the shop shelf number pressed since the last take, 0 when none
  let yaw = Math.PI; // north of Rook, looking south down the avenue he starts on
  let pitch = START_PITCH;
  let lockLost = false;

  window.addEventListener('keydown', (event) => {
    if (
      FORWARD.has(event.code) || BACK.has(event.code) || LEFT.has(event.code) ||
      RIGHT.has(event.code) || SPRINT.has(event.code)
    ) {
      keys.add(event.code);
      event.preventDefault();
    } else if (CONFIRM.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CONFIRM;
      event.preventDefault();
    } else if (ENTER.has(event.code)) {
      if (!event.repeat) actions |= ACTION_ENTER;
      event.preventDefault();
    } else if (PUNCH.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PUNCH;
      event.preventDefault();
    } else if (FIRE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_FIRE;
      event.preventDefault();
    } else if (MUTE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_MUTE;
      event.preventDefault();
    } else if (RADIO.has(event.code)) {
      if (!event.repeat) actions |= ACTION_RADIO;
      event.preventDefault();
    } else if (WEAPON.has(event.code)) {
      if (!event.repeat) actions |= ACTION_WEAPON;
      event.preventDefault();
    } else if (BUY.has(event.code)) {
      // Digits are the shop shelf (1-9) and the garage menu (1-3): 1-5 buys that
      // item when Rook stands at a shop, 6-9 buys the two new guns and their
      // rounds, and 1-3 buys a tune when the garage menu is open.
      // They are a separate one-shot queue (not an ACTION flag) so the loop knows
      // WHICH shelf was pressed, and a press away from a shop simply does nothing.
      if (!event.repeat) buyDigit = Number(event.code.slice(5));
      event.preventDefault();
    } else if (PAUSE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
      event.preventDefault();
    }
  });
  window.addEventListener('keyup', (event) => {
    keys.delete(event.code);
  });
  // A key released while the tab is hidden never sends keyup: let go of everything on
  // blur — held keys and any one-shot press queued while the tab was hidden, so a
  // press from before the tab switch never fires on the way back.
  window.addEventListener('blur', () => {
    keys.clear();
    actions = 0;
    buyDigit = 0;
  });

  // Pointer lock is requested on click; a click also counts as CONFIRM, which is
  // how clicking the title screen starts the game.
  target.addEventListener('pointerdown', () => {
    actions |= ACTION_CONFIRM;
    if (document.pointerLockElement !== target) {
      target.requestPointerLock?.();
    }
  });
  document.addEventListener('mousemove', (event) => {
    if (document.pointerLockElement !== target) return;
    yaw -= event.movementX * CAMERA.lookSpeed;
    pitch = Math.max(CAMERA.minPitch, Math.min(CAMERA.maxPitch, pitch + event.movementY * CAMERA.lookSpeed));
  });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== target) lockLost = true;
  });

  function anyOf(set) {
    for (const code of set) if (keys.has(code)) return true;
    return false;
  }

  return {
    /** Move vector relative to the camera: x strafe (-1..1), z forward (-1..1). */
    move() {
      const x = (anyOf(RIGHT) ? 1 : 0) - (anyOf(LEFT) ? 1 : 0);
      const z = (anyOf(FORWARD) ? 1 : 0) - (anyOf(BACK) ? 1 : 0);
      return { x, z };
    },
    sprint() {
      return anyOf(SPRINT);
    },
    yaw() {
      return yaw;
    },
    pitch() {
      return pitch;
    },
    setYaw(value) {
      yaw = value;
    },
    setPitch(value) {
      pitch = value;
    },
    /**
     * True once when pointer lock is lost. Esc exits lock (the browser reserves it),
     * so the game pauses on lock loss and P is the reliable pause key.
     */
    takeLockLost() {
      const lost = lockLost;
      lockLost = false;
      return lost;
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    /** The shop shelf number pressed since the last call, 0 when none. */
    takeBuy() {
      const taken = buyDigit;
      buyDigit = 0;
      return taken;
    },
  };
}
