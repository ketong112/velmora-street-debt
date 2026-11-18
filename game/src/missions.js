// Missions: three jobs that pay Rook's $50,000 debt down, one at a time, in the
// threejs-gameplay-systems skill's shape — a design brief per job, a core-loop
// contract (do the verb, under pressure, for a reward, with a cost for failing),
// and an objective the HUD can always point at. A mission is one job with a kind,
// a phase, and the places it needs; the world watches the player's cash, position
// and wanted level and flips the phase. The story arc: the Harbormaster's debt,
// paid down job by job — drops first, then a parcel, then a getaway.
//
// Mission 1, "The First Drop": collect MISSION.firstTarget of drops, then return
// to the plaza. While collecting, the objective is the nearest live drop; once the
// target is hit, the objective is the plaza fountain and the beacon moves there.
//
// Mission 2, "The Midnight Parcel": pick up a parcel at the far end of town, then
// drive it to the drop-off before the timer runs out. Speeding draws the law —
// over the limit anywhere, twice as fast inside a red zone — one star per
// MISSION2.heatSeconds of it. The timer running out sends the job back to the
// pickup; the parcel is not lost, just late.
//
// Mission 3, "The Getaway": steal the gold coupe the Harbormaster marked, lose
// the three stars that follow, then reach the hideout. The enforcers spawn when
// the heat does, and give up when it is gone.

import { COMBAT, ENFORCER, MISSION, MISSION2, MISSION3, RED_ZONES, WANTED } from './config.js';
import { spawnEnforcers } from './combat.js';

/**
 * The nearest parked car to (x, z) at any distance. cars.js's nearestParkedCar
 * only answers within enter range — the getaway's target is the nearest car in
 * town, not the nearest car Rook can already reach.
 */
