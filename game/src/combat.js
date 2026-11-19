// Combat: a punch and four guns, and the enforcers who chase Rook during the getaway
// and the safehouse stand. One job: who can be hit, what a hit does, and who is
// hunting the player. The game-feel skill's recipe, in plain JS — a punch that
// lands freezes the world for a beat (hit-stop, owned by main.js), knocks the target
// back, and shakes the camera; a gunshot is a hit-scan along the camera's aim, with
// limited ammo so every round counts. Enforcers are the game-ai skill's seek steering
// again: chase the player, punch at arm's reach, get back up after a while unless the
// mission is over. The guns: the pistol cracks, the shotgun spreads, the SMG sprays
// fast at close range, the rifle drops a man in one hit from across the plaza.

import { COMBAT, ENFORCER, WEAPONS } from './config.js';
import { collidesWithCity } from './city.js';
import { addWanted, damagePlayer } from './police.js';

const TWO_PI = Math.PI * 2;

// How long a dropped foot cop stays down, and how long the muzzle flash lives.
const COP_DOWN_SECONDS = 8;
const MUZZLE_SECONDS = 0.09;

function angleDelta(from, to) {
  let d = (to - from) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return d;
}

/** Combat state: cooldowns, the four guns, the parcel, and the enforcers. */
export function createCombat() {
  return {
    punchCooldown: 0,
    punchTimer: 0,
    fireCooldown: 0,
    muzzle: 0,
    hasPistol: false,
    ammo: 0,
    pistol: null, // { x, z, taken } — the pickup, once the story leaves it out
    weapon: 'pistol', // the gun in hand: 'pistol', 'shotgun', 'smg' or 'rifle' (Q cycles the owned ones)
    hasShotgun: false,
    shells: 0,
    hasSmg: false,
    smgAmmo: 0,
    hasRifle: false,
    rifleAmmo: 0,
    hasPackage: false,
    enforcers: [],
  };
}

// How many random street points to try before falling back to a point behind the player.
const SPAWN_TRIES = 12;

/** A street point a set distance from the player, on a road, for spawning enforcers. */
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
  return { x: player.x + distance, z: player.z };
}

/** An enforcer: position, heading, health, and whether he is up or down. */
function makeEnforcer(x, z, id) {
  return {
    x, z, heading: 0, speed: 0, walkPhase: 0,
    hp: ENFORCER.health, state: 'chase', attackCooldown: 0, downTimer: 0, id,
  };
}

/** Spawn the getaway's enforcers near the player. */
export function spawnEnforcers(combat, city, player, count, random) {
  combat.enforcers = [];
  for (let i = 0; i < count; i += 1) {
    const p = spawnPointNear(city, player, ENFORCER.spawnDistance, random);
    combat.enforcers.push(makeEnforcer(p.x, p.z, i));
  }
}

/**
 * Spawn one wave of enforcers for the safehouse stand — appended, not reset:
 * a wave only arrives when the last one is fully down, so the list holds one
 * wave at a time and the renderer's pool of three never overflows.
 */
export function spawnEnforcerWave(combat, city, player, count, random) {
  const base = combat.enforcers.length;
  for (let i = 0; i < count; i += 1) {
    const p = spawnPointNear(city, player, ENFORCER.spawnDistance, random);
    combat.enforcers.push(makeEnforcer(p.x, p.z, base + i));
  }
}

/** Every hostile in reach: foot cops still standing, and enforcers still up. */
function hostiles(state) {
  const out = [];
  for (const cop of state.police.footCops) {
    if (cop.state !== 'down') out.push({ x: cop.x, z: cop.z, kind: 'cop', ref: cop });
  }
  for (const e of state.combat.enforcers) {
    if (e.state !== 'down') out.push({ x: e.x, z: e.z, kind: 'enforcer', ref: e });
  }
  return out;
}

/** Shove a target away from the player by `distance` metres. */
function knockback(target, player, distance) {
  const dx = target.x - player.x;
  const dz = target.z - player.z;
  const d = Math.hypot(dx, dz) || 1;
  target.x += (dx / d) * distance;
  target.z += (dz / d) * distance;
}

/**
 * Put a target down once its health is gone. A cop who goes down is out for
 * COP_DOWN_SECONDS and the law notices (+1 star); an enforcer stays down
 * ENFORCER.downTime. Returns 'cop' or 'enforcer', or null when still standing.
 * Both the punch and the shot end here, so the two never drift apart.
 */
function downTarget(target, state) {
  if (target.ref.hp > 0) return null;
  if (target.kind === 'cop') {
    target.ref.state = 'down';
    target.ref.downTimer = COP_DOWN_SECONDS;
    addWanted(state, 1);
    if (state.ledger) state.ledger.copsDowned += 1;
    return 'cop';
  }
  target.ref.state = 'down';
  target.ref.downTimer = ENFORCER.downTime;
  if (state.ledger) state.ledger.enforcersDowned += 1;
  return 'enforcer';
}

