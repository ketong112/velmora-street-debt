// Rook Marlowe, built from boxes and a capsule: no imported models, no textures, just
// authored forms — jacket, cap, boots — with a walk cycle driven by distance travelled
// (legs and arms swing opposite, torso bobs and leans) and a squash-pop on pickup.
// The group faces +Z when heading is 0; world.js steers `heading` to the movement direction.

import * as THREE from 'three';
import { PLAYER } from './config.js';

const JACKET = 0x2e6f5e;
const JACKET_DARK = 0x244f43;
const PANTS = 0x2b2f38;
const SKIN = 0xc98e6b;
const CAP = 0xd8a13c;
const BOOT = 0x1c1a18;
// Walk-cycle frequency: one full leg swing per this many radians of walk phase.
// The swing and the bob share it, so the feet and the torso never drift apart.
const STEP_FREQ = 2.4;

// The punch pose length, in seconds — the same 0.25 s combat.js sets punchTimer to.
const PUNCH_POSE_SECONDS = 0.25;

function box(w, h, d, color, x, y, z) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05 }),
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

/** Build Rook's body. Returns { group, parts } — parts holds the limbs the walk animates. */
export function createPlayerMesh() {
  const group = new THREE.Group();
  const parts = {};

  // Legs pivot at the hip (y 0.95) so the swing reads as a walk, not a slide.
  parts.legL = new THREE.Group();
  parts.legL.position.set(-0.14, 0.95, 0);
  parts.legL.add(box(0.2, 0.85, 0.24, PANTS, 0, -0.45, 0));
  parts.legL.add(box(0.22, 0.12, 0.34, BOOT, 0, -0.88, 0.05));
  parts.legR = new THREE.Group();
  parts.legR.position.set(0.14, 0.95, 0);
  parts.legR.add(box(0.2, 0.85, 0.24, PANTS, 0, -0.45, 0));
  parts.legR.add(box(0.22, 0.12, 0.34, BOOT, 0, -0.88, 0.05));
  group.add(parts.legL, parts.legR);

  // Torso: jacket with a darker belt line and a chest pocket.
  parts.torso = new THREE.Group();
  parts.torso.position.set(0, 0.95, 0);
  parts.torso.add(box(0.56, 0.62, 0.32, JACKET, 0, 0.31, 0));
  parts.torso.add(box(0.58, 0.08, 0.34, JACKET_DARK, 0, 0.02, 0));
  parts.torso.add(box(0.16, 0.14, 0.02, JACKET_DARK, -0.14, 0.44, 0.17));
  group.add(parts.torso);

  // Arms pivot at the shoulder (y 0.52 of the torso) and swing against the legs.
  parts.armL = new THREE.Group();
  parts.armL.position.set(-0.36, 0.52, 0);
  parts.armL.add(box(0.16, 0.58, 0.2, JACKET, 0, -0.28, 0));
  parts.armL.add(box(0.15, 0.12, 0.18, SKIN, 0, -0.6, 0));
  parts.armR = new THREE.Group();
  parts.armR.position.set(0.36, 0.52, 0);
  parts.armR.add(box(0.16, 0.58, 0.2, JACKET, 0, -0.28, 0));
  parts.armR.add(box(0.15, 0.12, 0.18, SKIN, 0, -0.6, 0));
  parts.torso.add(parts.armL, parts.armR);

  // Head: a box skull with a flat cap — the cap's gold is the same gold as the
  // cash bundles and the marked coupe, so Rook reads as the game's own character.
  parts.head = new THREE.Group();
  parts.head.position.set(0, 0.68, 0);
  const skull = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.3, 0.3),
    new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.7, metalness: 0 }),
  );
  skull.position.y = 0.15;
  skull.castShadow = true;
  const capTop = box(0.34, 0.09, 0.34, CAP, 0, 0.32, 0);
  const capBrim = box(0.34, 0.04, 0.16, CAP, 0, 0.28, 0.22);
  parts.head.add(skull, capTop, capBrim);
  parts.torso.add(parts.head);

  return { group, parts };
}

let pop = 0;

/** Call on pickup: a quick squash-and-stretch pop (game feel: brief, then back to rest). */
export function playerPickupPop() {
  pop = 1;
}

/**
 * Pose the character from the world state each frame. `dt` is the real frame delta;
 * the walk phase already advances with distance in world.js. `combat` drives the
 * punch and the aim: a punch throws the right arm forward, a shot holds it out.
 */
export function updatePlayerMesh(mesh, player, dt, combat) {
  const { group, parts } = mesh;
  group.position.set(player.x, 0, player.z);
  group.rotation.y = player.heading;

  // Full speed is the sprint speed from config: the 1.0 here is a sprint, not a walk.
  const speed01 = Math.min(1, player.speed / PLAYER.sprintSpeed);
  const swing = player.moving ? Math.sin(player.walkPhase * STEP_FREQ) * (0.35 + 0.45 * speed01) : 0;
  parts.legL.rotation.x = swing;
  parts.legR.rotation.x = -swing;
  parts.armL.rotation.x = -swing * 0.85;
  parts.armR.rotation.x = swing * 0.85;
  // A punch throws the right arm straight forward; a shot holds it out, aiming.
  // The pose is driven by the combat timers, so it always matches the real state.
  if (combat && combat.punchTimer > 0) {
    // The punch pose runs the same 0.25 s the punch timer does in combat.js:
    // keep the two in sync or the arm finishes before the swing does.
    const p = combat.punchTimer / PUNCH_POSE_SECONDS;
    parts.armR.rotation.x = -1.9 * Math.sin(p * Math.PI);
    parts.torso.rotation.y = 0.25 * Math.sin(p * Math.PI);
  } else if (combat && combat.muzzle > 0) {
    parts.armR.rotation.x = -1.5;
    parts.torso.rotation.y = 0;
  } else {
    parts.torso.rotation.y = 0;
  }
  // Bob and forward lean grow with speed; idle breathing when still.
  const t = performance.now() / 1000;
  const bob = player.moving ? Math.abs(Math.sin(player.walkPhase * STEP_FREQ)) * 0.06 * speed01 : Math.sin(t * 1.8) * 0.012;
  parts.torso.position.y = 0.95 + bob;
  parts.torso.rotation.x = speed01 * 0.12;
  parts.head.rotation.x = -speed01 * 0.06;

  if (pop > 0) {
    pop = Math.max(0, pop - dt / 0.18);
    // Squash: the body shortens and widens, then springs back to rest.
    const s = 1 - 0.14 * Math.sin(pop * Math.PI);
    group.scale.set(2 - s, s, 2 - s);
    if (pop === 0) group.scale.set(1, 1, 1);
  }
}
