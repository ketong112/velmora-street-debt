// Shops: three storefronts on street corners, one shelf each. Walk up on foot and
// press 1-9 to buy with collected cash: a medkit, body armor, pistol ammo, the
// shotgun itself, or shells for it — and the two new guns, the SMG and the rifle,
// with their magazines. The world calls tryBuy when a digit is pressed near a
// shop; the HUD shows the shelf while Rook stands close. Nothing here touches
// the DOM or the network — plain state in, plain result out.

import { COMBAT, PLAYER, SHOP_ITEMS, SHOPS, WEAPONS } from './config.js';

// How close Rook must stand to a shop to buy from it.
const SHOP_RADIUS = 4;

/** The shop list for a fresh world: the three storefronts from config, as state. */
export function createShops() {
  return SHOPS.map((shop) => ({ ...shop }));
}

/** The nearest shop within buying range of (x, z), or null. */
export function nearestShop(shops, x, z) {
  let best = null;
  let bestD = SHOP_RADIUS * SHOP_RADIUS;
  for (const shop of shops) {
    const dx = shop.x - x;
    const dz = shop.z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = shop;
    }
  }
  return best;
}

/**
 * Buy shelf item `key` ('1'-'9') at `shop`. Returns { ok, text } — ok when the
 * cash covered it and the item applied, text the line the HUD should toast.
 * A purchase that cannot apply (no pistol for its ammo, no shotgun for its
 * shells, a shotgun already owned, full health, full armor) is refused without
 * taking any cash, and says why.
 */
export function buyItem(state, shop, key) {
  const item = SHOP_ITEMS.find((entry) => entry.key === key);
  if (!item) return { ok: false, text: 'No such item on the shelf.' };
  const player = state.player;
  const combat = state.combat;
  if (item.id === 'health' && player.health >= PLAYER.maxHealth) {
    return { ok: false, text: 'Already at full health.' };
  }
  if (item.id === 'armor' && player.armor >= PLAYER.armorMax) {
    return { ok: false, text: 'Armor is already full.' };
  }
  if (item.id === 'ammo' && !combat.hasPistol) {
    return { ok: false, text: 'No pistol yet — the ammo has nothing to feed.' };
  }
  if (item.id === 'shotgun' && combat.hasShotgun) {
    return { ok: false, text: 'You already own the shotgun.' };
  }
  if (item.id === 'shells' && !combat.hasShotgun) {
    return { ok: false, text: 'No shotgun yet — buy the gun first.' };
  }
  if (item.id === 'smg' && combat.hasSmg) {
    return { ok: false, text: 'You already own the SMG.' };
  }
  if (item.id === 'smgAmmo' && !combat.hasSmg) {
    return { ok: false, text: 'No SMG yet — buy the gun first.' };
  }
  if (item.id === 'rifle' && combat.hasRifle) {
    return { ok: false, text: 'You already own the rifle.' };
  }
  if (item.id === 'rifleAmmo' && !combat.hasRifle) {
    return { ok: false, text: 'No rifle yet — buy the gun first.' };
  }
  if (state.cash < item.price) {
    return { ok: false, text: `Need $${item.price} — you have $${state.cash}.` };
  }
  state.cash -= item.price;
  if (state.ledger) state.ledger.spent += item.price;
  if (item.id === 'health') player.health = PLAYER.maxHealth;
  else if (item.id === 'armor') player.armor = Math.min(PLAYER.armorMax, player.armor + 50);
  else if (item.id === 'ammo') combat.ammo += 12;
  else if (item.id === 'shotgun') {
    combat.hasShotgun = true;
    combat.shells += COMBAT.shotgunShellsPerBuy;
    combat.weapon = 'shotgun';
  } else if (item.id === 'shells') combat.shells += COMBAT.shotgunShellsPerBuy;
  else if (item.id === 'smg') {
    combat.hasSmg = true;
    combat.smgAmmo += WEAPONS.smg.magSize;
    combat.weapon = 'smg';
  } else if (item.id === 'smgAmmo') combat.smgAmmo += WEAPONS.smg.magSize;
  else if (item.id === 'rifle') {
    combat.hasRifle = true;
    combat.rifleAmmo += WEAPONS.rifle.magSize;
    combat.weapon = 'rifle';
  } else if (item.id === 'rifleAmmo') combat.rifleAmmo += WEAPONS.rifle.magSize;
  return { ok: true, text: `Bought ${item.label} — $${item.price}.` };
}