/**
 * What a hit does to its target: damage, knockback, and down if health is gone.
 * Returns 'cop' or 'enforcer' when the target went down, null otherwise.
 */
function applyHit(combat, state, target) {
  target.ref.hp -= COMBAT.punchDamage;
  knockback(target.ref, state.player, COMBAT.punchKnockback);
  return downTarget(target, state);
}

/**
 * F to punch, on foot only. Returns { swung, hit, down } — swung when the fist
 * went out at all (even a whiff animates), hit when it connected, down when the
 * target went down ('cop' or 'enforcer'). A punch auto-faces the nearest hostile
 * in range: a brawler that makes you face exactly right before every swing feels
 * finicky, not skilful.
 */
export function tryPunch(combat, state) {
  if (state.inCar || combat.punchCooldown > 0) return { swung: false, hit: false, down: null };
  combat.punchCooldown = COMBAT.punchCooldown;
  combat.punchTimer = 0.25;
  const player = state.player;
  let best = null;
  let bestD = COMBAT.punchRange * COMBAT.punchRange;
  for (const target of hostiles(state)) {
    const dx = target.x - player.x;
    const dz = target.z - player.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= bestD) continue;
    const bearing = Math.atan2(dx, dz);
    if (Math.abs(angleDelta(player.heading, bearing)) > COMBAT.punchArc) continue;
    bestD = d2;
    best = target;
  }
  if (!best) return { swung: true, hit: false, down: null };
  // Face the target: the swing reads as aimed, and the next one does too.
  player.heading = Math.atan2(best.x - player.x, best.z - player.z);
  const down = applyHit(combat, state, best);
  return { swung: true, hit: true, down };
}

/**
 * G to fire, on foot only, a gun in hand. Hit-scan along the camera's aim: the
 * nearest hostile within a narrow cone takes the round. Returns { fired, empty,
 * hit, down, weapon } — fired when a round left the barrel, empty when the trigger
 * clicked on an empty magazine, weapon the gun that fired.
 *
 * The shotgun is a different shot: one shell, a wide cone, every hostile inside
 * it takes pellets at once. Up close it drops a cop in one pull; at range the
 * pellets spread thin and it is a loud way to miss. The SMG sprays the same
 * cone as the pistol but near-automatic; the rifle is one slow, hard, far shot.
 */
export function tryFire(combat, state, camYaw) {
  if (state.inCar || combat.fireCooldown > 0) {
    return { fired: false, empty: false, hit: false, down: null, weapon: combat.weapon };
  }
  const owned = {
    pistol: combat.hasPistol,
    shotgun: combat.hasShotgun,
    smg: combat.hasSmg,
    rifle: combat.hasRifle,
  };
  const weapon = owned[combat.weapon] ? combat.weapon : 'pistol';
  if (weapon === 'shotgun') return tryFireShotgun(combat, state, camYaw);
  if (weapon === 'smg') return tryFireSmg(combat, state, camYaw);
  if (weapon === 'rifle') return tryFireRifle(combat, state, camYaw);
  if (!combat.hasPistol) {
    return { fired: false, empty: false, hit: false, down: null, weapon: 'pistol' };
  }
  if (combat.ammo <= 0) {
    combat.fireCooldown = COMBAT.fireCooldown;
    return { fired: false, empty: true, hit: false, down: null, weapon: 'pistol' };
  }
  combat.ammo -= 1;
  combat.fireCooldown = COMBAT.fireCooldown;
  combat.muzzle = MUZZLE_SECONDS;
  if (state.ledger) state.ledger.shotsFired += 1;
  const dx = -Math.sin(camYaw);
  const dz = -Math.cos(camYaw);
  const player = state.player;
  // Face the aim, like the punch faces its target: the muzzle flash in render.js
  // is drawn along the player's heading, so the flash and the shot agree.
  player.heading = Math.atan2(dx, dz);
  let best = null;
  let bestD = COMBAT.fireRange * COMBAT.fireRange;
  for (const target of hostiles(state)) {
    const tx = target.x - player.x;
    const tz = target.z - player.z;
    const d2 = tx * tx + tz * tz;
    if (d2 >= bestD) continue;
    const d = Math.sqrt(d2) || 1;
    // Cosine of the angle between the aim and the target: near 1 means dead on.
    const cos = (tx * dx + tz * dz) / d;
    if (cos < Math.cos(COMBAT.fireArc)) continue;
    bestD = d2;
    best = target;
  }
  if (!best) return { fired: true, empty: false, hit: false, down: null, weapon: 'pistol' };
  // A gunshot hits as hard as a punch, but from across the street. The knockback
  // is halved on purpose: a full shove would push the target out of the next
  // shot's cone and make follow-up shots feel like misses.
  best.ref.hp -= COMBAT.fireDamage;
  knockback(best.ref, state.player, COMBAT.punchKnockback * 0.5);
  const down = downTarget(best, state);
  return { fired: true, empty: false, hit: true, down, weapon: 'pistol' };
}

