// Police and the wanted system: heat, pursuit, and getting busted. The game-ai skill's
// FSM again — each cop is PATROL / CHASE / BUSTED, each police car is CRUISE / PURSUE /
// RAM. Heat rises when the player commits a crime in front of the law and falls when
// nobody has seen him for a while; the HUD stars are just this module's number.
//
// Rules of the street:
//  - 1-2 stars: foot cops chase on foot. They are faster than a walk, slower than a
//    sprint, and they only grab a player on foot. They walk the streets like everyone
//    else — a wall in the way makes them sidestep around it, never through it.
//  - 3+ stars: police cars join in. They drive the road grid like traffic and turn at
//    intersections toward the player (the grid IS the pathfinding graph), switching to
//    a direct ram only when close. A ram costs health, and at 0 health the player is
//    busted. A car that stops making progress falls back to the grid instead of
//    grinding into a wall forever.
//  - Out of sight (no police within sight range) for POLICE.decayDelay seconds, one
//    star drops off. At 0 stars the police leave.

import { POLICE, TRAFFIC, WANTED } from './config.js';
import { collidesWithCity } from './city.js';
import { moveCarWithCollision } from './cars.js';

const TWO_PI = Math.PI * 2;

// How close a police car must be to ram the player's car, and to hit a player on foot.
const RAM_RANGE = 3.4;
const FOOT_HIT_RANGE = 2.2;
// The stuck check: how often it runs, and how little movement counts as stuck.
const STUCK_CHECK_SECONDS = 1.2;
const STUCK_MOVE = 0.6;

function angleDelta(from, to) {
  let d = (to - from) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return d;
}

/** A foot cop: position, heading, walk phase, and a sidestep detour when blocked. */
function makeFootCop(x, z, id) {
  return {
    x, z, heading: 0, speed: 0, walkPhase: 0, state: 'chase', id,
    detour: 0, side: 1, stuck: 0, lastX: x, lastZ: z,
    hp: 2, downTimer: 0, // two hits put a cop down; he is out for 8 seconds
  };
}

/** A police car: a pursuer that drives the road grid toward the player. */
function makePoliceCar(x, z, heading, axis, dir, street, id) {
  return {
    kind: 'police', x, z, heading, speed: 0, steer: 0,
    color: 0, id, state: 'pursue', ramCooldown: 0,
    axis, dir, street, turnCooldown: 0, stuckTimer: 0, lastX: x, lastZ: z,
  };
}

export function createPolice() {
  return { footCops: [], cars: [], unseenTimer: 0, lightPhase: 0, heli: null };
}

// How many random street points to try before falling back to a point behind the player.
const SPAWN_TRIES = 12;

/** A street point a set distance from the player, on a road, for spawning police. */
function spawnPointNear(city, player, distance, random) {
  const streets = city.streets;
  for (let tries = 0; tries < SPAWN_TRIES; tries += 1) {
    const street = streets[Math.floor(random() * streets.length)];
    const along = (random() * 2 - 1) * (city.bounds - 10);
    const horizontal = random() < 0.5;
    const x = horizontal ? along : street;
    const z = horizontal ? street : along;
    const dx = x - player.x;
    const dz = z - player.z;
    if (dx * dx + dz * dz > distance * distance * 0.5) return { x, z };
  }
  // Fallback: behind the player at the spawn distance, clamped inside the city so
  // a cop never spawns outside the playable bounds near an edge.
  const x = Math.max(-city.bounds + 8, Math.min(city.bounds - 8, player.x + distance));
  return { x, z: player.z };
}

/** The road line the player is nearest to, and how far off it they are. */
function nearestStreetLine(city, player) {
  let best = null;
  for (const s of city.streets) {
    const dx = Math.abs(player.x - s);
    if (!best || dx < best.off) best = { axis: 'z', street: s, off: dx };
    const dz = Math.abs(player.z - s);
    if (dz < best.off) best = { axis: 'x', street: s, off: dz };
  }
  return best;
}

