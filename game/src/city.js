// The city of Port Velmora as pure data: a seeded 5x5 block grid, the buildings on it,
// the central plaza, street props and cash-drop spawn points. No drawing and no three.js
// in here — render.js turns this layout into meshes, world.js turns it into collision.
// The same seed always builds the same city, which is what makes screenshots repeatable.

import { CITY } from './config.js';
import { randomInt } from './random.js';

const PLAZA = { bx: 0, bz: 0 };

// The plaza's dressing rings: benches close in, trees outside them, planters on the corners.
const PLAZA_BENCH_RADIUS = 11;
const PLAZA_TREE_RADIUS = 17.5;
// Planters sit just inside the plaza's edge (the plaza is 50 m across, so half is 25).
const PLAZA_PLANTER_OFFSET = 21;

/** Facade variants: base colour, window-lit colour, and how busy the windows look. */
export const FACADES = [
  { base: '#7a5a48', lit: '#ffd27a', windows: 0.42 },
  { base: '#5d6b7a', lit: '#ffe9a8', windows: 0.38 },
  { base: '#8a7f6a', lit: '#ffc46b', windows: 0.45 },
  { base: '#6b4a52', lit: '#ffb46b', windows: 0.34 },
];

/**
 * Build the layout for `seed`. Returns:
 * buildings: [{x, z, w, d, h, facade, roof}] centred on x/z, h metres tall;
 * props: lamps {x, z}, hydrants {x, z}, benches {x, z, angle}, trees {x, z, size},
 * planters {x, z};
 * plaza: {x, z, size, fountainRadius}; spawnPoints: [{x, z}] for cash drops;
 * bounds: the playable half-extent; streets: the street centre lines for the minimap.
 */
