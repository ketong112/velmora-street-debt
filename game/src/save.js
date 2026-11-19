// Save: one versioned slot in localStorage, autosaved on mission complete. The
// save-systems skill's recipe, translated to the browser — serialize plain data
// (cash, which jobs are done, the pistol, the best haul), never engine objects;
// stamp a version on every save and validate on load, falling back to nothing
// rather than a half-written save; autosave only on safe boundaries (a mission
// completing, stepping into the safehouse), never mid-combat. localStorage writes
// are atomic per key, so a crash leaves either the old save or the new one.
// Round 3 adds the ledger, the safehouse, the garage tuning and the two new
// guns — every one of them defaults when the save predates it, so a round-2
// save still loads clean.

import { SAVE_KEY, SAVE_VERSION } from './config.js';
import { captureGarage, readGarage, tunedMaxHp } from './garage.js';
import { captureLedger, readLedger } from './ledger.js';
import { captureSafehouse, readSafehouse } from './safehouse.js';

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
    // Round-2 fields: a save from round 1 has none of these, so each defaults
    // to "never bought" rather than failing validation.
    hasShotgun: data.hasShotgun === true,
    shells: typeof data.shells === 'number' && Number.isFinite(data.shells) ? Math.max(0, Math.floor(data.shells)) : 0,
    // The gun in hand: any of the four, or the pistol when the save says
    // something else (a round-2 save only ever says 'shotgun' or 'pistol').
    weapon: ['pistol', 'shotgun', 'smg', 'rifle'].includes(data.weapon) ? data.weapon : 'pistol',
    armor: typeof data.armor === 'number' && Number.isFinite(data.armor) ? Math.max(0, Math.floor(data.armor)) : 0,
    // Round-3 fields: a save from round 2 has none of these, so each defaults
    // to "never bought / never owned" rather than failing validation.
    hasSmg: data.hasSmg === true,
    smgAmmo: typeof data.smgAmmo === 'number' && Number.isFinite(data.smgAmmo) ? Math.max(0, Math.floor(data.smgAmmo)) : 0,
    hasRifle: data.hasRifle === true,
    rifleAmmo: typeof data.rifleAmmo === 'number' && Number.isFinite(data.rifleAmmo) ? Math.max(0, Math.floor(data.rifleAmmo)) : 0,
    ledger: readLedger(data.ledger),
    safehouse: readSafehouse(data.safehouse),
    garage: readGarage(data.garage),
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
    hasShotgun: state.combat.hasShotgun,
    shells: state.combat.shells,
    weapon: state.combat.weapon,
    armor: state.player.armor,
    hasSmg: state.combat.hasSmg,
    smgAmmo: state.combat.smgAmmo,
    hasRifle: state.combat.hasRifle,
    rifleAmmo: state.combat.rifleAmmo,
    ledger: captureLedger(state.ledger),
    safehouse: captureSafehouse(state.safehouse),
    garage: captureGarage(state.garage),
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
  state.combat.hasShotgun = save.hasShotgun;
  state.combat.shells = save.shells;
  // The saved gun only loads if it is owned: a shotgun in the save without the
  // gun itself (a hand edit) falls back to the pistol.
  const ownedGuns = [];
  if (save.hasPistol) ownedGuns.push('pistol');
  if (save.hasShotgun) ownedGuns.push('shotgun');
  if (save.hasSmg) ownedGuns.push('smg');
  if (save.hasRifle) ownedGuns.push('rifle');
  state.combat.weapon = ownedGuns.includes(save.weapon) ? save.weapon : 'pistol';
  state.combat.hasSmg = save.hasSmg;
  state.combat.smgAmmo = save.smgAmmo;
  state.combat.hasRifle = save.hasRifle;
  state.combat.rifleAmmo = save.rifleAmmo;
  state.player.armor = save.armor;
  // The ledger, the safehouse and the garage tuning come back whole — and the
  // tuning is painted back onto the cars, so a tuned car is still tuned.
  state.ledger = readLedger(save.ledger);
  state.safehouse = readSafehouse(save.safehouse);
  state.garage = readGarage(save.garage);
  for (const car of state.cars) {
    const tuning = state.garage.tuning[car.id];
    if (!tuning) continue;
    car.tuning = { engine: tuning.engine, armor: tuning.armor };
    car.color = tuning.paint;
    car.hp = tunedMaxHp(car);
  }
}