/** Raise the wanted level by `stars` (a crime), capping at WANTED.max. */
export function addWanted(state, stars) {
  state.wanted = Math.min(WANTED.max, state.wanted + stars);
  state.police.unseenTimer = 0;
}

/**
 * Hurt the player by `amount`, through body armor first: the armor eats what it
 * can, the rest comes off health. Returns true when the hit killed him.
 * Every damage source in the game goes through here, so armor works everywhere.
 */
export function damagePlayer(state, amount) {
  const player = state.player;
  let left = amount;
  if (player.armor > 0) {
    const eaten = Math.min(player.armor, left);
    player.armor -= eaten;
    left -= eaten;
  }
  if (left > 0) player.health = Math.max(0, player.health - left);
  return player.health <= 0;
}

/** The helicopter: position, orbit angle, rotor spin, and its searchlight target. */
function makeHeli(x, z) {
  return { x, z, y: POLICE.heliHeight, angle: 0, rotor: 0 };
}

/**
 * One fixed step for the helicopter: it circles over the player at orbit radius,
 * closing in when far away, its rotor always spinning. It never touches the ground
 * and never rams — its job is to watch, and its watch keeps the heat on.
 */
function stepHeli(state, dt) {
  const heli = state.police.heli;
  if (!heli) return;
  const player = state.player;
  heli.angle += dt * 0.45;
  const tx = player.x + Math.cos(heli.angle) * POLICE.heliOrbit;
  const tz = player.z + Math.sin(heli.angle) * POLICE.heliOrbit;
  const dx = tx - heli.x;
  const dz = tz - heli.z;
  const dist = Math.hypot(dx, dz) || 1;
  const speed = Math.min(POLICE.heliSpeed, dist * 2);
  heli.x += (dx / dist) * speed * dt;
  heli.z += (dz / dist) * speed * dt;
  heli.y = POLICE.heliHeight + Math.sin(state.elapsed * 0.8) * 1.2;
  heli.rotor += dt * 22;
}

/** The nearest intersection crossing ahead on this car's road, or null. */
function nextCrossing(car, city) {
  let best = null;
  for (const s of city.streets) {
    const along = car.axis === 'x' ? car.x : car.z;
    const ahead = (s - along) * car.dir;
    if (ahead > 4 && (best === null || ahead < best)) best = ahead;
  }
  return best;
}

/**
 * At an intersection, pick the turn that gets closest to the player (Manhattan
 * distance from where the car would be 10 m down each option). Straight, left and
 * right are all on the table; the grid means one of them always closes the gap.
 */
function chooseBestTurn(car, city, tx, tz) {
  const cross = car.axis === 'x' ? car.z : car.x;
  const nearest = city.streets.reduce((a, b) => (Math.abs(b - cross) < Math.abs(a - cross) ? b : a));
  const options = [];
  // Straight on.
  options.push({ axis: car.axis, dir: car.dir, street: car.street, score: 0 });
  // The two turns.
  if (car.axis === 'x') {
    options.push({ axis: 'z', dir: car.dir > 0 ? -1 : 1, street: nearest, score: 0 });
    options.push({ axis: 'z', dir: car.dir > 0 ? 1 : -1, street: nearest, score: 0 });
  } else {
    options.push({ axis: 'x', dir: car.dir > 0 ? -1 : 1, street: nearest, score: 0 });
    options.push({ axis: 'x', dir: car.dir > 0 ? 1 : -1, street: nearest, score: 0 });
  }
  const along = car.axis === 'x' ? car.x : car.z;
  for (const opt of options) {
    let nx;
    let nz;
    if (opt.axis === 'x') {
      nx = along + opt.dir * 10;
      nz = opt.street + (opt.dir > 0 ? TRAFFIC.laneOffset : -TRAFFIC.laneOffset);
    } else {
      nx = opt.street + (opt.dir > 0 ? -TRAFFIC.laneOffset : TRAFFIC.laneOffset);
      nz = along + opt.dir * 10;
    }
    opt.score = Math.abs(nx - tx) + Math.abs(nz - tz);
  }
  options.sort((a, b) => a.score - b.score);
  const best = options[0];
  if (best.axis !== car.axis) {
    car.axis = best.axis;
    car.dir = best.dir;
    car.street = best.street;
    if (car.axis === 'x') {
      car.z = best.street + (best.dir > 0 ? TRAFFIC.laneOffset : -TRAFFIC.laneOffset);
      car.heading = best.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      car.x = best.street + (best.dir > 0 ? -TRAFFIC.laneOffset : TRAFFIC.laneOffset);
      car.heading = best.dir > 0 ? 0 : Math.PI;
    }
  }
  car.turnCooldown = 1.2;
}