export function createCity(random) {
  const { blocks, blockSize, streetWidth, pitch, halfExtent } = CITY;
  const half = (blocks - 1) / 2;
  const buildings = [];
  const lamps = [];
  const hydrants = [];
  const benches = [];
  const trees = [];
  const planters = [];
  const spawnPoints = [];
  const streets = [];
  // Roads run BETWEEN blocks: centrelines at half-pitch offsets, not at block centres.
  for (let i = -half - 1; i <= half; i += 1) {
    streets.push(i * pitch + pitch / 2);
  }

  for (let bx = -half; bx <= half; bx += 1) {
    for (let bz = -half; bz <= half; bz += 1) {
      const cx = bx * pitch;
      const cz = bz * pitch;
      if (bx === PLAZA.bx && bz === PLAZA.bz) continue; // the plaza stays open

      // Taller towers near the centre, lower walk-ups at the edges.
      const centrality = 1 - (Math.abs(bx) + Math.abs(bz)) / (blocks - 1);
      const count = 1 + randomInt(random, 3);
      for (let n = 0; n < count; n += 1) {
        const w = 12 + random() * 16;
        const d = 12 + random() * 16;
        const margin = (blockSize - Math.max(w, d)) / 2 - 1;
        // The margin keeps every building at least 1 m inside its block, so the
        // streets — and the corners where they cross — stay open road. The safehouse
        // door stands on the (-25, 75) corner, and it stays reachable because no
        // building can ever cover it.
        const ox = (random() * 2 - 1) * Math.max(0, margin);
        const oz = (random() * 2 - 1) * Math.max(0, margin);
        const h = Math.round(
          CITY.minHeight +
            random() * (CITY.maxHeight - CITY.minHeight) * (0.35 + 0.65 * centrality),
        );
        buildings.push({
          x: cx + ox,
          z: cz + oz,
          w,
          d,
          h,
          facade: randomInt(random, FACADES.length),
          // Roof dressing: 0 flat, 1 rooftop box, 2 antenna spire on the tallest.
          roof: h > 34 && random() < 0.5 ? 2 : random() < 0.55 ? 1 : 0,
        });
      }

      // One cash-drop spawn on a sidewalk corner of most blocks.
      if (random() < 0.8) {
        spawnPoints.push({
          x: cx + (blockSize / 2 + streetWidth / 2) * (random() < 0.5 ? -1 : 1),
          z: cz + (blockSize / 2 + streetWidth / 2) * (random() < 0.5 ? -1 : 1),
        });
      }
    }
  }

  // Plaza: fountain at the centre, benches ringing it, lamps at the corners.
  const plaza = { x: 0, z: 0, size: blockSize + streetWidth, fountainRadius: CITY.plazaFountainRadius };
  for (let a = 0; a < 8; a += 1) {
    const angle = (a / 8) * Math.PI * 2 + Math.PI / 8;
    benches.push({ x: Math.cos(angle) * PLAZA_BENCH_RADIUS, z: Math.sin(angle) * PLAZA_BENCH_RADIUS, angle: angle + Math.PI / 2 });
  }
  // Trees ring the plaza outside the benches, and planters dress its corners —
  // the wide shots of the plaza read empty without them.
  for (let a = 0; a < 6; a += 1) {
    const angle = (a / 6) * Math.PI * 2 + Math.PI / 12;
    trees.push({ x: Math.cos(angle) * PLAZA_TREE_RADIUS, z: Math.sin(angle) * PLAZA_TREE_RADIUS, size: 0.85 + random() * 0.4 });
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      planters.push({ x: sx * PLAZA_PLANTER_OFFSET, z: sz * PLAZA_PLANTER_OFFSET });
    }
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      lamps.push({ x: sx * (plaza.size / 2 - 2), z: sz * (plaza.size / 2 - 2) });
      spawnPoints.push({ x: sx * (plaza.size / 2 - 4), z: sz * (plaza.size / 2 - 4) });
    }
  }

  // Street lamps along the avenues, one per block edge, alternating sides so the
  // avenues never read as a single unbroken line of light.
  for (let i = -half; i <= half; i += 1) {
    for (let j = -half; j < half; j += 1) {
      const along = j * pitch + pitch / 2;
      const side = (i + j) % 2 === 0 ? 1 : -1;
      lamps.push({ x: i * pitch + side * (streetWidth / 2 - 1.2), z: along });
      lamps.push({ x: along, z: i * pitch - side * (streetWidth / 2 - 1.2) });
    }
  }

  // Hydrants: a few, tucked against block corners.
  for (let n = 0; n < 10; n += 1) {
    const bx = randomInt(random, blocks) - half;
    const bz = randomInt(random, blocks) - half;
    if (bx === PLAZA.bx && bz === PLAZA.bz) continue;
    hydrants.push({
      x: bx * pitch + (blockSize / 2 + 1) * (random() < 0.5 ? -1 : 1),
      z: bz * pitch + (blockSize / 2 + 1) * (random() < 0.5 ? -1 : 1),
    });
  }

  // A few drops out on the avenues themselves, mid-block — including the roads south
  // of the plaza Rook starts on, so the opening minute always has a drop in sight.
  // (Roads are the ±25 / ±75 lines; block centres are NOT roads.)
  spawnPoints.push(
    { x: 25, z: 45 }, { x: -25, z: 45 }, { x: 25, z: 68 }, { x: -25, z: 68 },
    { x: 25, z: -45 }, { x: -25, z: -45 },
  );
  for (let n = 0; n < 6; n += 1) {
    const street = streets[Math.floor(random() * streets.length)];
    const along = (random() * 2 - 1) * (halfExtent - 20);
    if (random() < 0.5) spawnPoints.push({ x: street, z: along });
    else spawnPoints.push({ x: along, z: street });
  }

  return { buildings, lamps, hydrants, benches, trees, planters, plaza, spawnPoints, bounds: halfExtent, streets };
}

/** True when the circle at (x, z) with `radius` overlaps a building or the plaza fountain. */
export function collidesWithCity(city, x, z, radius) {
  for (const b of city.buildings) {
    const nx = Math.max(b.x - b.w / 2, Math.min(x, b.x + b.w / 2));
    const nz = Math.max(b.z - b.d / 2, Math.min(z, b.z + b.d / 2));
    const dx = x - nx;
    const dz = z - nz;
    if (dx * dx + dz * dz < radius * radius) return true;
  }
  const dx = x - city.plaza.x;
  const dz = z - city.plaza.z;
  const fr = city.plaza.fountainRadius + radius;
  return dx * dx + dz * dz < fr * fr;
}
