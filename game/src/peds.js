// Pedestrians: the people of Port Velmora, walking the sidewalks. Each one wanders
// between sidewalk points (seek steering, from the game-ai skill), crosses the street
// at a corner now and then instead of walking the same block forever, and flees a
// fast car that comes too close. Some walk in pairs — a leader and a follower a step
// behind, like people out together — so the street reads as people, not dots. A walker
// hit by the player's car at speed goes down, the law notices, and after a while a
// new walker takes their place — the street never empties, and a replacement never
// pops into existence on top of the player's car.

import { CITY, PED } from './config.js';
import { collidesWithCity } from './city.js';

const SHIRTS = [0xc96a5a, 0x5a7dc9, 0x7a9e5a, 0xd8c95a, 0x9e6ac9, 0xc9c9c9, 0x5ac9b8, 0x8a6a4a];

// The ring around the plaza fountain that walkers stroll, and the distance at which
// a player's car at speed knocks one down.
const PLAZA_RING = 13;
const HIT_RADIUS = 1.7;
// How long a knocked-down walker stays on the ground before a fresh one takes over.
const DOWN_SECONDS = 6;
// How brisk a crossing is (a street is crossed, not strolled), and how long a
// walker strolls between crossings: the timer is per walker, so the streets
// see a crossing every few dozen seconds, not a crowd all at once.
const CROSS_SPEED_MULT = 1.6;
const CROSS_WAIT_MIN = 25;
const CROSS_WAIT_MAX = 60;
const CROSS_FIRST_MIN = 10;
const CROSS_FIRST_MAX = 40;
// How often a pair of neighbouring walkers walks together instead of alone.
const PAIR_CHANCE = 0.35;
// How far a replacement walker must spawn from the player's car, when it is in one.
const RESPAWN_CLEAR = 6;

/** A walker: position, heading, speed, what it is doing, and where it is going. */
export function createPeds(city, random) {
  const peds = [];
  for (let i = 0; i < PED.count; i += 1) {
    peds.push(spawnPed(city, random, i));
  }
  // Pairs: neighbouring walkers that stroll together — the second follows the
  // first a step behind and to the side, like people out together. The follower
  // starts beside its leader, not across town: a pair that spawns apart would
  // spend minutes catching up, and the street would show two lone walkers
  // instead of one pair. A solo walker keeps group 0 and followId -1.
  let group = 1;
  for (let i = 0; i + 1 < peds.length; i += 2) {
    if (random() >= PAIR_CHANCE) continue;
    const leader = peds[i];
    const follower = peds[i + 1];
    leader.group = group;
    follower.group = group;
    follower.followId = leader.id;
    follower.followDx = (random() < 0.5 ? -1 : 1) * (1.0 + random() * 0.5);
    follower.followDz = -(1.0 + random() * 1.0);
    // Start a step behind the leader, on the same sidewalk, heading the same
    // way, with the leader's goal as the fallback: the pair walks together
    // from the first step.
    follower.x = leader.x - Math.sin(leader.heading) * 1.4;
    follower.z = leader.z - Math.cos(leader.heading) * 1.4;
    follower.heading = leader.heading;
    follower.goalX = leader.goalX;
    follower.goalZ = leader.goalZ;
    group += 1;
  }
  return peds;
}

/** A sidewalk point: along a block edge, or on the ring around the plaza. */
function sidewalkPoint(city, random) {
  const { blockSize, blocks, pitch } = CITY;
  const half = (blocks - 1) / 2;
  if (random() < 0.25) {
    const a = random() * Math.PI * 2;
    return { x: Math.cos(a) * PLAZA_RING, z: Math.sin(a) * PLAZA_RING };
  }
  const bx = Math.floor(random() * blocks - half);
  const bz = Math.floor(random() * blocks - half);
  // The centre block is the plaza: a walker there strolls the ring, not the fountain.
  if (bx === 0 && bz === 0) return { x: PLAZA_RING, z: 0 };
  const edge = blockSize / 2 + 1.6;
  const along = (random() * 2 - 1) * (blockSize / 2 - 2);
  if (random() < 0.5) return { x: bx * pitch + (random() < 0.5 ? -edge : edge), z: bz * pitch + along };
  return { x: bx * pitch + along, z: bz * pitch + (random() < 0.5 ? -edge : edge) };
}

/**
 * A crossing goal: the sidewalk on the block across the street from the walker's
 * current block, on the edge facing this street — so the walk to it crosses the
 * road in a straight line instead of hugging the same block. Returns null when
 * there is no block across (the plaza, or the city's edge): then the walker
 * just picks another stroll.
 */