/** Drive the car along its road, staying in its lane, toward its heading. */
function driveAlongRoad(car, city, dt, targetSpeed) {
  car.speed += (targetSpeed - car.speed) * Math.min(1, 1.2 * dt);
  const lanePos = car.axis === 'x' ? car.z : car.x;
  const want = car.street + (car.axis === 'x'
    ? (car.dir > 0 ? TRAFFIC.laneOffset : -TRAFFIC.laneOffset)
    : (car.dir > 0 ? -TRAFFIC.laneOffset : TRAFFIC.laneOffset));
  const off = want - lanePos;
  const targetHeading = car.axis === 'x'
    ? (car.dir > 0 ? Math.PI / 2 : -Math.PI / 2)
    : (car.dir > 0 ? 0 : Math.PI);
  const dh = angleDelta(car.heading, targetHeading);
  car.heading += (dh * 2 + Math.max(-0.3, Math.min(0.3, off * 0.12))) * Math.min(1, 3 * dt);
  const dx = Math.sin(car.heading) * car.speed * dt;
  const dz = Math.cos(car.heading) * car.speed * dt;
  moveCarWithCollision(car, dx, dz, city);
}

/**
 * One police car for one step: grid pursuit from afar, a direct ram up close, and a
 * stuck check that drops a grinding car back onto the grid instead of letting it sit
 * against a wall. Returns 1 when the player is busted by this car.
 */
