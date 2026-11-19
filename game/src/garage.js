// The garage: tune the car parked in its bay — engine, armor, paint. One job:
// the bay, the menu, and what a purchase does to a car. The tuning lives on the
// car by its id, so it survives a reset and a save: the engine changes how the
// car drives (top speed and acceleration), the armor changes how much punishment
// it takes, and the paint changes its colour at a glance. Nothing here touches
// the DOM or the network — plain state in, plain result out.

import { CAR, GARAGE } from './config.js';

/** The garage state for a fresh world: shut, no car in the bay, nothing tuned. */
export function createGarage() {
  return {
    open: false,
    targetCar: null, // the car in the bay, while the menu is open
    tuning: {}, // car id -> { engine, armor, paint }: what was bought, per car
    notice: '', // the last garage result line, for the toast main.js shows
  };
}

/** True when the car sits inside the painted bay in front of the garage door. */
export function carInBay(car) {
  const dx = car.x - GARAGE.bayX;
  const dz = car.z - GARAGE.bayZ;
  return dx * dx + dz * dz < GARAGE.bayRadius * GARAGE.bayRadius;
}

/** The nearest parked car inside the bay, or null when the bay is empty. */
export function nearestBayCar(cars) {
  let best = null;
  let bestD = GARAGE.bayRadius * GARAGE.bayRadius;
  for (const car of cars) {
    if (car.kind !== 'parked') continue;
    const dx = car.x - GARAGE.bayX;
    const dz = car.z - GARAGE.bayZ;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  return best;
}

/** The tuning bought for a car: levels, and the paint it wears. */
export function tuningFor(garage, car) {
  const saved = garage.tuning[car.id];
  if (!saved) return { engine: 0, armor: 0, paint: car.color };
  return {
    engine: saved.engine | 0,
    armor: saved.armor | 0,
    paint: typeof saved.paint === 'number' ? saved.paint : car.color,
  };
}

/** The top speed a tuned car reaches: each engine level adds 12%. */
export function tunedMaxSpeed(car) {
  const engine = car.tuning?.engine ?? 0;
  return CAR.maxSpeed * (1 + GARAGE.engineSpeed * engine);
}

/** The acceleration a tuned car pulls with: each engine level adds 15%. */
export function tunedAccel(car) {
  const engine = car.tuning?.engine ?? 0;
  return CAR.accel * (1 + GARAGE.engineAccel * engine);
}

/** The most HP a tuned car holds: each armor level adds 50. */
export function tunedMaxHp(car) {
  const armor = car.tuning?.armor ?? 0;
  return CAR.maxHp + GARAGE.armorHp * armor;
}

/**
 * Open the menu for `car` (the one in the bay). The menu freezes the world
 * while it is open, so the law cannot bust Rook mid-purchase.
 */
export function openGarage(state, car) {
  state.garage.open = true;
  state.garage.targetCar = car;
  const tuning = tuningFor(state.garage, car);
  return {
    ok: true,
    text: `${GARAGE.name} — tuning car #${car.id + 1}. Engine ${tuning.engine}/${GARAGE.maxLevel}, armor ${tuning.armor}/${GARAGE.maxLevel}.`,
  };
}

/** Shut the menu. The car keeps whatever was bought. */
export function closeGarage(state) {
  state.garage.open = false;
  state.garage.targetCar = null;
  return { ok: true, text: 'Garage closed — the car keeps its tune.' };
}

/**
 * Buy upgrade `key` ('1' engine, '2' armor, '3' paint) for the car in the bay.
 * Returns { ok, text } — ok when the cash covered it and the tune applied, text
 * the line the HUD should toast. A maxed-out level or a short wallet is refused
 * without taking any cash, and says why. The engine and armor levels and the
 * paint are written to the car AND to the garage's record, so a reset and a
 * save both keep them.
 */
export function buyUpgrade(state, key) {
  const garage = state.garage;
  const car = garage.targetCar;
  if (!car) return { ok: false, text: 'No car in the bay to tune.' };
  const tuning = tuningFor(garage, car);
  if (key === '1') {
    if (tuning.engine >= GARAGE.maxLevel) {
      return { ok: false, text: 'Engine is already maxed out.' };
    }
    const price = GARAGE.enginePrices[tuning.engine];
    if (state.cash < price) {
      return { ok: false, text: `Engine level ${tuning.engine + 1} costs $${price.toLocaleString('en-US')} — you have $${state.cash.toLocaleString('en-US')}.` };
    }
    state.cash -= price;
    state.ledger.spent += price;
    state.ledger.garageUpgrades += 1;
    tuning.engine += 1;
    car.tuning = { engine: tuning.engine, armor: tuning.armor };
    garage.tuning[car.id] = { engine: tuning.engine, armor: tuning.armor, paint: car.color };
    return { ok: true, text: `Engine level ${tuning.engine} fitted — faster off the line, higher top speed.` };
  }
  if (key === '2') {
    if (tuning.armor >= GARAGE.maxLevel) {
      return { ok: false, text: 'Armor is already maxed out.' };
    }
    const price = GARAGE.armorPrices[tuning.armor];
    if (state.cash < price) {
      return { ok: false, text: `Armor level ${tuning.armor + 1} costs $${price.toLocaleString('en-US')} — you have $${state.cash.toLocaleString('en-US')}.` };
    }
    state.cash -= price;
    state.ledger.spent += price;
    state.ledger.garageUpgrades += 1;
    tuning.armor += 1;
    car.tuning = { engine: tuning.engine, armor: tuning.armor };
    garage.tuning[car.id] = { engine: tuning.engine, armor: tuning.armor, paint: car.color };
    // Fresh plates: the car is repaired to its new, higher maximum.
    car.hp = tunedMaxHp(car);
    return { ok: true, text: `Armor level ${tuning.armor} fitted — ${car.hp} HP, and the dents are gone.` };
  }
  if (key === '3') {
    const price = GARAGE.paintPrice;
    if (state.cash < price) {
      return { ok: false, text: `A repaint costs $${price} — you have $${state.cash}.` };
    }
    state.cash -= price;
    state.ledger.spent += price;
    state.ledger.garageUpgrades += 1;
    car.color = (car.color + 1) % CAR.colors.length;
    garage.tuning[car.id] = { engine: tuning.engine, armor: tuning.armor, paint: car.color };
    return { ok: true, text: 'Repainted — the car wears a new colour.' };
  }
  return { ok: false, text: 'No such tune on the board.' };
}

/** The menu the HUD draws while the garage is open: the car, its levels, the prices. */
export function garageMenu(state) {
  const garage = state.garage;
  const car = garage.targetCar;
  if (!garage.open || !car) return null;
  const tuning = tuningFor(garage, car);
  const enginePrice = tuning.engine < GARAGE.maxLevel ? GARAGE.enginePrices[tuning.engine] : null;
  const armorPrice = tuning.armor < GARAGE.maxLevel ? GARAGE.armorPrices[tuning.armor] : null;
  return {
    car,
    engine: tuning.engine,
    armor: tuning.armor,
    enginePrice,
    armorPrice,
    paintPrice: GARAGE.paintPrice,
    maxHp: tunedMaxHp(car),
    maxSpeed: Math.round(tunedMaxSpeed(car) * 3.6), // km/h, for the menu line
  };
}

/** The line the HUD prompt shows at the garage door, when a car waits in the bay. Silent away from the door. */
export function garagePrompt(state) {
  if (state.garage.open) return '';
  // On foot at the door, or behind the wheel in the bay — anywhere else, silent.
  const atDoor = (state.player.x - GARAGE.x) ** 2 + (state.player.z - GARAGE.z) ** 2 < GARAGE.doorRadius * GARAGE.doorRadius;
  const inBay = state.inCar && state.currentCar && carInBay(state.currentCar);
  if (!atDoor && !inBay) return '';
  const car = inBay ? state.currentCar : nearestBayCar(state.cars);
  if (!car) return `🔧 ${GARAGE.name} — park a car in the bay to tune it`;
  return `🔧 ${GARAGE.name} — car in the bay · [E] Tune it`;
}

/** Plain-data snapshot for the save: the tuning record, keyed by car id. */
export function captureGarage(garage) {
  const tuning = {};
  for (const [id, t] of Object.entries(garage.tuning)) {
    tuning[id] = {
      engine: Math.max(0, Math.min(GARAGE.maxLevel, t.engine | 0)),
      armor: Math.max(0, Math.min(GARAGE.maxLevel, t.armor | 0)),
      paint: typeof t.paint === 'number' ? t.paint : 0,
    };
  }
  return { tuning };
}

/** Rebuild from save data: a round-2 save has no tuning, so nothing is tuned. */
export function readGarage(data) {
  const garage = createGarage();
  if (data && typeof data === 'object' && data.tuning && typeof data.tuning === 'object') {
    garage.tuning = captureGarage({ tuning: data.tuning }).tuning;
  }
  return garage;
}
