// Traffic: AI cars that drive the avenue grid like the city means them to — down the
// right-hand lane of a road, straight through most intersections, turning at some.
// The game-ai skill's FSM, in miniature: DRIVE follows the lane, SLOW matches the car
// ahead, TURN picks a new road at a crossing. Cars that reach the city edge drive off
// and a fresh one rolls in from another edge, so the streets never empty out.

import { TRAFFIC } from './config.js';
import { moveCarWithCollision } from './cars.js';

const TWO_PI = Math.PI * 2;

/** How close another car must be, sideways, to count as "in my lane". */
const LANE_TOLERANCE = 2.4;

/** A traffic car: axis 'x' or 'z', the road it is on, its lane, and where it is going. */
export function createTraffic(city, random) {
  const cars = [];
  for (let i = 0; i < TRAFFIC.count; i += 1) {
    cars.push(spawnTrafficCar(city, random, i));
  }
  return cars;
}

function spawnTrafficCar(city, random, id) {
  const streets = city.streets;
  const bound = city.bounds - 8;
  const street = streets[Math.floor(random() * streets.length)];
  const horizontal = random() < 0.5;
  const dir = random() < 0.5 ? 1 : -1;
  const along = (random() * 2 - 1) * bound;
  // Right-hand traffic: eastbound sits south of the centreline, westbound north;
  // southbound sits west, northbound east. The same signs are used in chooseTurn,
  // so a car keeps its lane through a turn instead of jumping across the road.
  const lane = TRAFFIC.laneOffset;
  const car = {
    kind: 'traffic',
    x: horizontal ? along : street + (dir > 0 ? -lane : lane),
    z: horizontal ? street + (dir > 0 ? lane : -lane) : along,
    heading: horizontal ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI),
    speed: TRAFFIC.cruiseSpeed * (0.85 + random() * 0.3),
    steer: 0,
    color: 1 + Math.floor(random() * 7),
    id,
    axis: horizontal ? 'x' : 'z',
    dir,
    street,
    state: 'drive',
  };
  return car;
}

/**
 * A replacement for a car that drove off the edge: a fresh car from another edge,
 * kept clear of the player so it never pops into existence on top of him.
 */
function respawnTrafficCar(city, random, id, player) {
  for (let tries = 0; tries < 4; tries += 1) {
    const car = spawnTrafficCar(city, random, id);
    const dx = car.x - player.x;
    const dz = car.z - player.z;
    if (dx * dx + dz * dz > 20 * 20) return car;
  }
  return spawnTrafficCar(city, random, id);
}

/** The nearest intersection crossing ahead on this car's road, or null. */
function nextCrossing(car, city) {
  const streets = city.streets;
  let best = null;
  for (const s of streets) {
    const along = car.axis === 'x' ? car.x : car.z;
    const ahead = (s - along) * car.dir;
    if (ahead > 4 && (best === null || ahead < best)) best = ahead;
  }
  return best;
}

/** Pick the car's new road at an intersection: mostly straight, sometimes a turn. */
function chooseTurn(car, streets, random) {
  const roll = random();
  if (roll < 0.7) return; // straight on
  const cross = car.axis === 'x' ? car.z : car.x;
  const nearest = streets.reduce((a, b) => (Math.abs(b - cross) < Math.abs(a - cross) ? b : a));
  const turnLeft = roll < 0.85;
  if (car.axis === 'x') {
    // Was going east/west, now north/south. Left from east is north (-z).
    const newDir = car.dir > 0 ? (turnLeft ? -1 : 1) : (turnLeft ? 1 : -1);
    car.axis = 'z';
    car.dir = newDir;
    car.street = nearest;
    car.x = nearest + (newDir > 0 ? -TRAFFIC.laneOffset : TRAFFIC.laneOffset);
    car.heading = newDir > 0 ? 0 : Math.PI;
  } else {
    const newDir = car.dir > 0 ? (turnLeft ? -1 : 1) : (turnLeft ? 1 : -1);
    car.axis = 'x';
    car.dir = newDir;
    car.street = nearest;
    car.z = nearest + (newDir > 0 ? TRAFFIC.laneOffset : -TRAFFIC.laneOffset);
    car.heading = newDir > 0 ? Math.PI / 2 : -Math.PI / 2;
  }
}

/**
 * One fixed step for every traffic car. The car ahead in the same lane sets the
 * pace (SLOW); at a crossing it may turn (TURN); at the edge it is replaced by a
 * fresh car rolling in from another edge. `others` is every other car on the road,
 * so traffic also yields to the player's car. `player` is optional: when given, a
 * replacement car is kept clear of him; without it the plaza centre is the fallback.
 */
export function stepTraffic(cars, city, others, dt, random, player = { x: 0, z: 0 }) {
  for (let i = 0; i < cars.length; i += 1) {
    const car = cars[i];
    // SLOW: something ahead in my lane within the follow gap — match its pace.
    // `along` is signed: positive means the other car is ahead of me, in my direction.
    let targetSpeed = TRAFFIC.cruiseSpeed;
    for (const other of others) {
      if (other === car) continue;
      const lateral = car.axis === 'x' ? Math.abs(other.z - car.z) : Math.abs(other.x - car.x);
      if (lateral > LANE_TOLERANCE) continue;
      const along = car.axis === 'x' ? (other.x - car.x) * car.dir : (other.z - car.z) * car.dir;
      if (along > 0 && along < TRAFFIC.followGap) {
        targetSpeed = Math.min(targetSpeed, Math.max(0, other.speed - 1));
        break;
      }
    }
    car.speed += (targetSpeed - car.speed) * Math.min(1, 1.5 * dt);

    const crossingAhead = nextCrossing(car, city);
    if (crossingAhead !== null && crossingAhead < 3) chooseTurn(car, city.streets, random);

    // Steer back onto the lane line if a turn left the car slightly off it.
    const lanePos = car.axis === 'x' ? car.z : car.x;
    const want = car.street + (car.axis === 'x'
      ? (car.dir > 0 ? TRAFFIC.laneOffset : -TRAFFIC.laneOffset)
      : (car.dir > 0 ? -TRAFFIC.laneOffset : TRAFFIC.laneOffset));
    const off = want - lanePos;
    const targetHeading = car.axis === 'x'
      ? (car.dir > 0 ? Math.PI / 2 : -Math.PI / 2)
      : (car.dir > 0 ? 0 : Math.PI);
    let dh = targetHeading - car.heading;
    while (dh > Math.PI) dh -= TWO_PI;
    while (dh < -Math.PI) dh += TWO_PI;
    car.heading += (dh * 2 + Math.max(-0.3, Math.min(0.3, off * 0.12))) * Math.min(1, 3 * dt);

    const dx = Math.sin(car.heading) * car.speed * dt;
    const dz = Math.cos(car.heading) * car.speed * dt;
    moveCarWithCollision(car, dx, dz, city);

    // Past the edge: drive off and come back as a fresh car from another edge,
    // kept clear of the player so it never pops into existence on top of him.
    const bound = city.bounds + 6;
    if (Math.abs(car.x) > bound || Math.abs(car.z) > bound) {
      const fresh = respawnTrafficCar(city, random, car.id, player);
      cars[i] = fresh;
    }
  }
}
