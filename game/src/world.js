// The game's rules and state, with no drawing and no browser in it: Rook on foot or
// behind the wheel in Port Velmora, WASD movement relative to the camera, collision
// against the city, cash drops to collect, traffic and pedestrians, police and a wanted
// level, and the mission framework. step() advances one fixed step and returns what
// happened as bit flags, so the caller can react without the world knowing about
// screens or sound. Nothing here allocates after createWorld returns, except one
// scratch list of cars refilled each step.

import { CAR, CITY, MISSION2, PICKUP, PLAYER, RED_ZONES, STORY, WANTED } from './config.js';
import { collidesWithCity, createCity } from './city.js';
import { createParkedCars, nearestParkedCar, resolveCarCollision, stepCar } from './cars.js';
import { createTraffic, stepTraffic } from './traffic.js';
import { createPeds, stepPeds } from './peds.js';
import { addWanted, createPolice, stepPolice } from './police.js';
import { createMissions, currentMission, missionObjective, stepMission } from './missions.js';
import {
  collectPistol,
  createCombat,
  stepCombat,
  stepEnforcers,
  tryFire,
  tryPunch,
  trySwitchWeapon,
} from './combat.js';
import { buyItem, createShops, nearestShop } from './shops.js';

export const EVENT_COIN = 1;
export const EVENT_HIT = 2;
export const EVENT_ENTER_CAR = 4;
export const EVENT_EXIT_CAR = 8;
export const EVENT_STEAL = 16;
export const EVENT_HIT_PED = 32;
export const EVENT_BUSTED = 64;
export const EVENT_MISSION_RETURN = 128;
export const EVENT_MISSION_DONE = 256;
export const EVENT_PUNCH = 512;
export const EVENT_PUNCH_HIT = 1024;
export const EVENT_SHOT = 2048;
export const EVENT_SHOT_HIT = 4096;
export const EVENT_SHOT_EMPTY = 8192;
export const EVENT_PISTOL = 16384;
export const EVENT_HEAT = 32768;
export const EVENT_SMOKE = 65536;
export const EVENT_MISSION_START = 131072;
export const EVENT_MISSION_FAIL = 262144;
export const EVENT_MISSION_PACKAGE = 524288;
export const EVENT_MISSION_EVADE = 1048576;
export const EVENT_MISSION_HIDEOUT = 2097152;
export const EVENT_MISSION_STEAL = 4194304;
export const EVENT_SHOP = 8388608;
export const EVENT_WEAPON = 16777216;

const TWO_PI = Math.PI * 2;

// How many random spawn points to try before falling back to any point at all.
const FREE_SPAWN_TRIES = 12;
// A crash costs at least this much car health, however slow the impact was,
// and this much per m/s of speed carried into the wall.
const MIN_CRASH_DAMAGE = 6;
const CRASH_DAMAGE_PER_SPEED = 2;

/** Shortest signed turn from `from` to `to`, in radians. */
function angleDelta(from, to) {
  let d = (to - from) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return d;
}

