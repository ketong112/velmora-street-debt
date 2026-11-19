// Missions: ten jobs that pay Rook's $50,000 debt down, one at a time, in the
// threejs-gameplay-systems skill's shape — a design brief per job, a core-loop
// contract (do the verb, under pressure, for a reward, with a cost for failing),
// and an objective the HUD can always point at. A mission is one job with a kind,
// a phase, and the places it needs; the world watches the player's cash, position
// and wanted level and flips the phase. The story arc: the Harbormaster's debt,
// paid down job by job — drops first, then a parcel, then a getaway, a smuggling
// run, a chop-shop steal, and one last haul under the heat. Debt arc: $50,000
// → $41,000 after the first three jobs, → $20,000 when the first six are done,
// → $0 when all ten are done: the courier run, the harbor race, the safehouse
// stand, and the final payment at the docks.
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

import { COMBAT, ENFORCER, MISSION, MISSION10, MISSION2, MISSION3, MISSION4, MISSION5, MISSION6, MISSION7, MISSION8, MISSION9, RED_ZONES, SAFEHOUSE, WANTED } from './config.js';
import { spawnEnforcerWave, spawnEnforcers } from './combat.js';
import { addWanted } from './police.js';

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
export const MISSION_PHASE_RACE = 'race';
export const MISSION_PHASE_DEFEND = 'defend';

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
      {
        id: 'the-long-haul',
        label: 'The Long Haul',
        kind: 'smuggle',
        detail: 'Pick up the contraband at the docks, run it across town before the timer ends',
        payout: MISSION4.payout,
        phase: MISSION_PHASE_PICKUP,
        started: false,
        pickup: null,
        dropoff: null,
        timer: 0,
        timeLeft: 0,
        intro: 'Contraband at the far docks, a buyer at the far end of town. Grab it fast — the docks are watched, so expect a star the moment you touch it.',
      },
      {
        id: 'the-chop-shop',
        label: 'The Chop Shop',
        kind: 'stealdeliver',
        detail: 'Steal the violet coupe, deliver it to the chop shop',
        payout: MISSION5.payout,
        phase: MISSION_PHASE_STEAL,
        started: false,
        targetCar: null,
        hideout: null,
        intro: 'A buyer wants the violet coupe whole. Steal it, drive it to the chop shop across town — dented is fine, missing is not.',
      },
      {
        id: 'the-last-haul',
        label: 'The Last Haul',
        kind: 'finale',
        detail: 'Collect 8 drops under two stars of heat, then return to the plaza',
        payout: MISSION6.payout,
        phase: MISSION_PHASE_COLLECT,
        started: false,
        dropsAtStart: 0,
        intro: 'The Harbormaster is done waiting. Eight drops, two stars of heat on you from the first step, and then back to the plaza — finish this.',
      },
      {
        id: 'the-courier-run',
        label: 'The Courier Run',
        kind: 'multidrop',
        detail: 'Pick up three parcels, deliver all three across town before the timer ends',
        payout: MISSION7.payout,
        phase: MISSION_PHASE_PICKUP,
        started: false,
        pickup: null,
        stops: null,
        stopIndex: 0,
        timer: 0,
        timeLeft: 0,
        intro: 'Three parcels, one clock, three doors across town. Pick them all up at once, then run the route — late means back to the pickup.',
      },
      {
        id: 'the-harbor-race',
        label: 'The Harbor Race',
        kind: 'race',
        detail: 'Hit four checkpoints in order, against the clock',
        payout: MISSION8.payout,
        phase: MISSION_PHASE_RACE,
        started: false,
        checkpoints: null,
        checkpointIndex: 0,
        timer: 0,
        timeLeft: 0,
        intro: 'A street race with no rules but the clock: four checkpoints, in order, faster than the timer. The Harbormaster is watching.',
      },
      {
        id: 'the-safehouse-stand',
        label: 'The Safehouse Stand',
        kind: 'defend',
        detail: 'Hold the safehouse against five waves of enforcers',
        payout: MISSION9.payout,
        phase: MISSION_PHASE_DEFEND,
        started: false,
        wavesCleared: 0,
        intro: "They found your place. Five waves of the Harbormaster's men are coming for the door — hold the safehouse, put them all down.",
      },
      {
        id: 'the-final-payment',
        label: 'The Final Payment',
        kind: 'payoff',
        detail: 'Collect 10 drops under three stars of heat, then pay the Harbormaster at the docks',
        payout: MISSION10.payout,
        phase: MISSION_PHASE_COLLECT,
        started: false,
        dropsAtStart: 0,
        docks: null,
        intro: 'The last one. Ten drops with three stars on you from the first step, then carry the payoff to the Harbormaster at the docks — and the debt is done.',
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
  } else if (mission.kind === 'smuggle') {
    // The contraband run: same cross-town shape as the parcel, a faster clock,
    // and the docks are watched — the pickup itself draws a star.
    const pickup = farthestSpawnPoint(state, state.player.x, state.player.z);
    const dropoff = farthestSpawnPointExcept(state, pickup.x, pickup.z, pickup);
    mission.pickup = { x: pickup.x, z: pickup.z };
    mission.dropoff = { x: dropoff.x, z: dropoff.z };
    const dist = Math.hypot(dropoff.x - pickup.x, dropoff.z - pickup.z);
    mission.timer = Math.round(dist * MISSION4.timePerMetre + MISSION4.timeBase);
    mission.timeLeft = mission.timer;
  } else if (mission.kind === 'stealdeliver') {
    // The violet coupe: the nearest parked car, repainted so it reads at a glance,
    // and the chop shop at the far end of town from Rook.
    const car = nearestParkedCarAny(state.cars, state.player.x, state.player.z) ?? state.cars[0];
    if (!car) return;
    car.color = 4; // violet — the buyer's coupe, not to be confused with the gold one
    mission.targetCar = car;
    const hideout = farthestSpawnPoint(state, state.player.x, state.player.z);
    mission.hideout = { x: hideout.x, z: hideout.z };
  } else if (mission.kind === 'finale') {
    // The last haul starts hot: two stars on Rook from the first step, and the
    // count starts from the drops he has already banked.
    mission.dropsAtStart = state.dropsCollected;
    state.wanted = Math.max(state.wanted, 2);
    state.police.unseenTimer = 0;
  } else if (mission.kind === 'multidrop') {
    // The courier run: one pickup, three drop-offs in a row, one clock for the
    // whole route — the timer is the full drive at a brisk pace plus a margin.
    const pickup = farthestSpawnPoint(state, state.player.x, state.player.z);
    mission.pickup = { x: pickup.x, z: pickup.z };
    const stops = [];
    let from = pickup;
    for (let i = 0; i < MISSION7.stops; i += 1) {
      const stop = farthestSpawnPointExcept(state, from.x, from.z, from);
      stops.push({ x: stop.x, z: stop.z });
      from = stop;
    }
    mission.stops = stops;
    mission.stopIndex = 0;
    let dist = Math.hypot(pickup.x - state.player.x, pickup.z - state.player.z);
    let prev = pickup;
    for (const stop of stops) {
      dist += Math.hypot(stop.x - prev.x, stop.z - prev.z);
      prev = stop;
    }
    mission.timer = Math.round(dist * MISSION7.timePerMetre + MISSION7.timeBase);
    mission.timeLeft = mission.timer;
  } else if (mission.kind === 'race') {
    // The harbor race: four checkpoints, each the far end of town from the last,
    // so the route zigzags across the city. The clock is the route at race pace.
    const checkpoints = [];
    let from = { x: state.player.x, z: state.player.z };
    for (let i = 0; i < MISSION8.checkpoints; i += 1) {
      const cp = farthestSpawnPointExcept(state, from.x, from.z, from);
      checkpoints.push({ x: cp.x, z: cp.z });
      from = cp;
    }
    mission.checkpoints = checkpoints;
    mission.checkpointIndex = 0;
    let dist = 0;
    let prev = { x: state.player.x, z: state.player.z };
    for (const cp of checkpoints) {
      dist += Math.hypot(cp.x - prev.x, cp.z - prev.z);
      prev = cp;
    }
    mission.timer = Math.round(dist * MISSION8.timePerMetre + MISSION8.timeBase);
    mission.timeLeft = mission.timer;
  } else if (mission.kind === 'defend') {
    // The safehouse stand: the waves come to Rook's door. The first wave spawns
    // on the first defend step, not here — initMission runs before the player is
    // anywhere near the door, and a wave spawning across town would be wasted.
    mission.wavesCleared = 0;
  } else if (mission.kind === 'payoff') {
    // The final payment starts hot: three stars on Rook from the first step, and
    // the count starts from the drops he has already banked. The docks are the
    // far end of town from where he stands.
    mission.dropsAtStart = state.dropsCollected;
    const docks = farthestSpawnPoint(state, state.player.x, state.player.z);
    mission.docks = { x: docks.x, z: docks.z };
    state.wanted = Math.max(state.wanted, 3);
    state.police.unseenTimer = 0;
  }
}

