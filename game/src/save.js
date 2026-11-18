// Save: one versioned slot in localStorage, autosaved on mission complete. The
// save-systems skill's recipe, translated to the browser — serialize plain data
// (cash, which jobs are done, the pistol, the best haul), never engine objects;
// stamp a version on every save and validate on load, falling back to nothing
// rather than a half-written save; autosave only on safe boundaries (a mission
// completing), never mid-combat. localStorage writes are atomic per key, so a crash
// leaves either the old save or the new one.

import { SAVE_KEY, SAVE_VERSION } from './config.js';

/** Read the save, or null when there is none, it is newer than this build, or it fails validation. */
export function readSave() {
  let raw = null;
  try {
    raw = window.localStorage.getItem(SAVE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  if (data.version !== SAVE_VERSION) return null;
  if (typeof data.cash !== 'number' || !Number.isFinite(data.cash) || data.cash < 0) return null;
  if (!Array.isArray(data.missionsDone)) return null;
  return {
    version: SAVE_VERSION,
    cash: Math.floor(data.cash),
    missionsDone: data.missionsDone.filter((id) => typeof id === 'string'),
    // A hand-edited save could hold a negative best: clamp it, like the cash above.
    best: typeof data.best === 'number' && Number.isFinite(data.best) ? Math.max(0, Math.floor(data.best)) : 0,
    hasPistol: data.hasPistol === true,
    ammo: typeof data.ammo === 'number' && Number.isFinite(data.ammo) ? Math.max(0, Math.floor(data.ammo)) : 0,
  };
}

/** Snapshot the world state into plain save data. */
export function captureSave(state, best) {
  return {
    version: SAVE_VERSION,
    cash: Math.max(0, Math.floor(state.cash)),
    missionsDone: state.missions.list.filter((m) => m.phase === 'done').map((m) => m.id),
    // Best is a display number from the run: keep it an integer, never negative.
    best: Math.max(0, Math.floor(best)),
    hasPistol: state.combat.hasPistol,
    ammo: state.combat.ammo,
  };
}

/** Write the save. One key, one write — localStorage replaces the value atomically. */
export function writeSave(data) {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({ ...data, version: SAVE_VERSION }));
    return true;
  } catch {
    return false;
  }
}

/** Wipe the save (a new game starts clean). */
export function clearSave() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch {
    // Storage can be off: there is nothing to wipe then.
  }
}

/**
 * Rebuild a run from a save: the cash, the jobs already done (missions are
 * sequential, so the done ones are a prefix of the list), and the pistol.
 * Rook always wakes up at his starting corner — a save is progress, not a position.
 */
export function applySave(state, save) {
  state.cash = save.cash;
  let done = 0;
  // Missions are sequential, so the done ones are a prefix: the first id that is
  // not in the save ends the run, even if a later one is listed (a hand-edited save).
  for (const mission of state.missions.list) {
    if (!save.missionsDone.includes(mission.id)) break;
    mission.phase = 'done';
    mission.started = true;
    done += 1;
  }
  state.missions.index = Math.min(done, state.missions.list.length);
  state.combat.hasPistol = save.hasPistol;
  state.combat.ammo = save.ammo;
}
