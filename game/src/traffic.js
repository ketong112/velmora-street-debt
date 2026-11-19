// Traffic: AI cars that drive the avenue grid like the city means them to — down the
// right-hand lane of a road, straight through most intersections, turning at some.
// The game-ai skill's FSM, in miniature: DRIVE follows the lane, SLOW matches the car
// ahead, YIELD waits at a crossing another car is already in, TURN picks a new road
// at an intersection. Cars that reach the city edge drive off and a fresh one rolls
// in from another edge, so the streets never empty out.
//
// The cars are not all the same driver. Each one rolls its own pace at spawn — a
// slow truck, a steady cruiser, a quick car in a hurry — and keeps that pace for
// its whole life, so the grid reads as traffic instead of a parade: a slow car
// ahead is something to overtake, a quick one closing behind is something to let
// past. A car holds its own cruise speed (its own, not the grid's average), yields
// at a crossing another car is already crossing, and never turns into the car
// ahead of it. The same cars are the moving obstacles in mission 8's harbor race:
// no special race traffic, just this grid at full strength — a race route that
// zigzags across town always crosses slow trucks, quick cars and held-up
// intersections, and the respawn rule keeps the streets full for the whole race.

import { TRAFFIC } from './config.js';
import { moveCarWithCollision } from './cars.js';

const TWO_PI = Math.PI * 2;

/** How close another car must be, sideways, to count as "in my lane". */
const LANE_TOLERANCE = 2.4;

/** How far ahead a car looks for a crossing to yield at, in metres. */
const YIELD_LOOKAHEAD = 6;

/** The half-size of the intersection box a car must be clear of before another enters it. */
const CROSSING_HALF = 7;

/** How many replacement candidates the respawn governor tries before settling. */
const RESPAWN_TRIES = 6;

// A pace is a temperament, not a speed: the multiplier on the grid's cruise
// speed, and how common a driver with it is. A slow car is a truck in all but
// name; a quick one is always in a hurry. The shares add to one.
const PACES = [
  { name: 'slow', share: 0.25, mult: 0.78 },
  { name: 'cruise', share: 0.55, mult: 1.0 },
  { name: 'quick', share: 0.2, mult: 1.16 },
];

/** Roll a pace from the shares above: one random number, one temperament. */
function rollPace(random) {
  const roll = random();
  let edge = 0;
  for (const pace of PACES) {
    edge += pace.share;
    if (roll < edge) return pace;
  }
  return PACES[1];
}

/** A traffic car: axis 'x' or 'z', the road it is on, its lane, where it is going —
// and its own pace and cruise speed, rolled once at spawn and kept for life. */
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
  const pace = rollPace(random);
  const cruise = TRAFFIC.cruiseSpeed * pace.mult * (0.92 + random() * 0.16);
  const car = {
    kind: 'traffic',
    x: horizontal ? along : street + (dir > 0 ? -lane : lane),
    z: horizontal ? street + (dir > 0 ? lane : -lane) : along,
    heading: horizontal ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI),
    speed: cruise,
    steer: 0,
    color: 1 + Math.floor(random() * 7),
    id,
    axis: horizontal ? 'x' : 'z',
    dir,
    street,
    state: 'drive',
    pace: pace.name,
    cruise,
  };
  return car;
}

/**
 * A replacement for a car that drove off the edge. The governor tries several
 * candidates and keeps the best: far from the player (never popping into
 * existence on top of him) and, when it can, on a street the player is not
 * driving down — so the fresh car arrives from somewhere the player is not
 * looking, instead of materialising in his mirror.
 */
function respawnTrafficCar(city, random, id, player) {
  let best = null;
  let bestScore = -Infinity;
  for (let tries = 0; tries < RESPAWN_TRIES; tries += 1) {
    const car = spawnTrafficCar(city, random, id);
    const dx = car.x - player.x;
    const dz = car.z - player.z;
    const dist2 = dx * dx + dz * dz;
    if (dist2 < 20 * 20) continue;
    // A car on the player's own street is the worst surprise: prefer any other road.
    const playerStreet = Math.abs(player.x) < Math.abs(player.z)
      ? nearestStreet(player.z, city.streets)
      : nearestStreet(player.x, city.streets);
    const onPlayerStreet = car.axis === 'x'
      ? Math.abs(car.z - playerStreet) < 1
      : Math.abs(car.x - playerStreet) < 1;
    const score = dist2 - (onPlayerStreet ? 400 : 0);
    if (score > bestScore) {
      best = car;
      bestScore = score;
    }
  }
  return best ?? spawnTrafficCar(city, random, id);
}