function crossingGoal(city, random, ped) {
  const { blockSize, blocks, pitch } = CITY;
  const half = (blocks - 1) / 2;
  const bx = Math.round(ped.x / pitch);
  const bz = Math.round(ped.z / pitch);
  if (Math.abs(bx) > half || Math.abs(bz) > half) return null;
  if (bx === 0 && bz === 0) return null; // the plaza: stroll the ring, don't cross it
  const edge = blockSize / 2 + 1.6;
  const span = blockSize / 2 - 2;
  if (random() < 0.5) {
    // Cross along x, to the block beside this one.
    let dir = random() < 0.5 ? 1 : -1;
    if (Math.abs(bx + dir) > half) dir = -dir;
    if (Math.abs(bx + dir) > half) return null;
    const tx = (bx + dir) * pitch;
    return {
      x: tx + (dir > 0 ? -edge : edge),
      z: bz * pitch + Math.max(-span, Math.min(span, ped.z - bz * pitch)),
    };
  }
  // Cross along z, to the block above or below this one.
  let dir = random() < 0.5 ? 1 : -1;
  if (Math.abs(bz + dir) > half) dir = -dir;
  if (Math.abs(bz + dir) > half) return null;
  const tz = (bz + dir) * pitch;
  return {
    x: bx * pitch + Math.max(-span, Math.min(span, ped.x - bx * pitch)),
    z: tz + (dir > 0 ? -edge : edge),
  };
}

function spawnPed(city, random, id) {
  const p = sidewalkPoint(city, random);
  const goal = sidewalkPoint(city, random);
  return {
    x: p.x, z: p.z, heading: random() * Math.PI * 2, speed: 0,
    walkPhase: random() * 6,
    state: 'walk', goalX: goal.x, goalZ: goal.z,
    fleeTimer: 0, downTimer: 0,
    shirt: SHIRTS[Math.floor(random() * SHIRTS.length)],
    id,
    // Pairs and crossings: group 0 walks alone; followId -1 leads or strolls;
    // crossing is true while a street crossing is the goal, so a fright that
    // interrupts it still resumes the crossing instead of abandoning it;
    // crossTimer counts down to the walker's next crossing (leaders and solo
    // walkers only — a follower crosses when its leader does, by trailing it).
    group: 0, followId: -1, followDx: 0, followDz: 0,
    crossing: false,
    crossTimer: CROSS_FIRST_MIN + random() * (CROSS_FIRST_MAX - CROSS_FIRST_MIN),
  };
}

/** The walker a follower trails, by slot id — or null when there is none. */
function leaderOf(ped, peds) {
  if (ped.followId < 0) return null;
  for (const other of peds) {
    if (other.id === ped.followId) return other;
  }
  return null;
}

