// The safehouse: Rook's own place in Port Velmora. One job: a door the player
// can own, enter, and hide in. Buy it once with collected cash; after that,
// walking up and pressing E steps inside — health comes back, the game autosaves,
// and the police lose the scent: no line of sight reaches through its walls, so
// the heat decays while Rook rests. E again steps back out onto the street.
// Nothing here touches the DOM or the network — plain state in, plain result out.

import { PLAYER, POLICE, SAFEHOUSE } from './config.js';

/** The safehouse state for a fresh world: for sale, nobody inside. */
export function createSafehouse() {
  return {
    owned: false,
    inside: false,
    visits: 0, // nights rested, for the ledger
  };
}

/** True when Rook stands close enough to the door to use it, on foot. */
export function nearSafehouse(safehouse, x, z) {
  const dx = SAFEHOUSE.x - x;
  const dz = SAFEHOUSE.z - z;
  return dx * dx + dz * dz < SAFEHOUSE.doorRadius * SAFEHOUSE.doorRadius;
}

/**
 * E at the door. Returns { ok, text } — ok when the press did something, text
 * the line the HUD should toast. Buying takes the cash and opens the door in
 * the same press; entering heals over time (world.js) and counts a visit.
 */
export function useSafehouse(state) {
  const safehouse = state.safehouse;
  if (safehouse.inside) {
    safehouse.inside = false;
    return { ok: true, text: 'Back on the street — the safehouse keeps.' };
  }
  if (!safehouse.owned) {
    if (state.cash < SAFEHOUSE.price) {
      return {
        ok: false,
        text: `Rook's place is for sale — $${SAFEHOUSE.price.toLocaleString('en-US')}. You have $${state.cash.toLocaleString('en-US')}.`,
      };
    }
    state.cash -= SAFEHOUSE.price;
    state.ledger.spent += SAFEHOUSE.price;
    safehouse.owned = true;
    safehouse.inside = true;
    safehouse.visits += 1;
    state.ledger.safehouseVisits += 1;
    return { ok: true, text: `You bought ${SAFEHOUSE.name} — $${SAFEHOUSE.price.toLocaleString('en-US')}. Home at last. Rest up, the game is saved.` };
  }
  safehouse.inside = true;
  safehouse.visits += 1;
  state.ledger.safehouseVisits += 1;
  return { ok: true, text: 'Inside — safe. Health coming back, game saved.' };
}

/**
 * One fixed step while Rook rests inside: health returns, and the heat decays —
 * the police cannot see through the walls, so the unseen timer runs even at
 * four stars. Returns true when a star dropped off this step.
 */
export function stepSafehouse(state, dt) {
  const player = state.player;
  player.health = Math.min(PLAYER.maxHealth, player.health + SAFEHOUSE.healPerSecond * dt);
  state.police.unseenTimer += dt;
  if (state.police.unseenTimer >= POLICE.decayDelay && state.wanted > 0) {
    state.wanted -= 1;
    state.police.unseenTimer = 0;
    return true;
  }
  return false;
}

/** The line the HUD prompt shows at the door: for sale, or home. Silent away from the door. */
export function safehousePrompt(state) {
  const safehouse = state.safehouse;
  if (safehouse.inside) return '';
  if (!nearSafehouse(safehouse, state.player.x, state.player.z)) return '';
  if (!safehouse.owned) {
    return `🏠 ${SAFEHOUSE.name} — for sale $${SAFEHOUSE.price.toLocaleString('en-US')} · [E] Buy`;
  }
  return `🏠 ${SAFEHOUSE.name} — home · [E] Rest inside (heal + save)`;
}

/** Plain-data snapshot for the save: owned, and how many nights rested. */
export function captureSafehouse(safehouse) {
  return { owned: safehouse.owned === true, visits: Math.max(0, Math.floor(safehouse.visits)) };
}

/** Rebuild from save data: a round-2 save has neither field, so it defaults to for sale. */
export function readSafehouse(data) {
  if (!data || typeof data !== 'object') return createSafehouse();
  return {
    owned: data.owned === true,
    inside: false, // never wake up inside: Rook always steps out onto the street
    visits: typeof data.visits === 'number' && Number.isFinite(data.visits)
      ? Math.max(0, Math.floor(data.visits))
      : 0,
  };
}
