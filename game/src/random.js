// A small seeded random number generator (mulberry32): the same seed gives the same game,
// which is what makes the screenshot scenes repeatable. The seed is coerced to a 32-bit
// integer, so any integer seed works, including 0.

export function createRandom(seed) {
  // The state is the seed itself, advanced by the golden-ratio constant each draw;
  // the scramble below (xorshift-multiply) spreads one bit of state change widely.
  let state = seed | 0;
  return function random() {
    state = (state + GOLDEN_STEP) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// mulberry32's step: the golden-ratio constant 2^32 / phi, the value that makes
// successive states spread evenly instead of clustering.
const GOLDEN_STEP = 0x6d2b79f5;

/**
 * An integer in [0, max): the one place that turns a 0..1 draw into a count or an index.
 * A non-positive max has no valid index, so it returns 0 instead of a negative count.
 */
export function randomInt(random, max) {
  if (max <= 0) return 0;
  return Math.floor(random() * max);
}
