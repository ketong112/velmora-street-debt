// VELMORA — Street Debt. Every tuning number, colour and city dimension in one place.
// The city is a 5x5 block grid in metres; the renderer fits it to the window, so no rule
// below depends on the screen size. All names, places and people are invented for this game.

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate.
 * The loop in main.js caps catch-up at 8 steps a frame, so a long stall drops time
 * instead of replaying it — the step count and that cap belong together. */
export const STEP = 1 / 60;

/** The story hook the HUD and title screen show. Phase 1: collect cash drops to pay it down. */
export const STORY = {
  title: 'VELMORA',
  subtitle: 'STREET DEBT',
  hero: 'Rook Marlowe',
  debt: 50000,
  dropValue: 250,
  intro: 'Rook owes the Harbormaster fifty grand. The drops are out there — collect them.',
};

/** Cars: arcade driving on a fixed step — accelerate, brake, reverse, speed-scaled steering. */
export const CAR = {
  length: 4.2,
  width: 1.9,
  radius: 1.7,
  wheelbase: 2.6,
  accel: 15,
  brake: 26,
  reverseAccel: 9,
  maxSpeed: 33,
  maxReverse: 9,
  drag: 0.32,
  maxSteer: 0.55,
  steerSpeedFalloff: 0.045,
  grip: 6,
  enterRadius: 3.2,
  parkedCount: 8,
  maxHp: 100,
  smokeBelow: 35,
  // colors[2] is the gold of the marked coupe: missions.js repaints the getaway
  // target to this index, so the colour and that assignment must stay in sync.
  colors: ['#b03a2e', '#2e6fb0', '#d8a13c', '#3f8f5f', '#7a5a9e', '#c8ccd4', '#22252b', '#b06a2e'],
};

/** Traffic: AI cars on the road centrelines, right-hand lanes, turning at intersections. */
export const TRAFFIC = {
  count: 9,
  cruiseSpeed: 9,
  maxSpeed: 12,
  followGap: 9,
  laneOffset: 3.5,
};

/** Pedestrians: sidewalk wanderers who flee a fast car and get knocked by one. */
export const PED = {
  count: 10,
  walkSpeed: 1.6, // a stroll; fleeSpeed below is the run when a car bears down
  fleeSpeed: 5.5,
  fleeRadius: 7,
  hitSpeed: 4, // a car slower than this only makes walkers flinch, never knocks one down
};

/** Police: foot cops at low heat, police cars at 3+ stars, busted when caught. */
export const POLICE = {
  footSpeed: 7.6,
  catchRadius: 1.4,
  carSpeed: 26,
  carRamDamage: 8,
  carRamCooldown: 1,
  carHitDamage: 15,
  spawnDistance: 42,
  maxFootCops: 2,
  maxCars: 3,
  sightRange: 60,
  decayDelay: 12,
  // The helicopter: circles over Rook at 4+ stars, its searchlight on him. It
  // spots him like a cop on the ground, so the heat does not decay while it is
  // overhead — four stars is a manhunt, not a misunderstanding.
  heliSpeed: 16,
  heliHeight: 30,
  heliOrbit: 20,
  heliSpotRadius: 6,
};

/** Wanted: 0-5 stars; crimes add heat, hiding sheds it one star at a time. */
export const WANTED = {
  max: 5,
  steal: 1,
  hitPed: 1,
  // The getaway's heat: stealing the marked coupe puts three stars on Rook at once.
  // The mission's intro text says the same number — keep the two in sync.
  evadeStars: 3,
};

/** Missions: the first job — collect $1,500 of drops, then return to the plaza. */
export const MISSION = {
  firstTarget: 1500,
  returnRadius: 7,
};

/** City layout: 5x5 blocks, 36 m blocks, 14 m streets. Half-extent is the playable bound. */
export const CITY = {
  blocks: 5,
  blockSize: 36,
  streetWidth: 14,
  get pitch() {
    return this.blockSize + this.streetWidth;
  },
  get halfExtent() {
    return ((this.blocks - 1) / 2) * this.pitch + this.blockSize / 2 + this.streetWidth / 2;
  },
  minHeight: 10,
  maxHeight: 42,
  plazaFountainRadius: 4,
};

/** Player on foot: walk and sprint speeds, turning, collision radius, health. */
export const PLAYER = {
  radius: 0.55,
  height: 1.8,
  walkSpeed: 6,
  sprintSpeed: 10.5,
  acceleration: 42,
  friction: 11,
  turnRate: 12,
  maxHealth: 100,
  // Body armor from the shop: damage eats armor first, then health. Caps at 100.
  armorMax: 100,
};

/** Cash drops: how many are live, how far away one is collected, respawn delay. */
export const PICKUP = {
  count: 12,
  value: 250,
  collectRadius: 1.7,
  respawnDelay: 8,
  bobHeight: 0.9,
};

/** Third-person camera: distance, height, orbit limits, collision padding. */
export const CAMERA = {
  distance: 7.5,
  height: 2.4,
  minPitch: -0.12,
  maxPitch: 0.55,
  lookSpeed: 0.0026,
  collisionPadding: 0.5,
  shakeDecay: 1.4,
};

/** The sun is late afternoon: warm, low, long shadows across the avenues. */
export const SUN = {
  color: '#ffd9a8',
  intensity: 2.6,
  position: [130, 150, 70],
  shadowSize: 2048,
  shadowExtent: 150,
};

export const SKY = {
  top: '#2e5f8a',
  horizon: '#f2b880',
  fog: '#e8b98a',
  fogNear: 190,
  fogFar: 430,
};