/**
 * The shotgun's shot: one shell, a wide cone, every hostile inside it takes
 * pellets. Returns the same shape as tryFire, with weapon 'shotgun'.
 */
function tryFireShotgun(combat, state, camYaw) {
  if (combat.shells <= 0) {
    combat.fireCooldown = COMBAT.shotgunCooldown;
    return { fired: false, empty: true, hit: false, down: null, weapon: 'shotgun' };
  }
  combat.shells -= 1;
  combat.fireCooldown = COMBAT.shotgunCooldown;
  combat.muzzle = MUZZLE_SECONDS;
  if (state.ledger) state.ledger.shotsFired += 1;
  const dx = -Math.sin(camYaw);
  const dz = -Math.cos(camYaw);
  const player = state.player;
  player.heading = Math.atan2(dx, dz);
  let hit = false;
  let down = null;
  const cosLimit = Math.cos(COMBAT.shotgunArc);
  for (const target of hostiles(state)) {
    const tx = target.x - player.x;
    const tz = target.z - player.z;
    const d2 = tx * tx + tz * tz;
    if (d2 >= COMBAT.shotgunRange * COMBAT.shotgunRange) continue;
    const d = Math.sqrt(d2) || 1;
    const cos = (tx * dx + tz * dz) / d;
    if (cos < cosLimit) continue;
    // Pellets at close range hit harder: point-blank is a full blast, the far
    // edge of the cone is a graze. A cop has 2 health, an enforcer 3.
    const damage = d < 6 ? COMBAT.shotgunPelletDamage * 2 : COMBAT.shotgunPelletDamage;
    target.ref.hp -= damage;
    knockback(target.ref, state.player, COMBAT.punchKnockback);
    hit = true;
    const wentDown = downTarget(target, state);
    if (wentDown) down = wentDown;
  }
  return { fired: true, empty: false, hit, down, weapon: 'shotgun' };
}

/**
 * The SMG's shot: the pistol's shape, near-automatic — one round, a slightly
 * wider cone, and a cooldown short enough that holding G keeps it firing.
 */
function tryFireSmg(combat, state, camYaw) {
  if (combat.smgAmmo <= 0) {
    combat.fireCooldown = WEAPONS.smg.cooldown;
    return { fired: false, empty: true, hit: false, down: null, weapon: 'smg' };
  }
  combat.smgAmmo -= 1;
  combat.fireCooldown = WEAPONS.smg.cooldown;
  combat.muzzle = MUZZLE_SECONDS;
  if (state.ledger) state.ledger.shotsFired += 1;
  const dx = -Math.sin(camYaw);
  const dz = -Math.cos(camYaw);
  const player = state.player;
  player.heading = Math.atan2(dx, dz);
  let best = null;
  let bestD = WEAPONS.smg.range * WEAPONS.smg.range;
  for (const target of hostiles(state)) {
    const tx = target.x - player.x;
    const tz = target.z - player.z;
    const d2 = tx * tx + tz * tz;
    if (d2 >= bestD) continue;
    const d = Math.sqrt(d2) || 1;
    const cos = (tx * dx + tz * dz) / d;
    if (cos < Math.cos(WEAPONS.smg.arc)) continue;
    bestD = d2;
    best = target;
  }
  if (!best) return { fired: true, empty: false, hit: false, down: null, weapon: 'smg' };
  best.ref.hp -= WEAPONS.smg.damage;
  knockback(best.ref, state.player, COMBAT.punchKnockback * 0.5);
  const down = downTarget(best, state);
  return { fired: true, empty: false, hit: true, down, weapon: 'smg' };
}

/**
 * The rifle's shot: one slow, hard, far round — the nearest hostile in a needle
 * cone takes three damage, enough to drop a cop or an enforcer in one hit.
 */
