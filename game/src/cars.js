// Cars: parked cars to steal, and the arcade driving model for any car with a driver.
// One job: where cars are, how they move, and how the player gets in and out. The
// physics is the physics-tuning skill's fixed-step recipe in plain JS: integrate with
// the fixed dt, cap speed so a step never crosses a wall (no tunneling), and resolve
// collisions axis by axis so a car slides along a building instead of sticking to it.
// Heading 0 faces +Z; speed is signed forward speed in m/s.

import { CAR, TRAFFIC } from './config.js';
import { collidesWithCity } from './city.js';

const TWO_PI = Math.PI * 2;

function angleDelta(from, to) {
  let d = (to - from) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return d;
}

/** One parked car, undamaged and not yet stolen. */
function makeParkedCar(x, z, heading, color, id) {
  return {
    kind: 'parked', x, z, heading, speed: 0, steer: 0,
    color, stolen: false, id,
    hp: CAR.maxHp, smoking: false,
  };
}

/**
 * Parked cars along the roads, on the right-hand lane, clear of intersections and of
 * the plaza. One is placed on the road south of the plaza near Rook's start so the
 * first car is always in sight. `kind` is 'parked' until stolen; traffic and police
 * cars live in their own modules but share this shape.
 */
export function createParkedCars(city, random) {
  const cars = [];
  const streets = city.streets;
  const bound = city.bounds - 12;
  let placed = 0;
  let guard = 0;
  while (placed < CAR.parkedCount - 1 && guard < 200) {
    guard += 1;
    const street = streets[Math.floor(random() * streets.length)];
    const along = (random() * 2 - 1) * bound;
    const horizontal = random() < 0.5;
    const dir = random() < 0.5 ? 1 : -1;
    const lane = TRAFFIC.laneOffset;
    const x = horizontal ? along : street + (dir > 0 ? -lane : lane);
    const z = horizontal ? street + (dir > 0 ? lane : -lane) : along;
    // Keep intersections clear: no car within 12 m of a crossing.
    if (streets.some((s) => Math.abs(x - s) < 12 && Math.abs(z - s) < 12)) continue;
    if (Math.abs(x) < 14 && Math.abs(z) < 14) continue; // the plaza stays clear
    let clash = false;
    for (const c of cars) {
      if (Math.abs(c.x - x) < 8 && Math.abs(c.z - z) < 8) { clash = true; break; }
    }
    if (clash) continue;
    const heading = horizontal ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
    cars.push(makeParkedCar(x, z, heading, Math.floor(random() * CAR.colors.length), placed));
    placed += 1;
  }
  // The starter car: on the z=25 road, eastbound, a short walk from Rook's spawn.
  cars.push(makeParkedCar(9, 28.5, Math.PI / 2, 0, placed));
  return cars;
}

/** The nearest parked car within enter range of (x, z), or null. */
export function nearestParkedCar(cars, x, z) {
  let best = null;
  // Compare squared distances, so the enter radius is squared once, not per car.
  const bestD0 = CAR.enterRadius * CAR.enterRadius;
  let bestD = bestD0;
  for (const car of cars) {
    if (car.kind !== 'parked') continue;
    const dx = car.x - x;
    const dz = car.z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}

/**
 * One fixed step of arcade driving. throttle: +1 gas, -1 brake/reverse; steerInput:
 * -1..1. Steering scales down with speed (fast cars turn less), the heading turns
 * by the bicycle rule (speed / wheelbase) * tan(steer), and drag bleeds speed when
 * the foot is off the pedal. Returns true when the car hit a building this step.
 */
export function stepCar(car, throttle, steerInput, dt, city) {
  const steerMax = CAR.maxSteer / (1 + Math.abs(car.speed) * CAR.steerSpeedFalloff);
  const targetSteer = steerInput * steerMax;
  car.steer += (targetSteer - car.steer) * Math.min(1, CAR.grip * dt);

  // A car at 0 HP is stalled: the pedal does nothing, drag bleeds what speed is left.
  if (car.hp !== undefined && car.hp <= 0) {
    car.speed -= car.speed * CAR.drag * dt;
  } else if (throttle > 0) car.speed += CAR.accel * throttle * dt;
  else if (throttle < 0) {
    if (car.speed > 0.5) car.speed += CAR.brake * throttle * dt; // braking
    else car.speed += CAR.reverseAccel * throttle * dt; // reversing
  }
  car.speed -= car.speed * CAR.drag * dt;
  if (Math.abs(car.speed) < 0.05 && throttle === 0) car.speed = 0;
  car.speed = Math.max(-CAR.maxReverse, Math.min(CAR.maxSpeed, car.speed));

  car.heading += (car.speed / CAR.wheelbase) * Math.tan(car.steer) * dt;

  const dx = Math.sin(car.heading) * car.speed * dt;
  const dz = Math.cos(car.heading) * car.speed * dt;
  return moveCarWithCollision(car, dx, dz, city);
}

/** Move a car axis by axis against buildings; on a hit, kill most of the speed. */
export function moveCarWithCollision(car, dx, dz, city) {
  const r = CAR.radius;
  const bound = city.bounds - 1;
  let hit = false;
  const nx = Math.max(-bound, Math.min(bound, car.x + dx));
  if (!collidesWithCity(city, nx, car.z, r)) car.x = nx;
  else hit = true;
  const nz = Math.max(-bound, Math.min(bound, car.z + dz));
  if (!collidesWithCity(city, car.x, nz, r)) car.z = nz;
  else hit = true;
  if (hit) car.speed *= 0.35;
  return hit;
}

/** Circle-circle push between two cars; the faster one keeps more of its speed. */
export function resolveCarCollision(a, b) {
  // Parked cars have speed 0, so the push still separates them even when the
  // speed-averaging below does nothing — the positions are what matters there.
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  // Two car circles touch at 2 * radius; the 0.4 m slack keeps them from jittering.
  const min = CAR.radius * 2 - 0.4;
  const d2 = dx * dx + dz * dz;
  if (d2 >= min * min || d2 < 0.0001) return false;
  const d = Math.sqrt(d2);
  const push = (min - d) / 2;
  const ux = dx / d;
  const uz = dz / d;
  a.x -= ux * push;
  a.z -= uz * push;
  b.x += ux * push;
  b.z += uz * push;
  const avg = (a.speed + b.speed) / 2;
  a.speed = avg * 0.7;
  b.speed = avg * 0.7;
  return true;
}

export { angleDelta };