export const PALETTE = {
  asphalt: '#3b3f46',
  sidewalk: '#9a9da3',
  plazaStone: '#b09a7a',
  buildingRoof: '#2c2f36',
  lampGlow: '#ffd9a0',
  cash: '#37d67a',
  cashBand: '#f2c94c',
  health: '#4ade80',
  healthLow: '#e5534b',
  wanted: '#ffd166',
  text: '#f2f4f7',
  muted: '#c8ccd4',
  panel: 'rgba(12, 16, 24, 0.82)',
  accent: '#ffb347',
};

/** Where the best cash haul is kept between visits (this browser only). */
export const BEST_KEY = 'velmora.best.cash';

/** Combat: F punches on foot, G fires the pistol (hit-scan, limited ammo). */
export const COMBAT = {
  punchRange: 2.3,
  punchArc: 1.9, // the auto-face window, a half-angle in radians: a hostile inside it gets faced and hit
  punchCooldown: 0.45,
  punchDamage: 1,
  punchKnockback: 1.8,
  fireRange: 28,
  fireArc: 0.12, // the shot cone, a half-angle in radians: cos of it is the aim test in combat.js
  fireCooldown: 0.3,
  fireDamage: 1,
  pistolAmmo: 12,
  pistolAt: { x: 14, z: 14 },
  pistolRadius: 1.7,
  // The shotgun: a spread gun bought at Iron & Ammo. Five pellets in a wide cone,
  // each pellet a hit of its own — up close it drops a cop in one pull, at range it
  // is a loud way to miss. Slow to pump, and the shells only come from the shop.
  shotgunRange: 18,
  shotgunArc: 0.32, // wide cone, a half-angle in radians: every hostile inside it takes pellets
  shotgunCooldown: 0.9,
  shotgunPelletDamage: 2,
  shotgunShellsPerBuy: 6,
};

/** Radio: three synthesized stations, no audio files — chords, wave and pace each. */
export const RADIO = [
  {
    name: 'VELMORA FM',
    chords: [[110.0, 130.81, 164.81], [87.31, 110.0, 130.81], [130.81, 164.81, 196.0], [98.0, 123.47, 146.83]],
    seconds: 2.4,
    wave: 'triangle',
    vol: 0.05,
  },
  {
    name: 'NIGHT DRIVE',
    chords: [[146.83, 174.61, 220.0], [116.54, 146.83, 174.61], [130.81, 164.81, 196.0], [98.0, 146.83, 196.0]],
    seconds: 1.8,
    wave: 'square',
    vol: 0.025,
  },
  {
    name: 'HARBOUR JAZZ',
    chords: [[130.81, 164.81, 196.0, 246.94], [110.0, 130.81, 164.81, 196.0], [146.83, 174.61, 220.0, 261.63], [98.0, 123.47, 146.83, 174.61]],
    seconds: 3.4,
    wave: 'sine',
    vol: 0.06,
  },
];

/** Shops: three storefronts on street corners, each selling the same shelf. */
export const SHOPS = [
  { id: 'meds', name: "DOC'S MEDS", x: 25, z: 25, awning: '#37d67a' },
  { id: 'ammo', name: 'IRON & AMMO', x: -75, z: 25, awning: '#e5534b' },
  { id: 'general', name: 'HARBOR GENERAL', x: 25, z: -75, awning: '#f2c94c' },
];

/** What a shop sells: price in collected cash, and what it does. */
export const SHOP_ITEMS = [
  { key: '1', id: 'health', label: 'Medkit — full health', price: 150 },
  { key: '2', id: 'armor', label: 'Body armor +50', price: 300 },
  { key: '3', id: 'ammo', label: 'Pistol ammo +12', price: 100 },
  { key: '4', id: 'shotgun', label: 'Shotgun (6 shells)', price: 800 },
  { key: '5', id: 'shells', label: 'Shotgun shells +6', price: 120 },
];

/** Mission 4, the smuggling run: pay on completion, and the timer's pace. */
export const MISSION4 = {
  payout: 6000,
  timePerMetre: 1 / 12,
  timeBase: 20,
};

/** Mission 5, the chop shop: pay on completion, and the radius of the drop-off. */
export const MISSION5 = {
  payout: 7000,
  hideoutRadius: 5,
};

/** Mission 6, the last haul: pay on completion, and how many drops it takes. */
export const MISSION6 = {
  payout: 8000,
  drops: 8,
};

/** Enforcers: the Harbormaster's collectors, sent after Rook during the getaway. */
export const ENFORCER = {
  count: 3,
  speed: 6.5,
  health: 3,
  attackRange: 1.6,
  attackDamage: 8,
  attackCooldown: 1.0,
  downTime: 20,
  spawnDistance: 25,
};

/** Mission 2, the timed delivery: pay on completion, and the law's patience with speed. */
export const MISSION2 = {
  payout: 2500,
  pickupRadius: 3,
  deliverRadius: 4,
  // The timer is the drive at a brisk 11 m/s (about 40 km/h) plus a margin.
  timePerMetre: 1 / 11,
  timeBase: 25,
  speedLimit: 22,
  redZoneSpeedLimit: 18,
  redZoneRadius: 14,
  heatSeconds: 6,
};

/** Mission 3, the getaway: pay on completion, and the radius of the hideout. */
export const MISSION3 = {
  payout: 5000,
  hideoutRadius: 5,
};

/** Red zones: the two busiest crossings by the plaza — speeding there draws the law fast. */
export const RED_ZONES = [
  { x: 25, z: 25, r: 14 },
  { x: -25, z: -25, r: 14 },
];

/** Save: one versioned slot in localStorage, autosaved on mission complete. */
export const SAVE_KEY = 'velmora.save.v1';
export const SAVE_VERSION = 1;

/** Day cycle: the light drifts over four minutes of play, late afternoon toward dusk. */
export const DAY = {
  period: 240,
};