/** Step one walker: wander, cross, follow, flee, or lie down after being hit. */
function stepPed(ped, city, cars, peds, dt, random) {
  if (ped.state === 'down') {
    ped.downTimer -= dt;
    return;
  }
  // CROSSING TIMER: a leader or solo walker strolls for a while, then crosses
  // the street to the opposite sidewalk. The timer — not the arrival, which a
  // walker here almost never reaches in a straight line, the buildings see to
  // that — is what schedules it, so each walker crosses every few dozen
  // seconds. A follower never starts one on its own: it crosses when its
  // leader does, by trailing it across.
  if (ped.state === 'walk' && ped.followId < 0) {
    ped.crossTimer -= dt;
    if (ped.crossTimer <= 0) {
      const cross = crossingGoal(city, random, ped);
      if (cross) {
        ped.goalX = cross.x;
        ped.goalZ = cross.z;
        ped.crossing = true;
        ped.state = 'cross';
      }
      ped.crossTimer = CROSS_WAIT_MIN + random() * (CROSS_WAIT_MAX - CROSS_WAIT_MIN);
    }
  }
  // FLEE: a fast car close by — run away from it, faster than a walk. The push is
  // weighted by closeness, so a car right on top of a walker scares it most.
  let fleeX = 0;
  let fleeZ = 0;
  for (const car of cars) {
    const speed = Math.abs(car.speed || 0);
    if (speed < PED.hitSpeed) continue;
    const dx = ped.x - car.x;
    const dz = ped.z - car.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < PED.fleeRadius * PED.fleeRadius) {
      const d = Math.sqrt(d2) || 1;
      fleeX += (dx / d) * (1 - d / PED.fleeRadius);
      fleeZ += (dz / d) * (1 - d / PED.fleeRadius);
    }
  }
  let targetX;
  let targetZ;
  let targetSpeed = PED.walkSpeed;
  if (fleeX !== 0 || fleeZ !== 0) {
    ped.state = 'flee';
    ped.fleeTimer = 1.5;
    targetX = ped.x + fleeX;
    targetZ = ped.z + fleeZ;
    targetSpeed = PED.fleeSpeed;
  } else if (ped.state === 'flee') {
    ped.fleeTimer -= dt;
    if (ped.fleeTimer <= 0) {
      // The fright is over: back to what it was doing — a crossing resumes
      // across the street, anything else goes back to its stroll.
      ped.state = ped.crossing ? 'cross' : 'walk';
    }
    targetX = ped.goalX;
    targetZ = ped.goalZ;
  } else if (ped.state === 'cross') {
    // CROSS: straight across the street to the opposite sidewalk, brisker than
    // a stroll — a street is crossed, not wandered. Arriving ends the crossing.
    const dx = ped.goalX - ped.x;
    const dz = ped.goalZ - ped.z;
    if (dx * dx + dz * dz < 1.5 * 1.5) {
      ped.crossing = false;
      ped.state = 'walk';
      const g = sidewalkPoint(city, random);
      ped.goalX = g.x;
      ped.goalZ = g.z;
    }
    targetX = ped.goalX;
    targetZ = ped.goalZ;
    targetSpeed = PED.walkSpeed * CROSS_SPEED_MULT;
  } else {
    // FOLLOW: a paired walker trails its leader a step behind and to the side,
    // matching the leader's pace. A leader on the ground walks alone — the
    // follower falls back to its own stroll until the leader is up again.
    const leader = leaderOf(ped, peds);
    if (leader && leader.state !== 'down') {
      const h = leader.heading;
      const fx = Math.sin(h);
      const fz = Math.cos(h);
      const rx = Math.cos(h);
      const rz = -Math.sin(h);
      targetX = leader.x + rx * ped.followDx + fx * ped.followDz;
      targetZ = leader.z + rz * ped.followDx + fz * ped.followDz;
      targetSpeed = leader.speed;
    } else {
      // WALK: amble toward the goal; arriving picks the next stroll. Crossings
      // are on the timer above, not on arrival: a walker here almost never
      // reaches a goal in a straight line, the buildings see to that.
      const dx = ped.goalX - ped.x;
      const dz = ped.goalZ - ped.z;
      if (dx * dx + dz * dz < 1.5 * 1.5) {
        const g = sidewalkPoint(city, random);
        ped.goalX = g.x;
        ped.goalZ = g.z;
      }
      targetX = ped.goalX;
      targetZ = ped.goalZ;
    }
  }
  // Seek steering: turn toward the target, then walk. A walker that cannot move
  // (a bad sidewalk point inside a building) just picks a new goal instead of
  // grinding forever — the collision check below is the only stuck signal needed.
  const dx = targetX - ped.x;
  const dz = targetZ - ped.z;
  const dist = Math.hypot(dx, dz) || 1;
  const wantHeading = Math.atan2(dx, dz);
  let dh = wantHeading - ped.heading;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  ped.heading += Math.max(-3.2 * dt, Math.min(3.2 * dt, dh));
  ped.speed += (targetSpeed - ped.speed) * Math.min(1, 4 * dt);
  const nx = ped.x + Math.sin(ped.heading) * ped.speed * dt;
  const nz = ped.z + Math.cos(ped.heading) * ped.speed * dt;
  if (!collidesWithCity(city, nx, nz, 0.5)) {
    ped.x = nx;
    ped.z = nz;
  } else {
    const g = sidewalkPoint(city, random);
    ped.goalX = g.x;
    ped.goalZ = g.z;
    ped.crossing = false;
    if (ped.state === 'cross') ped.state = 'walk';
  }
  ped.walkPhase += ped.speed * dt * 2.2;
}

/**
 * One fixed step for every walker. Returns the walkers the player's car hit this
 * step (at speed), so the world can raise the wanted level for each. Only the
 * player's car can knock a walker down — traffic cars scare walkers off but never
 * hit them, so every knock in this list is the player's doing, and the world
 * counts each one once. A replacement walker is kept clear of the player's car,
 * so it never pops into existence on top of it.
 */
export function stepPeds(peds, city, cars, playerCar, dt, random) {
  const hit = [];
  for (const ped of peds) {
    if (ped.state === 'down') {
      ped.downTimer -= dt;
      if (ped.downTimer <= 0) {
        let fresh = spawnPed(city, random, ped.id);
        if (playerCar) {
          for (let tries = 0; tries < 4; tries += 1) {
            const dx = fresh.x - playerCar.x;
            const dz = fresh.z - playerCar.z;
            if (dx * dx + dz * dz > RESPAWN_CLEAR * RESPAWN_CLEAR) break;
            fresh = spawnPed(city, random, ped.id);
          }
        }
        // A fresh walker starts alone and on foot: the pair and the crossing
        // belong to the walker that went down, not to its replacement.
        fresh.group = 0;
        fresh.followId = -1;
        fresh.followDx = 0;
        fresh.followDz = 0;
        fresh.crossing = false;
        Object.assign(ped, fresh);
      }
      continue;
    }
    stepPed(ped, city, cars, peds, dt, random);
    if (playerCar && Math.abs(playerCar.speed) > PED.hitSpeed) {
      const dx = ped.x - playerCar.x;
      const dz = ped.z - playerCar.z;
      if (dx * dx + dz * dz < HIT_RADIUS * HIT_RADIUS) {
        ped.state = 'down';
        ped.downTimer = DOWN_SECONDS;
        hit.push(ped);
      }
    }
  }
  return hit;
}