/** The street line nearest to a coordinate along one axis. */
function nearestStreet(at, streets) {
  let best = streets[0];
  for (const s of streets) {
    if (Math.abs(s - at) < Math.abs(best - at)) best = s;
  }
  return best;
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

/**
 * Is the crossing ahead already occupied — a car on the cross street inside the
 * intersection box? A car that is itself turning through the crossing counts
 * too: the box is the crossing, whoever is in it owns it until they are out.
 * The box is centred on the crossing point (crossAt, on my road) and my street
 * line (crossCoord, across it): the other car's along-axis coordinate is
 * measured against my street line, its cross-axis coordinate against the
 * crossing point — the two axes must not be mixed up. Only a car that is
 * actually moving owns the crossing: a stopped car in the box — a police car
 * that finished a chase there, the player's car parked in it, a car ground to
 * a halt on a building corner — is an obstacle to drive around, not a
 * crossing to wait for, and counting it would jam the grid forever behind a
 * car that is never going to move.
 */
function crossingOccupied(car, crossingAhead, others) {
  const along = car.axis === 'x' ? car.x : car.z;
  const crossAt = along + crossingAhead * car.dir;
  const crossCoord = car.axis === 'x' ? car.z : car.x;
  for (const other of others) {
    if (other === car) continue;
    if (other.axis === car.axis) continue;
    if (Math.abs(other.speed || 0) <= 1) continue;
    const otherAlong = other.axis === 'x' ? other.x : other.z;
    const otherCross = other.axis === 'x' ? other.z : other.x;
    if (Math.abs(otherAlong - crossCoord) < CROSSING_HALF && Math.abs(otherCross - crossAt) < CROSSING_HALF) {
      return true;
    }
  }
  return false;
}

/** The car ahead in my lane, if there is one within the follow gap. */
function carAhead(car, others) {
  let nearest = null;
  let nearestAlong = Infinity;
  for (const other of others) {
    if (other === car) continue;
    const lateral = car.axis === 'x' ? Math.abs(other.z - car.z) : Math.abs(other.x - car.x);
    if (lateral > LANE_TOLERANCE) continue;
    const along = car.axis === 'x' ? (other.x - car.x) * car.dir : (other.z - car.z) * car.dir;
    if (along > 0 && along < TRAFFIC.followGap && along < nearestAlong) {
      nearest = other;
      nearestAlong = along;
    }
  }
  return nearest;
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
 * One fixed step for every traffic car. YIELD: a crossing ahead that another car
 * is already in — wait for it. SLOW: a car ahead in the same lane sets the pace
 * (its own cruise, never the grid's average). DRIVE: the car's own cruise, down
 * its own lane. At a crossing it may turn (TURN); at the edge it is replaced by
 * a fresh car rolling in from another edge. `others` is every other car on the
 * road, so traffic also yields to the player's car. `player` is optional: when
 * given, a replacement car is kept clear of him; without it the plaza centre is
 * the fallback.
 */
export function stepTraffic(cars, city, others, dt, random, player = { x: 0, z: 0 }) {
  for (let i = 0; i < cars.length; i += 1) {
    const car = cars[i];
    // YIELD first: a crossing just ahead, and someone is already in it — stop
    // at the line and wait, instead of nosing into the crossing behind them.
    const crossingAhead = nextCrossing(car, city);
    let targetSpeed = car.cruise;
    if (crossingAhead !== null && crossingAhead < YIELD_LOOKAHEAD
      && crossingOccupied(car, crossingAhead, others)) {
      car.state = 'yield';
      targetSpeed = 0;
    } else {
      // SLOW: something ahead in my lane within the follow gap — match its pace,
      // but never faster than my own cruise. `along` is signed: positive means
      // the other car is ahead of me, in my direction.
      const ahead = carAhead(car, others);
      if (ahead) {
        car.state = 'slow';
        targetSpeed = Math.min(car.cruise, Math.max(0, ahead.speed - 1));
      } else {
        car.state = 'drive';
      }
    }
    car.speed += (targetSpeed - car.speed) * Math.min(1, 1.5 * dt);

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
