// The screenshot scenes behind ?shot=start|play|end|drive|chase|mission|cover|combat.
// Each one plays the real rules forward from a fresh world for a fixed number of
// steps, steered by a simple autopilot (walk toward a target, enter a car, drive),
// so the frame is what a short game really looks like and the same seed always
// gives the same frame. Each scene also returns the camera the renderer should
// use, so a shot never depends on the mouse.

import { STEP } from './config.js';
import { createRandom } from './random.js';
import { spawnEnforcers } from './combat.js';
import { missionObjective } from './missions.js';
import { SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const START_SECONDS = 5;
const PLAY_SECONDS = 11;
const END_SECONDS = 20;
const DRIVE_WALK_SECONDS = 6;
const DRIVE_SECONDS = 3.5;
const CHASE_DRIVE_SECONDS = 2;
const CHASE_SECONDS = 5;

// The autopilot's stuck check: how often progress is judged, how little progress
// counts as stuck, and how long a sidestep detour runs.
const STUCK_CHECK_SECONDS = 0.8;
const STUCK_PROGRESS = 2.0;
const DETOUR_SECONDS = 0.6;
// The mission shot stages Rook this many metres from the drop-off.
const MISSION_SHOT_DISTANCE = 14;

/** Camera-relative move input that walks the player toward a target point. */
function autopilotTo(state, camYaw, brain, target) {
  const player = state.player;
  // Not getting closer to the target — a building is in the way. Sidestep around it,
  // alternating sides each time, then carry on. (Sliding along a wall still moves, so
  // low speed alone is not a reliable stuck signal.) Progress is judged over
  // STUCK_CHECK_SECONDS: at 6 m/s Rook should close ~4.8 m in that window. The check
  // pauses while a detour runs and restarts whenever the target changes, so turning
  // around after a pickup never looks like being stuck.
  const dx0 = target.x - player.x;
  const dz0 = target.z - player.z;
  const dist = Math.hypot(dx0, dz0);
  if (brain.detour <= 0) {
    brain.checkTimer += STEP;
    if (brain.checkTimer >= STUCK_CHECK_SECONDS) {
      if (brain.checkDist !== Infinity && dist > brain.checkDist - STUCK_PROGRESS) {
        brain.detour = DETOUR_SECONDS;
        brain.side *= -1;
      }
      brain.checkDist = dist;
      brain.checkTimer = 0;
    }
  }
  if (player.speed < 1.5) brain.stuck += STEP;
  else brain.stuck = 0;
  if (brain.stuck > 0.6) {
    brain.detour = DETOUR_SECONDS;
    brain.side *= -1;
    brain.stuck = 0;
  }
  let dx = dx0;
  let dz = dz0;
  if (brain.detour > 0) {
    brain.detour -= STEP;
    const rx = -dz * brain.side;
    const rz = dx * brain.side;
    dx = rx;
    dz = rz;
  }
  const len = Math.hypot(dx, dz) || 1;
  const wx = dx / len;
  const wz = dz / len;
  // Inverse of world's camera-relative transform: world -> camera space.
  const sin = Math.sin(camYaw);
  const cos = Math.cos(camYaw);
  return { x: wx * cos - wz * sin, z: -wx * sin - wz * cos };
}

/** Camera-relative move input that walks the player toward the nearest active drop. */
function autopilotDrop(state, camYaw, brain) {
  const player = state.player;
  let nearest = null;
  let nearestD = Infinity;
  for (const pickup of state.pickups) {
    if (!pickup.active) continue;
    const dx = pickup.x - player.x;
    const dz = pickup.z - player.z;
    const d = dx * dx + dz * dz;
    if (d < nearestD) {
      nearestD = d;
      nearest = pickup;
    }
  }
  if (nearest === null) return { x: 0, z: 0 };
  if (nearest !== brain.target) {
    brain.target = nearest;
    brain.checkDist = Infinity;
    brain.checkTimer = 0;
  }
  return autopilotTo(state, camYaw, brain, nearest);
}

function newBrain() {
  return { stuck: 0, detour: 0, side: 1, checkTimer: 0, checkDist: Infinity, target: null };
}

/** Walk to the starter car (the red one on the road south of the plaza) and get in. */
function enterStarterCar(world, camYaw) {
  const brain = newBrain();
  const car = world.state.cars[world.state.cars.length - 1]; // the starter car is last
  for (let index = 0; index < DRIVE_WALK_SECONDS / STEP; index += 1) {
    if (world.state.inCar) break;
    const move = autopilotTo(world.state, camYaw, brain, car);
    const near = Math.hypot(car.x - world.state.player.x, car.z - world.state.player.z) < 3;
    world.step(STEP, move.x, move.z, camYaw, false, false, near ? { enter: true } : undefined);
  }
  return world.state.inCar;
}

/**
 * Fixed camera ahead and to the side of `p`, looking back at it — the police cars
 * chasing from behind are in the frame with it, plus the wanted stars. Shared by
 * the cover and the chase scenes, so the two frames read the same way.
 */
function chaseCamera(p) {
  const h = p.heading;
  const fx = Math.sin(h);
  const fz = Math.cos(h);
  const rx = Math.cos(h);
  const rz = -Math.sin(h);
  return {
    mode: 'fixed',
    pos: [p.x + fx * 16 + rx * 11, 7, p.z + fz * 16 + rz * 11],
    target: [p.x - fx * 6, 1.5, p.z - fz * 6],
  };
}

/**
 * Set `world` to the named scene and return the screen to draw over it, the best cash
 * to show, and the camera view for the frame.
 */
export function stageShot(name, world) {
  world.reset();
  if (name !== 'play' && name !== 'end' && name !== 'drive' && name !== 'chase' && name !== 'mission' && name !== 'cover' && name !== 'combat') {
    for (let index = 0; index < START_SECONDS / STEP; index += 1) {
      world.step(STEP, 0, 0, Math.PI, false, true);
    }
    // Rook waits on the road south of the plaza, facing the camera — verified visible
    // from the cover camera, clear of the title panel and of every tower.
    world.state.player.x = 0;
    world.state.player.z = 30;
    world.state.player.heading = Math.atan2(78, 29);
    return {
      screen: SCREEN_TITLE,
      best: 0,
      view: { mode: 'orbit', angle: 0.65, radius: 88, height: 48 },
    };
  }

  if (name === 'cover') {
    // The cover: a chase with the most systems in one frame — Rook driving the
    // starter car, three stars of heat, police cars closing in, the mission beacon
    // over the plaza and the objective line on the HUD, the minimap live.
    const camYaw = Math.PI;
    enterStarterCar(world, camYaw);
    for (let index = 0; index < CHASE_DRIVE_SECONDS / STEP; index += 1) {
      world.step(STEP, 0, 1, camYaw, false, false);
    }
    // The $1,500 is in: the mission flips to "return to the plaza" and the beacon moves there.
    world.state.cash = 1500;
    for (let index = 0; index < 30; index += 1) {
      world.step(STEP, 0, 0, camYaw, false, false);
    }
    // Three stars of heat, then let the police cars close in while the player coasts.
    world.state.wanted = 3;
    for (let index = 0; index < CHASE_SECONDS / STEP; index += 1) {
      world.step(STEP, 0, 0, camYaw, false, false);
    }
    // Fixed camera ahead and to the side of the car, looking back at it — the police
    // cars chasing from behind are in the frame with it, plus the wanted stars.
    const p = world.state.currentCar ?? world.state.player;
    return {
      screen: SCREEN_PLAY,
      best: world.state.cash,
      view: chaseCamera(p),
    };
  }

  if (name === 'combat') {
    // Combat on foot: Rook has the pistol, two enforcers close in, a foot cop
    // chases from the plaza side. A fixed camera behind Rook, looking at the
    // nearest enforcer, so the fight reads at a glance.
    const s = world.state;
    s.combat.hasPistol = true;
    s.combat.ammo = 12;
    const random = createRandom(20261118);
    spawnEnforcers(s.combat, s.city, s.player, 2, random);
    // Compose the fight: the enforcers close, the cop closing from the plaza side.
    s.combat.enforcers[0].x = s.player.x + 2.5;
    s.combat.enforcers[0].z = s.player.z + 1.5;
    s.combat.enforcers[1].x = s.player.x - 3.5;
    s.combat.enforcers[1].z = s.player.z + 2;
    s.player.heading = Math.atan2(2.5, 1.5);
    s.wanted = 1;
    for (let index = 0; index < 30; index += 1) {
      world.step(STEP, 0, 0, Math.PI, false, false);
    }
    const p = s.player;
    const e = s.combat.enforcers[0];
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    const rx = Math.cos(p.heading);
    const rz = -Math.sin(p.heading);
    return {
      screen: SCREEN_PLAY,
      best: s.cash,
      view: {
        mode: 'fixed',
        pos: [p.x - fx * 7 + rx * 4, 3.5, p.z - fz * 7 + rz * 4],
        target: [e.x, 1.2, e.z],
      },
    };
  }

  if (name === 'drive' || name === 'chase') {
    const camYaw = Math.PI;
    enterStarterCar(world, camYaw);
    const driveSeconds = name === 'chase' ? CHASE_DRIVE_SECONDS : DRIVE_SECONDS;
    for (let index = 0; index < driveSeconds / STEP; index += 1) {
      // Full throttle, straight down the avenue.
      world.step(STEP, 0, 1, camYaw, false, false);
    }
    const car = world.state.currentCar;
    if (name === 'drive') {
      // Chase camera behind the car, looking down the avenue it is driving.
      const yaw = car ? car.heading + Math.PI : camYaw;
      return {
        screen: SCREEN_PLAY,
        best: world.state.cash,
        view: { mode: 'follow', yaw, pitch: 0.3 },
      };
    }
    // Chase: three stars of heat, then let the police cars close in while the player
    // coasts — slow enough that the faster police cars catch up and ram, mid-city.
    world.state.wanted = 3;
    for (let index = 0; index < CHASE_SECONDS / STEP; index += 1) {
      world.step(STEP, 0, 0, camYaw, false, false);
    }
    const p = world.state.currentCar ?? world.state.player;
    return {
      screen: SCREEN_PLAY,
      best: world.state.cash,
      view: chaseCamera(p),
    };
  }

  if (name === 'mission') {
    // The Midnight Parcel mid-delivery: Rook is behind the wheel of the starter
    // car, 14 metres from the drop-off, the parcel in hand, 38 seconds on the
    // clock, the beacon over the drop-off and the timer on the HUD.
    world.state.missions.index = 1;
    for (let index = 0; index < 5; index += 1) {
      world.step(STEP, 0, 0, Math.PI, false, false);
    }
    const s = world.state;
    const mission = s.missions.list[1];
    const car = s.cars[s.cars.length - 1]; // the starter car
    const drop = mission.dropoff;
    const dx = drop.x - s.player.x;
    const dz = drop.z - s.player.z;
    const dist = Math.hypot(dx, dz) || 1;
    car.x = drop.x - (dx / dist) * MISSION_SHOT_DISTANCE;
    car.z = drop.z - (dz / dist) * MISSION_SHOT_DISTANCE;
    car.heading = Math.atan2(dx, dz);
    car.speed = 0;
    s.currentCar = car;
    s.inCar = true;
    s.player.x = car.x;
    s.player.z = car.z;
    s.player.heading = car.heading;
    s.cash = 1500;
    mission.phase = 'deliver';
    mission.timeLeft = 38;
    s.combat.hasPackage = true;
    // The phase was set by hand after the last step, so the objective (and the
    // beacon that follows it) is stale: recompute it for the staged phase.
    s.objective = missionObjective(s.missions, s);
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    // Straight behind the car, up high, looking at the drop-off: the road is
    // clear behind the car (no tower in the way), the car sits low in frame
    // and the beacon over the drop-off is the centre of the shot.
    return {
      screen: SCREEN_PLAY,
      best: s.cash,
      view: {
        mode: 'fixed',
        pos: [car.x - fx * 16, 10, car.z - fz * 16],
        target: [drop.x, 2, drop.z],
      },
    };
  }

  const seconds = name === 'end' ? END_SECONDS : PLAY_SECONDS;
  const camYaw = Math.PI;
  const brain = newBrain();
  for (let index = 0; index < seconds / STEP; index += 1) {
    const move = autopilotDrop(world.state, camYaw, brain);
    world.step(STEP, move.x, move.z, camYaw, false, false);
  }

  if (name === 'end') {
    // Higher three-quarter shot from behind Rook, looking down the avenue he is walking,
    // far enough back that the nearest wall can't fill the frame.
    const p = world.state.player;
    const backX = -Math.sin(p.heading) * 12;
    const backZ = -Math.cos(p.heading) * 12;
    return {
      screen: SCREEN_PLAY,
      best: world.state.cash,
      view: {
        mode: 'fixed',
        pos: [p.x + backX + Math.cos(p.heading) * 5, 6, p.z + backZ - Math.sin(p.heading) * 5],
        target: [p.x + Math.sin(p.heading) * 12, 1.4, p.z + Math.cos(p.heading) * 12],
      },
    };
  }
  return {
    screen: SCREEN_PLAY,
    best: world.state.cash,
    view: { mode: 'follow', yaw: camYaw, pitch: 0.22 },
  };
}