function stepPoliceCar(car, state, dt, player, playerCar) {
  const city = state.city;
  const tx = playerCar ? playerCar.x : player.x;
  const tz = playerCar ? playerCar.z : player.z;
  const dx = tx - car.x;
  const dz = tz - car.z;
  const dist = Math.hypot(dx, dz) || 1;
  car.ramCooldown = Math.max(0, car.ramCooldown - dt);
  car.turnCooldown = Math.max(0, car.turnCooldown - dt);

  // Stuck check, once every STUCK_CHECK_SECONDS: barely moved (under STUCK_MOVE)
  // while trying, and the player is still far — back onto the grid instead of
  // grinding into a wall.
  car.stuckTimer += dt;
  if (car.stuckTimer >= STUCK_CHECK_SECONDS) {
    const moved = Math.hypot(car.x - car.lastX, car.z - car.lastZ);
    if (moved < STUCK_MOVE && dist > 6) {
      const line = nearestStreetLine(city, car);
      car.axis = line.axis;
      car.street = line.street;
      car.dir = line.axis === 'x' ? (tx > car.x ? 1 : -1) : (tz > car.z ? 1 : -1);
      car.heading = car.axis === 'x'
        ? (car.dir > 0 ? Math.PI / 2 : -Math.PI / 2)
        : (car.dir > 0 ? 0 : Math.PI);
      car.turnCooldown = 0;
    }
    car.lastX = car.x;
    car.lastZ = car.z;
    car.stuckTimer = 0;
  }

  if (dist < 12) {
    // Close in: steer straight at the player and ram.
    const wantHeading = Math.atan2(dx, dz);
    const dh = angleDelta(car.heading, wantHeading);
    const steerMax = 0.5 / (1 + Math.abs(car.speed) * 0.04);
    car.steer += (Math.max(-steerMax, Math.min(steerMax, dh * 0.8)) - car.steer) * Math.min(1, 5 * dt);
    car.speed += (POLICE.carSpeed - car.speed) * Math.min(1, 1.2 * dt);
    car.heading += (car.speed / 2.6) * Math.tan(car.steer) * dt;
    const mx = Math.sin(car.heading) * car.speed * dt;
    const mz = Math.cos(car.heading) * car.speed * dt;
    moveCarWithCollision(car, mx, mz, city);
  } else {
    // Grid pursuit: turn at intersections toward the player, drive the roads.
    const crossing = nextCrossing(car, city);
    if (crossing !== null && crossing < 4 && car.turnCooldown <= 0) {
      chooseBestTurn(car, city, tx, tz);
    }
    driveAlongRoad(car, city, dt, POLICE.carSpeed);
  }

  if (playerCar) {
    const cdx = playerCar.x - car.x;
    const cdz = playerCar.z - car.z;
    if (cdx * cdx + cdz * cdz < RAM_RANGE * RAM_RANGE && car.ramCooldown <= 0) {
      car.ramCooldown = POLICE.carRamCooldown;
      const killed = damagePlayer(state, POLICE.carRamDamage);
      playerCar.speed *= 0.55;
      car.speed *= 0.6;
      if (killed) return 1;
    }
  } else if (dist < FOOT_HIT_RANGE && Math.abs(car.speed) > 3) {
    // Knock the player away from the car so the next hit is not the same frame.
    player.x += (dx / dist) * 3;
    player.z += (dz / dist) * 3;
    car.speed *= 0.5;
    if (damagePlayer(state, POLICE.carHitDamage)) return 1;
  }
  return 0;
}

/**
 * One fixed step of the wanted system. `playerCar` is the car the player drives or
 * null. Returns a bit flag: 1 = busted this step (caught or health gone).
 */
