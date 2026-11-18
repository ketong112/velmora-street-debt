// Pedestrians: the people of Port Velmora, walking the sidewalks. Each one wanders
// between sidewalk points (seek steering, from the game-ai skill), and flees a fast car
// that comes too close. A walker hit by the player's car at speed goes down, the law
// notices, and after a while a new walker takes their place — the street never empties.

import { CITY, PED } from './config.js';
import { collidesWithCity } from './city.js';

const SHIRTS = [0xc96a5a, 0x5a7dc9, 0x7a9e5a, 0xd8c95a, 0x9e6ac9, 0xc9c9c9, 0x5ac9b8, 0x8a6a4a];

// The ring around the plaza fountain that walkers stroll, and the distance at which
// a player's car at speed knocks one down.
const PLAZA_RING = 13;
const HIT_RADIUS = 1.7;
// How long a knocked-down walker stays on the ground before a fresh one takes over.
const DOWN_SECONDS = 6;

/** A walker: position, heading, speed, what it is doing, and where it is going. */
export function createPeds(city, random) {
  const peds = [];
  for (let i = 0; i < PED.count; i += 1) {
    peds.push(spawnPed(city, random, i));
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
  };
}

/** Step one walker: wander, flee, or lie down after being hit. */
function stepPed(ped, city, cars, dt, random) {
  if (ped.state === 'down') {
    ped.downTimer -= dt;
    return;
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
    if (ped.fleeTimer <= 0) ped.state = 'walk';
    targetX = ped.goalX;
    targetZ = ped.goalZ;
  } else {
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
  }
  ped.walkPhase += ped.speed * dt * 2.2;
}

/**
 * One fixed step for every walker. Returns the walkers the player's car hit this
 * step (at speed), so the world can raise the wanted level for each.
 */
export function stepPeds(peds, city, cars, playerCar, dt, random) {
  const hit = [];
  for (const ped of peds) {
    if (ped.state === 'down') {
      ped.downTimer -= dt;
      if (ped.downTimer <= 0) {
        const fresh = spawnPed(city, random, ped.id);
        Object.assign(ped, fresh);
      }
      continue;
    }
    stepPed(ped, city, cars, dt, random);
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