function tryFireRifle(combat, state, camYaw) {
  if (combat.rifleAmmo <= 0) {
    combat.fireCooldown = WEAPONS.rifle.cooldown;
    return { fired: false, empty: true, hit: false, down: null, weapon: 'rifle' };
  }
  combat.rifleAmmo -= 1;
  combat.fireCooldown = WEAPONS.rifle.cooldown;
  combat.muzzle = MUZZLE_SECONDS;
  if (state.ledger) state.ledger.shotsFired += 1;
  const dx = -Math.sin(camYaw);
  const dz = -Math.cos(camYaw);
  const player = state.player;
  player.heading = Math.atan2(dx, dz);
  let best = null;
  let bestD = WEAPONS.rifle.range * WEAPONS.rifle.range;
  for (const target of hostiles(state)) {
    const tx = target.x - player.x;
    const tz = target.z - player.z;
    const d2 = tx * tx + tz * tz;
    if (d2 >= bestD) continue;
    const d = Math.sqrt(d2) || 1;
    const cos = (tx * dx + tz * dz) / d;
    if (cos < Math.cos(WEAPONS.rifle.arc)) continue;
    bestD = d2;
    best = target;
  }
  if (!best) return { fired: true, empty: false, hit: false, down: null, weapon: 'rifle' };
  best.ref.hp -= WEAPONS.rifle.damage;
  knockback(best.ref, state.player, COMBAT.punchKnockback);
  const down = downTarget(best, state);
  return { fired: true, empty: false, hit: true, down, weapon: 'rifle' };
}

/**
 * Q to switch guns, on foot only: cycles pistol -> shotgun -> smg -> rifle
 * among the guns Rook owns. Returns the gun now in hand, or null when there
 * is nothing to switch to.
 */
export function trySwitchWeapon(combat, state) {
  if (state.inCar) return null;
  const owned = [];
  if (combat.hasPistol) owned.push('pistol');
  if (combat.hasShotgun) owned.push('shotgun');
  if (combat.hasSmg) owned.push('smg');
  if (combat.hasRifle) owned.push('rifle');
  if (owned.length < 2) return null;
  const at = owned.indexOf(combat.weapon);
  combat.weapon = owned[(at + 1) % owned.length];
  return combat.weapon;
}

/** The pistol pickup: walk over it and the pistol is yours, 12 rounds. */
export function collectPistol(combat, state) {
  const pistol = combat.pistol;
  if (!pistol || pistol.taken || combat.hasPistol) return false;
  const dx = pistol.x - state.player.x;
  const dz = pistol.z - state.player.z;
  if (dx * dx + dz * dz >= COMBAT.pistolRadius * COMBAT.pistolRadius) return false;
  pistol.taken = true;
  combat.hasPistol = true;
  combat.ammo = COMBAT.pistolAmmo;
  return true;
}

/** Cooldowns and the muzzle flash tick down every fixed step. */
export function stepCombat(combat, dt) {
  combat.punchCooldown = Math.max(0, combat.punchCooldown - dt);
  combat.punchTimer = Math.max(0, combat.punchTimer - dt);
  combat.fireCooldown = Math.max(0, combat.fireCooldown - dt);
  combat.muzzle = Math.max(0, combat.muzzle - dt);
}

/**
 * One fixed step for the enforcers: chase the player (seek steering), punch at
 * arm's reach. A downed enforcer gets back up after ENFORCER.downTime with full
 * health. Returns 1 when an enforcer's punch busted the player, 0 otherwise.
 */
export function stepEnforcers(combat, state, dt) {
  const { city, player } = state;
  for (const e of combat.enforcers) {
    if (e.state === 'down') {
      e.downTimer -= dt;
      if (e.downTimer <= 0) {
        e.state = 'chase';
        e.hp = ENFORCER.health;
      }
      continue;
    }
    e.attackCooldown = Math.max(0, e.attackCooldown - dt);
    const dx = player.x - e.x;
    const dz = player.z - e.z;
    const dist = Math.hypot(dx, dz) || 1;
    const wantHeading = Math.atan2(dx, dz);
    const dh = angleDelta(e.heading, wantHeading);
    e.heading += Math.max(-4 * dt, Math.min(4 * dt, dh));
    // In reach, an enforcer plants his feet and swings instead of running through
    // the player — the fight stays readable, and he cannot orbit behind Rook.
    if (dist > ENFORCER.attackRange) {
      e.speed += (ENFORCER.speed - e.speed) * Math.min(1, 3 * dt);
      const nx = e.x + Math.sin(e.heading) * e.speed * dt;
      const nz = e.z + Math.cos(e.heading) * e.speed * dt;
      // Enforcers walk the streets like everyone else: a wall stops them, never lets them through.
      if (!collidesWithCity(city, nx, nz, 0.55)) {
        e.x = nx;
        e.z = nz;
      }
    } else {
      e.speed = 0;
    }
    e.walkPhase += e.speed * dt * 2.2;
    // A punch only lands on a player on foot, at arm's reach. The shove is short
    // on purpose: a longer one would push Rook out of his own punch range, and
    // the fight would stop being a brawl.
    if (!state.inCar && dist < ENFORCER.attackRange && e.attackCooldown <= 0) {
      e.attackCooldown = ENFORCER.attackCooldown;
      player.x += (dx / dist) * 0.8;
      player.z += (dz / dist) * 0.8;
      // Armor eats the punch first (damagePlayer), like every other hit in the game.
      if (damagePlayer(state, ENFORCER.attackDamage)) return 1;
    }
  }
  return 0;
}