function nearestParkedCarAny(cars, x, z) {
  let best = null;
  let bestD = Infinity;
  for (const car of cars) {
    if (car.kind !== 'parked') continue;
    const dx = car.x - x;
    const dz = car.z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}

export const MISSION_PHASE_COLLECT = 'collect';
export const MISSION_PHASE_RETURN = 'return';
export const MISSION_PHASE_DONE = 'done';
export const MISSION_PHASE_PICKUP = 'pickup';
export const MISSION_PHASE_DELIVER = 'deliver';
export const MISSION_PHASE_STEAL = 'steal';
export const MISSION_PHASE_EVADE = 'evade';
export const MISSION_PHASE_HIDEOUT = 'hideout';

/** The mission list. `started` flips once, when the job first becomes current. */
export function createMissions() {
  return {
    list: [
      {
        id: 'first-drop',
        label: 'The First Drop',
        kind: 'collect',
        detail: 'Collect drops, then return to the plaza',
        target: MISSION.firstTarget,
        phase: MISSION_PHASE_COLLECT,
        started: false,
        intro: 'Rook owes the Harbormaster fifty grand. The drops are out there — collect them.',
      },
      {
        id: 'midnight-parcel',
        label: 'The Midnight Parcel',
        kind: 'delivery',
        detail: 'Pick up the parcel, drive it across town before the timer ends',
        payout: MISSION2.payout,
        phase: MISSION_PHASE_PICKUP,
        started: false,
        heatAccum: 0,
        pickup: null,
        dropoff: null,
        timer: 0,
        timeLeft: 0,
        intro: 'The Harbormaster wants a parcel across town — fast. Pick it up, drive it there, no questions. And keep it under the limit: speeding draws the law.',
      },
      {
        id: 'the-getaway',
        label: 'The Getaway',
        kind: 'getaway',
        detail: 'Steal the gold coupe, lose the heat, reach the hideout',
        payout: MISSION3.payout,
        phase: MISSION_PHASE_STEAL,
        started: false,
        targetCar: null,
        hideout: null,
        // The intro's "three stars" is WANTED.evadeStars, set when the coupe is
        // stolen — if the number changes there, the words must change here too.
        intro: 'Time to get loud. Steal the gold coupe, lose the three stars that follow, reach the hideout.',
      },
    ],
    index: 0,
  };
}

/** The mission currently being worked, or null when the list is finished. */
export function currentMission(missions) {
  return missions.list[missions.index] ?? null;
}

/** The spawn point farthest from (x, z): the other end of town. */
function farthestSpawnPoint(state, x, z) {
  let best = null;
  let bestD = -1;
  for (const p of state.city.spawnPoints) {
    const dx = p.x - x;
    const dz = p.z - z;
    const d = dx * dx + dz * dz;
    if (d > bestD) {
      bestD = d;
      best = p;
    }
  }
  return best ?? { x: 100, z: 100 };
}

/**
 * The spawn point farthest from (x, z), other than `exclude`: the drop-off must
 * be a different corner from the pickup, or the delivery would be a zero drive.
 */
function farthestSpawnPointExcept(state, x, z, exclude) {
  let best = null;
  let bestD = -1;
  for (const p of state.city.spawnPoints) {
    if (p === exclude) continue;
    const dx = p.x - x;
    const dz = p.z - z;
    const d = dx * dx + dz * dz;
    if (d > bestD) {
      bestD = d;
      best = p;
    }
  }
  return best ?? farthestSpawnPoint(state, x, z);
}

/**
 * Set a mission up the first time it becomes current: pick its places, leave its
 * props out. The delivery's parcel sits at the far end of town from Rook and its
 * drop-off at the far end from the parcel, so the drive crosses the city; the
 * timer is the drive at a brisk pace plus a margin. The getaway's target is the
 * nearest parked car, repainted gold so it reads at a glance, and its hideout is
 * the far end of town from Rook.
 */
function initMission(mission, state) {
  if (mission.kind === 'delivery') {
    const pickup = farthestSpawnPoint(state, state.player.x, state.player.z);
    const dropoff = farthestSpawnPointExcept(state, pickup.x, pickup.z, pickup);
    mission.pickup = { x: pickup.x, z: pickup.z };
    mission.dropoff = { x: dropoff.x, z: dropoff.z };
    const dist = Math.hypot(dropoff.x - pickup.x, dropoff.z - pickup.z);
    mission.timer = Math.round(dist * MISSION2.timePerMetre + MISSION2.timeBase);
    mission.timeLeft = mission.timer;
    mission.heatAccum = 0;
    // The story leaves Rook a piece before the hard jobs start.
    if (!state.combat.hasPistol && !state.combat.pistol) {
      state.combat.pistol = { x: COMBAT.pistolAt.x, z: COMBAT.pistolAt.z, taken: false };
    }
  } else if (mission.kind === 'getaway') {
    // No parked car left (a save edge case): the job waits with no target rather
    // than crashing on an empty street — missionObjective already returns null.
    const car = nearestParkedCarAny(state.cars, state.player.x, state.player.z) ?? state.cars[0];
    if (!car) return;
    car.color = 2; // gold — the marked coupe, readable at a glance
    mission.targetCar = car;
    const hideout = farthestSpawnPoint(state, state.player.x, state.player.z);
    mission.hideout = { x: hideout.x, z: hideout.z };
  }
}

function near(x1, z1, x2, z2, radius) {
  const dx = x1 - x2;
  const dz = z1 - z2;
  return dx * dx + dz * dz < radius * radius;
}

/**
 * Advance the current mission from the world state. Returns the transition that
 * happened this step, or null: 'start' when a job opens, 'return' when the first
 * target is hit, 'package' when the parcel is picked up, 'fail' when the delivery
 * timer runs out, 'evade' when the gold coupe is stolen, 'hideout' when the heat
 * is lost, 'done' when a job completes.
 */
export function stepMission(missions, state, dt, random) {
  const mission = currentMission(missions);
  if (!mission) return null;
  if (!mission.started) {
    mission.started = true;
    initMission(mission, state);
    return 'start';
  }

  if (mission.kind === 'collect') {
    if (mission.phase === MISSION_PHASE_COLLECT && state.cash >= mission.target) {
      mission.phase = MISSION_PHASE_RETURN;
      return 'return';
    }
    if (mission.phase === MISSION_PHASE_RETURN) {
      if (near(state.player.x, state.player.z, state.city.plaza.x, state.city.plaza.z, MISSION.returnRadius)) {
        mission.phase = MISSION_PHASE_DONE;
        missions.index += 1;
        return 'done';
      }
    }
    return null;
  }

  if (mission.kind === 'delivery') {
    if (mission.phase === MISSION_PHASE_PICKUP) {
      if (near(state.player.x, state.player.z, mission.pickup.x, mission.pickup.z, MISSION2.pickupRadius)) {
        mission.phase = MISSION_PHASE_DELIVER;
        mission.timeLeft = mission.timer;
        state.combat.hasPackage = true;
        return 'package';
      }
      return null;
    }
    if (mission.phase === MISSION_PHASE_DELIVER) {
      mission.timeLeft -= dt;
      if (mission.timeLeft <= 0) {
        // Too slow: the parcel missed its window. The job resets to the pickup —
        // the parcel is not lost, just late, and the timer starts over at full.
        // (heatAccum is left as it is: the law's patience is not reset by being late.)
        mission.phase = MISSION_PHASE_PICKUP;
        mission.timeLeft = mission.timer;
        state.combat.hasPackage = false;
        return 'fail';
      }
      if (near(state.player.x, state.player.z, mission.dropoff.x, mission.dropoff.z, MISSION2.deliverRadius)) {
        mission.phase = MISSION_PHASE_DONE;
        state.cash += MISSION2.payout;
        state.combat.hasPackage = false;
        missions.index += 1;
        return 'done';
      }
    }
    return null;
  }

  if (mission.kind === 'getaway') {
    if (mission.phase === MISSION_PHASE_STEAL) {
      // The theft itself: behind the wheel of the marked coupe, the heat arrives.
      if (state.inCar && state.currentCar === mission.targetCar) {
        mission.phase = MISSION_PHASE_EVADE;
        state.wanted = WANTED.evadeStars;
        state.police.unseenTimer = 0;
        spawnEnforcers(state.combat, state.city, state.player, ENFORCER.count, random);
        return 'evade';
      }
      return null;
    }
    if (mission.phase === MISSION_PHASE_EVADE) {
      if (state.wanted <= 0) {
        mission.phase = MISSION_PHASE_HIDEOUT;
        state.combat.enforcers = [];
        return 'hideout';
      }
      return null;
    }
    if (mission.phase === MISSION_PHASE_HIDEOUT) {
      if (near(state.player.x, state.player.z, mission.hideout.x, mission.hideout.z, MISSION3.hideoutRadius)) {
        mission.phase = MISSION_PHASE_DONE;
        state.cash += MISSION3.payout;
        missions.index += 1;
        return 'done';
      }
    }
    return null;
  }
  return null;
}

/**
 * Where the objective marker belongs right now, and what the HUD should say:
 * the nearest live drop while collecting, the plaza fountain while returning,
 * the parcel then the drop-off while delivering (with the timer in the label),
 * the gold coupe while stealing, the hideout once the heat is lost. During the
 * evade the marker sits on the hideout — the destination once the heat is gone —
 * and the label says so. Nowhere when nothing is active.
 */
export function missionObjective(missions, state) {
  const mission = currentMission(missions);
  if (!mission) return null;
  if (mission.kind === 'collect') {
    if (mission.phase === MISSION_PHASE_COLLECT) {
      let nearest = null;
      let nearestD = Infinity;
      for (const pickup of state.pickups) {
        if (!pickup.active) continue;
        const dx = pickup.x - state.player.x;
        const dz = pickup.z - state.player.z;
        const d = dx * dx + dz * dz;
        if (d < nearestD) { nearestD = d; nearest = pickup; }
      }
      if (!nearest) return null;
      return { x: nearest.x, z: nearest.z, label: `Collect $${mission.target.toLocaleString('en-US')} — $${state.cash.toLocaleString('en-US')} so far` };
    }
    if (mission.phase === MISSION_PHASE_RETURN) {
      return {
        x: state.city.plaza.x,
        z: state.city.plaza.z,
        label: `Return to the plaza — $${mission.target.toLocaleString('en-US')} collected`,
      };
    }
    return null;
  }
  if (mission.kind === 'delivery') {
    if (mission.phase === MISSION_PHASE_PICKUP) {
      return { x: mission.pickup.x, z: mission.pickup.z, label: 'Pick up the parcel' };
    }
    if (mission.phase === MISSION_PHASE_DELIVER) {
      return {
        x: mission.dropoff.x,
        z: mission.dropoff.z,
        label: `Deliver the parcel — ${Math.max(0, Math.ceil(mission.timeLeft))}s left`,
      };
    }
    return null;
  }
  if (mission.kind === 'getaway') {
    if (mission.phase === MISSION_PHASE_STEAL) {
      const car = mission.targetCar;
      if (!car) return null;
      return { x: car.x, z: car.z, label: 'Steal the gold coupe' };
    }
    if (mission.phase === MISSION_PHASE_EVADE) {
      return {
        x: mission.hideout.x,
        z: mission.hideout.z,
        label: 'Lose the heat, then reach the hideout',
      };
    }
    if (mission.phase === MISSION_PHASE_HIDEOUT) {
      return { x: mission.hideout.x, z: mission.hideout.z, label: 'Reach the hideout' };
    }
    return null;
  }
  return null;
}

/** The red zones, for the minimap: only drawn while a delivery is running. */
export function redZonesActive(missions) {
  const mission = currentMission(missions);
  return mission && mission.kind === 'delivery' && mission.phase === MISSION_PHASE_DELIVER ? RED_ZONES : null;
}