export function stepPolice(state, dt, random) {
  const { city, player, police } = state;
  const playerCar = state.currentCar;
  police.lightPhase += dt;

  if (state.wanted <= 0) {
    police.footCops.length = 0;
    police.cars.length = 0;
    police.heli = null;
    police.unseenTimer = 0;
    return 0;
  }

  // Spawn to strength: foot cops at 1-2 stars, police cars from 3 up. Police cars
  // start on the player's own road when there is one, so the chase is on at once.
  const wantFoot = state.wanted >= 1 ? Math.min(POLICE.maxFootCops, state.wanted) : 0;
  const wantCars = state.wanted >= 3 ? Math.min(POLICE.maxCars, state.wanted - 2) : 0;
  while (police.footCops.length < wantFoot) {
    const p = spawnPointNear(city, player, POLICE.spawnDistance, random);
    police.footCops.push(makeFootCop(p.x, p.z, police.footCops.length));
  }
  while (police.cars.length < wantCars) {
    const line = nearestStreetLine(city, player);
    let car;
    if (line.off < 8) {
      // On the player's road, 35 m back along it, driving toward the player.
      // Clamped inside the city: near an edge, 35 m back would be outside it.
      const along = line.axis === 'x' ? player.x : player.z;
      const back = Math.max(-city.bounds + 8, Math.min(city.bounds - 8, along - 35));
      if (line.axis === 'x') {
        car = makePoliceCar(back, line.street + TRAFFIC.laneOffset, Math.PI / 2, 'x', 1, line.street, police.cars.length);
      } else {
        car = makePoliceCar(line.street - TRAFFIC.laneOffset, back, 0, 'z', 1, line.street, police.cars.length);
      }
    } else {
      const p = spawnPointNear(city, player, POLICE.spawnDistance, random);
      const axisLine = nearestStreetLine(city, p);
      car = makePoliceCar(p.x, p.z, 0, axisLine.axis, 1, axisLine.street, police.cars.length);
    }
    police.cars.push(car);
  }

  // The helicopter: up at 4+ stars, gone when the heat drops below four. It
  // arrives over the player, so the first thing Rook sees is the searchlight.
  if (state.wanted >= 4 && !police.heli) {
    police.heli = makeHeli(player.x + POLICE.heliOrbit, player.z);
  } else if (state.wanted < 4) {
    police.heli = null;
  }

  // Seen? Any police still up within sight range keeps the heat on; unseen, the timer runs.
  // A cop on the ground cannot report anything.
  let seen = false;
  // The helicopter watches from the sky: within sight range horizontally, its
  // searchlight is on Rook and the heat never decays — four stars is a manhunt.
  if (police.heli) {
    const hdx = police.heli.x - player.x;
    const hdz = police.heli.z - player.z;
    if (hdx * hdx + hdz * hdz < POLICE.sightRange * POLICE.sightRange) seen = true;
  }
  for (const cop of police.footCops) {
    if (cop.state === 'down') continue;
    const dx = cop.x - player.x;
    const dz = cop.z - player.z;
    if (dx * dx + dz * dz < POLICE.sightRange * POLICE.sightRange) { seen = true; break; }
  }
  if (!seen) {
    for (const car of police.cars) {
      const dx = car.x - player.x;
      const dz = car.z - player.z;
      if (dx * dx + dz * dz < POLICE.sightRange * POLICE.sightRange) { seen = true; break; }
    }
  }
  if (seen) police.unseenTimer = 0;
  else {
    police.unseenTimer += dt;
    if (police.unseenTimer >= POLICE.decayDelay) {
      state.wanted -= 1;
      police.unseenTimer = 0;
    }
  }

  // Foot cops: seek the player (steering, from the game-ai skill) and grab him.
  // They collide with buildings like the player does; a wall makes them sidestep.
  // A cop on the ground stays down until his timer runs out, then gets back up.
  for (const cop of police.footCops) {
    if (cop.state === 'down') {
      cop.downTimer -= dt;
      if (cop.downTimer <= 0) {
        cop.state = 'chase';
        cop.hp = 2;
      }
      continue;
    }
    let tx = player.x;
    let tz = player.z;
    if (cop.detour > 0) {
      cop.detour -= dt;
      const rx = -(player.z - cop.z) * cop.side;
      const rz = (player.x - cop.x) * cop.side;
      tx = cop.x + rx;
      tz = cop.z + rz;
    }
    const dx = tx - cop.x;
    const dz = tz - cop.z;
    const dist = Math.hypot(dx, dz) || 1;
    const wantHeading = Math.atan2(dx, dz);
    const dh = angleDelta(cop.heading, wantHeading);
    cop.heading += Math.max(-4 * dt, Math.min(4 * dt, dh));
    cop.speed += (POLICE.footSpeed - cop.speed) * Math.min(1, 3 * dt);
    const nx = cop.x + Math.sin(cop.heading) * cop.speed * dt;
    const nz = cop.z + Math.cos(cop.heading) * cop.speed * dt;
    if (!collidesWithCity(city, nx, nz, 0.55)) {
      cop.x = nx;
      cop.z = nz;
    } else {
      cop.stuck += dt;
      if (cop.stuck > 0.8) {
        cop.detour = 0.6;
        cop.side *= -1;
        cop.stuck = 0;
      }
    }
    cop.walkPhase += cop.speed * dt * 2.2;
    // A grab only works on a player on foot, at arm's reach.
    if (!playerCar && Math.hypot(player.x - cop.x, player.z - cop.z) < POLICE.catchRadius) return 1;
  }

  for (const car of police.cars) {
    if (stepPoliceCar(car, state, dt, player, playerCar)) return 1;
  }
  stepHeli(state, dt);
  return 0;
}