function near(x1, z1, x2, z2, radius) {
  const dx = x1 - x2;
  const dz = z1 - z2;
  return dx * dx + dz * dz < radius * radius;
}

/**
 * Advance the current mission from the world state. Returns the transition that
 * happened this step, or null: 'start' when a job opens, 'return' when a collect
 * target is hit, 'package' when a parcel or the contraband is picked up, 'fail'
 * when a delivery timer runs out, 'evade' when the gold coupe is stolen,
 * 'hideout' when the heat is lost, 'steal' when the violet coupe is stolen,
 * 'checkpoint' when a race checkpoint, a courier stop or a defend wave is
 * cleared, 'docks' when the payoff drops are in and the docks are the goal,
 * 'done' when a job completes.
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

  if (mission.kind === 'smuggle') {
    // The Long Haul: the parcel's shape, a faster clock, and the pickup itself
    // draws a star — the docks are watched. Late means back to the pickup.
    if (mission.phase === MISSION_PHASE_PICKUP) {
      if (near(state.player.x, state.player.z, mission.pickup.x, mission.pickup.z, MISSION2.pickupRadius)) {
        mission.phase = MISSION_PHASE_DELIVER;
        mission.timeLeft = mission.timer;
        state.combat.hasPackage = true;
        addWanted(state, 1);
        return 'package';
      }
      return null;
    }
    if (mission.phase === MISSION_PHASE_DELIVER) {
      mission.timeLeft -= dt;
      if (mission.timeLeft <= 0) {
        mission.phase = MISSION_PHASE_PICKUP;
        mission.timeLeft = mission.timer;
        state.combat.hasPackage = false;
        return 'fail';
      }
      if (near(state.player.x, state.player.z, mission.dropoff.x, mission.dropoff.z, MISSION2.deliverRadius)) {
        mission.phase = MISSION_PHASE_DONE;
        state.cash += MISSION4.payout;
        state.combat.hasPackage = false;
        missions.index += 1;
        return 'done';
      }
    }
    return null;
  }

  if (mission.kind === 'stealdeliver') {
    // The Chop Shop: steal the violet coupe, then drive it to the chop shop.
    // No evade phase — the job is the car, not the heat — but the theft itself
    // is still a crime, so the steal still puts a star on Rook.
    if (mission.phase === MISSION_PHASE_STEAL) {
      if (state.inCar && state.currentCar === mission.targetCar) {
        mission.phase = MISSION_PHASE_DELIVER;
        return 'steal';
      }
      return null;
    }
    if (mission.phase === MISSION_PHASE_DELIVER) {
      if (near(state.player.x, state.player.z, mission.hideout.x, mission.hideout.z, MISSION5.hideoutRadius)) {
        mission.phase = MISSION_PHASE_DONE;
        state.cash += MISSION5.payout;
        missions.index += 1;
        return 'done';
      }
    }
    return null;
  }

  if (mission.kind === 'finale') {
    // The Last Haul: collect MISSION6.drops drops under the two stars the job
    // opened with, then back to the plaza for the final payout.
    if (mission.phase === MISSION_PHASE_COLLECT) {
      if (state.dropsCollected - mission.dropsAtStart >= MISSION6.drops) {
        mission.phase = MISSION_PHASE_RETURN;
        return 'return';
      }
      return null;
    }
    if (mission.phase === MISSION_PHASE_RETURN) {
      if (near(state.player.x, state.player.z, state.city.plaza.x, state.city.plaza.z, MISSION.returnRadius)) {
        mission.phase = MISSION_PHASE_DONE;
        state.cash += MISSION6.payout;
        missions.index += 1;
        return 'done';
      }
    }
    return null;
  }

  if (mission.kind === 'multidrop') {
    // The Courier Run: one pickup, three doors, one clock. Late means back to
    // the pickup with the parcels — the clock restarts, the stops do not.
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
        mission.phase = MISSION_PHASE_PICKUP;
        mission.stopIndex = 0;
        mission.timeLeft = mission.timer;
        state.combat.hasPackage = false;
        return 'fail';
      }
      const stop = mission.stops[mission.stopIndex];
      if (stop && near(state.player.x, state.player.z, stop.x, stop.z, MISSION2.deliverRadius)) {
        mission.stopIndex += 1;
        if (mission.stopIndex >= mission.stops.length) {
          mission.phase = MISSION_PHASE_DONE;
          state.cash += MISSION7.payout;
          state.combat.hasPackage = false;
          missions.index += 1;
          return 'done';
        }
        return 'checkpoint';
      }
    }
    return null;
  }

  if (mission.kind === 'race') {
    // The Harbor Race: four checkpoints in order, one clock. Late means the
    // race restarts at the first checkpoint — the timer starts over at full.
    mission.timeLeft -= dt;
    if (mission.timeLeft <= 0) {
      mission.checkpointIndex = 0;
      mission.timeLeft = mission.timer;
      return 'fail';
    }
    const cp = mission.checkpoints[mission.checkpointIndex];
    if (cp && near(state.player.x, state.player.z, cp.x, cp.z, MISSION2.deliverRadius)) {
      mission.checkpointIndex += 1;
      if (mission.checkpointIndex >= mission.checkpoints.length) {
        mission.phase = MISSION_PHASE_DONE;
        state.cash += MISSION8.payout;
        missions.index += 1;
        return 'done';
      }
      return 'checkpoint';
    }
    return null;
  }

  if (mission.kind === 'defend') {
    // The Safehouse Stand: waves of enforcers come for the door. A wave is
    // cleared when every enforcer in it is down — the downed ones are cleared
    // out and the next wave spawns. The next wave only spawns while Rook is
    // near the safehouse: the job is the door, not the whole town.
    const enforcers = state.combat.enforcers;
    if (enforcers.length > 0 && enforcers.every((e) => e.state === 'down')) {
      enforcers.length = 0;
      mission.wavesCleared += 1;
      if (mission.wavesCleared >= MISSION9.waves) {
        mission.phase = MISSION_PHASE_DONE;
        state.cash += MISSION9.payout;
        missions.index += 1;
        return 'done';
      }
      return 'checkpoint';
    }
    if (enforcers.length === 0 && mission.wavesCleared < MISSION9.waves) {
      const dx = state.player.x - SAFEHOUSE.x;
      const dz = state.player.z - SAFEHOUSE.z;
      if (dx * dx + dz * dz < MISSION9.defendRadius * MISSION9.defendRadius) {
        spawnEnforcerWave(state.combat, state.city, state.player, MISSION9.enforcersPerWave, random);
      }
    }
    return null;
  }

  if (mission.kind === 'payoff') {
    // The Final Payment: collect MISSION10.drops drops under the three stars the
    // job opened with, then carry the payoff to the docks. No timer — the heat
    // is the pressure. Done at the docks, the debt is gone.
    if (mission.phase === MISSION_PHASE_COLLECT) {
      if (state.dropsCollected - mission.dropsAtStart >= MISSION10.drops) {
        mission.phase = MISSION_PHASE_DELIVER;
        return 'docks';
      }
      return null;
    }
    if (mission.phase === MISSION_PHASE_DELIVER) {
      if (mission.docks && near(state.player.x, state.player.z, mission.docks.x, mission.docks.z, MISSION2.deliverRadius)) {
        mission.phase = MISSION_PHASE_DONE;
        state.cash += MISSION10.payout;
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
  // A job that has not opened yet has no route: its pickup, checkpoints and
  // docks are still null. The step that finishes one job advances the index to
  // the next before initMission runs for it, so the objective for that step is
  // nothing — the beacon appears when the job opens on the next step.
  if (!mission.started) return null;
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
  if (mission.kind === 'smuggle') {
    if (mission.phase === MISSION_PHASE_PICKUP) {
      return { x: mission.pickup.x, z: mission.pickup.z, label: 'Pick up the contraband' };
    }
    if (mission.phase === MISSION_PHASE_DELIVER) {
      return {
        x: mission.dropoff.x,
        z: mission.dropoff.z,
        label: `Deliver the contraband — ${Math.max(0, Math.ceil(mission.timeLeft))}s left`,
      };
    }
    return null;
  }
  if (mission.kind === 'stealdeliver') {
    if (mission.phase === MISSION_PHASE_STEAL) {
      const car = mission.targetCar;
      if (!car) return null;
      return { x: car.x, z: car.z, label: 'Steal the violet coupe' };
    }
    if (mission.phase === MISSION_PHASE_DELIVER) {
      return { x: mission.hideout.x, z: mission.hideout.z, label: 'Deliver it to the chop shop' };
    }
    return null;
  }
  if (mission.kind === 'finale') {
    if (mission.phase === MISSION_PHASE_COLLECT) {
      // Like the first job, the marker is the nearest live drop; the label counts.
      const got = state.dropsCollected - mission.dropsAtStart;
      let nearest = null;
      let nearestD = Infinity;
      for (const pickup of state.pickups) {
        if (!pickup.active) continue;
        const dx = pickup.x - state.player.x;
        const dz = pickup.z - state.player.z;
        const d = dx * dx + dz * dz;
        if (d < nearestD) { nearestD = d; nearest = pickup; }
      }
      if (!nearest) return { x: state.player.x, z: state.player.z, label: `Collect ${MISSION6.drops} drops — ${got} so far` };
      return { x: nearest.x, z: nearest.z, label: `Collect ${MISSION6.drops} drops — ${got} so far` };
    }
    if (mission.phase === MISSION_PHASE_RETURN) {
      return {
        x: state.city.plaza.x,
        z: state.city.plaza.z,
        label: `Return to the plaza — ${MISSION6.drops} drops collected`,
      };
    }
    return null;
  }
  if (mission.kind === 'multidrop') {
    if (mission.phase === MISSION_PHASE_PICKUP) {
      return { x: mission.pickup.x, z: mission.pickup.z, label: 'Pick up the three parcels' };
    }
    if (mission.phase === MISSION_PHASE_DELIVER) {
      const stop = mission.stops[mission.stopIndex];
      if (!stop) return null;
      return {
        x: stop.x,
        z: stop.z,
        label: `Deliver parcel ${mission.stopIndex + 1}/${mission.stops.length} — ${Math.max(0, Math.ceil(mission.timeLeft))}s left`,
      };
    }
    return null;
  }
  if (mission.kind === 'race') {
    const cp = mission.checkpoints[mission.checkpointIndex];
    if (!cp) return null;
    return {
      x: cp.x,
      z: cp.z,
      label: `Race checkpoint ${mission.checkpointIndex + 1}/${mission.checkpoints.length} — ${Math.max(0, Math.ceil(mission.timeLeft))}s left`,
    };
  }
  if (mission.kind === 'defend') {
    // The marker sits on the nearest enforcer still standing — the threat — or
    // on the safehouse door while the next wave is on its way.
    let nearest = null;
    let nearestD = Infinity;
    for (const e of state.combat.enforcers) {
      if (e.state === 'down') continue;
      const dx = e.x - state.player.x;
      const dz = e.z - state.player.z;
      const d = dx * dx + dz * dz;
      if (d < nearestD) { nearestD = d; nearest = e; }
    }
    if (nearest) {
      return { x: nearest.x, z: nearest.z, label: `Defend the safehouse — wave ${mission.wavesCleared + 1}/${MISSION9.waves}` };
    }
    return {
      x: SAFEHOUSE.x,
      z: SAFEHOUSE.z,
      label: `Defend the safehouse — wave ${mission.wavesCleared + 1}/${MISSION9.waves}`,
    };
  }
  if (mission.kind === 'payoff') {
    if (mission.phase === MISSION_PHASE_COLLECT) {
      const got = state.dropsCollected - mission.dropsAtStart;
      let nearest = null;
      let nearestD = Infinity;
      for (const pickup of state.pickups) {
        if (!pickup.active) continue;
        const dx = pickup.x - state.player.x;
        const dz = pickup.z - state.player.z;
        const d = dx * dx + dz * dz;
        if (d < nearestD) { nearestD = d; nearest = pickup; }
      }
      if (!nearest) return { x: state.player.x, z: state.player.z, label: `Collect ${MISSION10.drops} drops for the payoff — ${got} so far` };
      return { x: nearest.x, z: nearest.z, label: `Collect ${MISSION10.drops} drops for the payoff — ${got} so far` };
    }
    if (mission.phase === MISSION_PHASE_DELIVER) {
      return {
        x: mission.docks.x,
        z: mission.docks.z,
        label: 'Carry the payoff to the docks — the debt ends here',
      };
    }
    return null;
  }
  return null;
}

/** The red zones, for the minimap: only drawn while a delivery is running. */
export function redZonesActive(missions) {
  const mission = currentMission(missions);
  if (!mission) return null;
  if (mission.kind === 'delivery' && mission.phase === MISSION_PHASE_DELIVER) return RED_ZONES;
  if (mission.kind === 'multidrop' && mission.phase === MISSION_PHASE_DELIVER) return RED_ZONES;
  return null;
}