export function createWorld(random) {
  const city = createCity(random);
  const player = {
    x: 0,
    z: 24,
    heading: 0,
    speed: 0,
    vx: 0,
    vz: 0,
    health: PLAYER.maxHealth,
    armor: 0, // body armor from the shop: damage eats this before health
    moving: false,
    walkPhase: 0,
  };
  const pickups = [];
  for (let index = 0; index < PICKUP.count; index += 1) {
    pickups.push({ active: false, x: 0, z: 0, respawn: 0, bob: random() * TWO_PI, taken: 0 });
  }
  const state = {
    city,
    player,
    pickups,
    cash: 0,
    wanted: 0,
    elapsed: 0,
    dropsCollected: 0,
    cars: createParkedCars(city, random),
    traffic: createTraffic(city, random),
    peds: createPeds(city, random),
    police: createPolice(),
    missions: createMissions(),
    combat: createCombat(),
    shops: createShops(),
    radioStation: 0, // the radio station, 0..RADIO.length-1; R cycles it (main.js)
    shopNotice: '', // the last shop result line, for the toast main.js shows
    weaponNotice: '', // the last weapon-switch line, for the toast main.js shows
    lastShotWeapon: 'pistol', // the gun the last shot came from, for the sound
    currentCar: null,
    inCar: false,
    busted: false,
    objective: null,
  };
  // Scratch list of every car, refilled each step for traffic avoidance and bumps.
  const allCars = [];

  function freeSpawn(exclude) {
    const points = city.spawnPoints;
    for (let tries = 0; tries < FREE_SPAWN_TRIES; tries += 1) {
      const p = points[Math.floor(random() * points.length)];
      let ok = true;
      for (const pk of pickups) {
        if (pk.active && Math.abs(pk.x - p.x) < 6 && Math.abs(pk.z - p.z) < 6) {
          ok = false;
          break;
        }
      }
      if (ok && (!exclude || Math.abs(p.x - exclude.x) > 4 || Math.abs(p.z - exclude.z) > 4)) return p;
    }
    return points[Math.floor(random() * points.length)];
  }

  function placePickup(pickup) {
    const p = freeSpawn(player);
    pickup.active = true;
    pickup.x = p.x;
    pickup.z = p.z;
    pickup.respawn = 0;
  }

  function reset() {
    player.x = 0;
    player.z = 24;
    player.heading = 0; // facing +Z, away from the starting camera (yaw PI sits north of him)
    player.speed = 0;
    player.vx = 0;
    player.vz = 0;
    player.health = PLAYER.maxHealth;
    player.armor = 0;
    player.moving = false;
    player.walkPhase = 0;
    state.cash = 0;
    state.wanted = 0;
    state.elapsed = 0;
    state.dropsCollected = 0;
    for (const pickup of pickups) placePickup(pickup);
    // The renderer binds its meshes to these car/pedestrian objects once, at boot —
    // so a reset re-randomises them IN PLACE instead of swapping the objects out,
    // or the meshes would keep following cars from the previous run.
    const freshCars = createParkedCars(city, random);
    for (let i = 0; i < state.cars.length; i += 1) Object.assign(state.cars[i], freshCars[i]);
    const freshTraffic = createTraffic(city, random);
    for (let i = 0; i < state.traffic.length; i += 1) Object.assign(state.traffic[i], freshTraffic[i]);
    const freshPeds = createPeds(city, random);
    for (let i = 0; i < state.peds.length; i += 1) Object.assign(state.peds[i], freshPeds[i]);
    state.police = createPolice();
    state.missions = createMissions();
    state.combat = createCombat();
    state.shopNotice = '';
    state.weaponNotice = '';
    state.lastShotWeapon = 'pistol';
    state.currentCar = null;
    state.inCar = false;
    state.busted = false;
    state.objective = missionObjective(state.missions, state);
  }

  /** Try to move the player by (dx, dz), axis by axis, so walls slide instead of sticking. */
  function tryMove(dx, dz) {
    const r = PLAYER.radius;
    const bound = city.bounds - 1;
    if (collidesWithCity(city, player.x, player.z, r)) {
      // Already inside something (a teleport or an edge case): walk out unchecked,
      // or a wall would hold the player forever.
      player.x = Math.max(-bound, Math.min(bound, player.x + dx));
      player.z = Math.max(-bound, Math.min(bound, player.z + dz));
      return;
    }
    const nx = Math.max(-bound, Math.min(bound, player.x + dx));
    if (!collidesWithCity(city, nx, player.z, r)) player.x = nx;
    const nz = Math.max(-bound, Math.min(bound, player.z + dz));
    if (!collidesWithCity(city, player.x, nz, r)) player.z = nz;
  }

  /** Step the player on foot: camera-relative WASD, exponential approach to speed. */
  function stepOnFoot(dt, moveX, moveZ, camYaw, sprint) {
    const len = Math.hypot(moveX, moveZ);
    const nx = len > 1 ? moveX / len : moveX;
    const nz = len > 1 ? moveZ / len : moveZ;
    const target = (sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed) * Math.min(1, len);
    // Camera-relative input to world space: forward is where the camera looks.
    // Camera at yaw sits at head + (sin yaw, cos yaw), so it looks along (-sin yaw, -cos yaw)
    // and its right is (cos yaw, -sin yaw).
    const sin = Math.sin(camYaw);
    const cos = Math.cos(camYaw);
    const wx = nx * cos - nz * sin;
    const wz = -nx * sin - nz * cos;
    const tx = wx * target;
    const tz = wz * target;

    // Exponential approach to the target velocity: quick to speed up, quick to stop.
    const rate = len > 0.05 ? PLAYER.acceleration / 4 : PLAYER.friction;
    const k = 1 - Math.exp(-rate * dt);
    player.vx += (tx - player.vx) * k;
    player.vz += (tz - player.vz) * k;
    tryMove(player.vx * dt, player.vz * dt);

    player.speed = Math.hypot(player.vx, player.vz);
    player.moving = player.speed > 0.6;
    if (player.moving) {
      const targetHeading = Math.atan2(player.vx, player.vz);
      player.heading += angleDelta(player.heading, targetHeading) * Math.min(1, PLAYER.turnRate * dt);
      player.walkPhase += player.speed * dt * 1.6;
    }
  }

  /** E to get in or out of a car. Stealing a parked car the player does not own is a crime. */
  function enterExitCar() {
    if (state.inCar) {
      const car = state.currentCar;
      // Step out on the driver's side, clear of the car itself.
      const sideX = Math.cos(car.heading);
      const sideZ = -Math.sin(car.heading);
      player.x = car.x + sideX * 2.2;
      player.z = car.z + sideZ * 2.2;
      player.heading = car.heading;
      player.speed = 0;
      player.vx = 0;
      player.vz = 0;
      state.currentCar = null;
      state.inCar = false;
      return EVENT_EXIT_CAR;
    }
    const car = nearestParkedCar(state.cars, player.x, player.z);
    if (!car) return 0;
    state.currentCar = car;
    state.inCar = true;
    player.x = car.x;
    player.z = car.z;
    player.heading = car.heading;
    let events = EVENT_ENTER_CAR;
    if (!car.stolen) {
      car.stolen = true;
      addWanted(state, WANTED.steal);
      events |= EVENT_STEAL;
    }
    return events;
  }

  /**
   * One fixed step. moveX is strafe (-1..1), moveZ is forward (-1..1), both relative to the
   * camera yaw `camYaw` on foot; behind the wheel moveX steers and moveZ is the throttle.
   * sprint doubles down on the walk speed. With `harmless` set (the title screen's
   * backdrop) the streets still live — traffic and walkers move — but nothing is
   * collected and no crime is committed. opts.enter is the E press for this step.
   */
  function step(dt, moveX, moveZ, camYaw, sprint, harmless, opts) {
    let events = 0;
    state.elapsed += dt;

    // The streets live even on the title screen; only the crimes and the job wait.
    // (stepPeds runs above even in harmless mode, so the walkers move on the title
    // backdrop — but with no player car there is nothing to hit, and the early
    // return below skips the crime counting anyway.)
    allCars.length = 0;
    for (const car of state.cars) allCars.push(car);
    for (const car of state.traffic) allCars.push(car);
    for (const car of state.police.cars) allCars.push(car);
    // Traffic gets the player as its 6th argument, so a replacement car is kept
    // clear of him instead of popping into existence on top of him.
    stepTraffic(state.traffic, city, allCars, dt, random, state.player);
    const hitPeds = stepPeds(state.peds, city, allCars, state.currentCar, dt, random);
    if (harmless) {
      // Title backdrop: the drops bob and the streets move, but nothing is collected
      // and no crime is committed — the world is scenery until the game starts.
      // (elapsed still advances above, so the day cycle keeps drifting behind the title.)
      for (const pickup of pickups) pickup.bob += dt * 2.2;
      return 0;
    }

    if (opts && opts.enter) events |= enterExitCar();

    // F to punch, G to fire — on foot only, and only when the step asked for it.
    if (opts && opts.punch) {
      const punch = tryPunch(state.combat, state);
      if (punch.hit) events |= EVENT_PUNCH_HIT;
      else if (punch.swung) events |= EVENT_PUNCH;
    }
    if (opts && opts.fire) {
      const shot = tryFire(state.combat, state, camYaw);
      if (shot.fired) events |= shot.hit ? EVENT_SHOT_HIT : EVENT_SHOT;
      else if (shot.empty) events |= EVENT_SHOT_EMPTY;
      // main.js reads the weapon off the shot to pick the sound: keep the last
      // one fired on the state, so the toast and the sound agree.
      state.lastShotWeapon = shot.fired || shot.empty ? shot.weapon : state.lastShotWeapon;
    }
    // Q to switch guns, 1-5 to buy at a shop — on foot only, and only when asked.
    if (opts && opts.weapon) {
      const switched = trySwitchWeapon(state.combat, state);
      if (switched) {
        state.weaponNotice = switched === 'shotgun'
          ? 'Shotgun out — spread shot, slow pump, shells from Iron & Ammo.'
          : 'Pistol out.';
        events |= EVENT_WEAPON;
      }
    }
    if (opts && opts.buy) {
      if (!state.inCar) {
        const shop = nearestShop(state.shops, player.x, player.z);
        if (shop) {
          const result = buyItem(state, shop, String(opts.buy));
          state.shopNotice = result.text;
          events |= EVENT_SHOP;
        }
      }
    }
    stepCombat(state.combat, dt);
    if (stepEnforcers(state.combat, state, dt)) {
      state.busted = true;
      events |= EVENT_BUSTED;
    }

    if (state.inCar) {
      // Behind the wheel: moveX steers, moveZ is the throttle (W gas, S brake/reverse).
      const hitBuilding = stepCar(state.currentCar, moveZ, moveX, dt, city);
      if (hitBuilding) {
        // A hard hit costs the car: damage scales with the speed it carried in,
        // and below CAR.smokeBelow the engine starts smoking.
        const car = state.currentCar;
        const damage = Math.max(MIN_CRASH_DAMAGE, Math.round(Math.abs(car.speed) * CRASH_DAMAGE_PER_SPEED));
        car.hp = Math.max(0, (car.hp ?? 100) - damage);
        if (car.hp < CAR.smokeBelow && !car.smoking) {
          car.smoking = true;
          events |= EVENT_SMOKE;
        }
        events |= EVENT_HIT;
      }
      player.x = state.currentCar.x;
      player.z = state.currentCar.z;
      player.heading = state.currentCar.heading;
      player.speed = Math.abs(state.currentCar.speed);
      player.moving = player.speed > 0.6;
      player.walkPhase = 0;
    } else {
      stepOnFoot(dt, moveX, moveZ, camYaw, sprint);
    }

    // Bumps between the player's car and everything else on the road.
    if (state.currentCar) {
      for (const other of allCars) {
        if (other === state.currentCar) continue;
        resolveCarCollision(state.currentCar, other);
      }
    }

    // A walker hit by the player's car at speed is a crime, and the law notices.
    // stepPeds returns the fresh knocks of this step, so each one counts once.
    for (const ped of hitPeds) {
      addWanted(state, WANTED.hitPed);
      events |= EVENT_HIT_PED;
    }

    for (const pickup of pickups) {
      pickup.bob += dt * 2.2;
      if (!pickup.active) {
        pickup.respawn -= dt;
        if (pickup.respawn <= 0) placePickup(pickup);
        continue;
      }
      const dx = pickup.x - player.x;
      const dz = pickup.z - player.z;
      if (dx * dx + dz * dz < PICKUP.collectRadius * PICKUP.collectRadius) {
        pickup.active = false;
        pickup.respawn = PICKUP.respawnDelay;
        pickup.taken = state.elapsed;
        state.cash += PICKUP.value;
        state.dropsCollected += 1;
        events |= EVENT_COIN;
      }
    }

    // The pistol the story left out: walk over it and it is yours.
    if (collectPistol(state.combat, state)) events |= EVENT_PISTOL;

    const missionEvent = stepMission(state.missions, state, dt, random);
    if (missionEvent === 'return') events |= EVENT_MISSION_RETURN;
    else if (missionEvent === 'done') events |= EVENT_MISSION_DONE;
    else if (missionEvent === 'start') events |= EVENT_MISSION_START;
    else if (missionEvent === 'fail') events |= EVENT_MISSION_FAIL;
    else if (missionEvent === 'package') events |= EVENT_MISSION_PACKAGE;
    else if (missionEvent === 'evade') events |= EVENT_MISSION_EVADE;
    else if (missionEvent === 'hideout') events |= EVENT_MISSION_HIDEOUT;
    else if (missionEvent === 'steal') events |= EVENT_MISSION_STEAL;
    state.objective = missionObjective(state.missions, state);

    // Speeding on a delivery draws the law — over the limit anywhere, twice as
    // fast inside a red zone. One star per MISSION2.heatSeconds of it.
    const mission = currentMission(state.missions);
    if (mission && mission.kind === 'delivery' && mission.phase === 'deliver' && state.inCar && state.currentCar) {
      const speed = Math.abs(state.currentCar.speed);
      const inRed = RED_ZONES.some((zone) => {
        const dx = player.x - zone.x;
        const dz = player.z - zone.z;
        return dx * dx + dz * dz < zone.r * zone.r;
      });
      const limit = inRed ? MISSION2.redZoneSpeedLimit : MISSION2.speedLimit;
      if (speed > limit) {
        mission.heatAccum += dt * (inRed ? 2 : 1);
        if (mission.heatAccum >= MISSION2.heatSeconds) {
          mission.heatAccum = 0;
          addWanted(state, 1);
          events |= EVENT_HEAT;
        }
      } else {
        mission.heatAccum = Math.max(0, mission.heatAccum - dt);
      }
    }

    if (stepPolice(state, dt, random)) {
      state.busted = true;
      events |= EVENT_BUSTED;
    }
    return events;
  }

  reset();
  return { state, city, reset, step };
}
