// The world ledger: one running account of Rook's life in Port Velmora — what he
// earned, what he spent, what he owns, and what the debt really is. The debt is
// paid by EARNING, not by holding cash: a medkit does not put the debt back up.
// Everything here is plain numbers, so the save can carry it whole, and the
// safehouse panel and the HUD read straight off it. No drawing, no browser —
// world.js feeds it, save.js keeps it.

import { STORY } from './config.js';

/** A fresh ledger: nothing earned, nothing spent, nothing owned. */
export function createLedger() {
  return {
    earned: 0, // every dollar that ever came in: drops + mission payouts
    spent: 0, // every dollar that ever went out: shops + garage + the safehouse
    drops: 0, // cash drops collected, all time
    carsStolen: 0, // cars taken, all time
    copsDowned: 0, // foot cops put down, all time
    enforcersDowned: 0, // enforcers put down, all time
    shotsFired: 0, // rounds fired, all time
    safehouseVisits: 0, // nights rested at Rook's place
    garageUpgrades: 0, // engine/armor/paint jobs bought
    missionsDone: 0, // jobs finished, all time
  };
}

/** What Rook still owes: the fifty grand minus everything he ever earned. */
export function debtLeft(ledger) {
  return Math.max(0, STORY.debt - ledger.earned);
}

/** True when the debt is gone: the ledger, not the wallet, says so. */
export function debtPaid(ledger) {
  return ledger.earned >= STORY.debt;
}

/** Plain-data snapshot for the save: numbers only, nothing to validate beyond that. */
export function captureLedger(ledger) {
  return {
    earned: Math.max(0, Math.floor(ledger.earned)),
    spent: Math.max(0, Math.floor(ledger.spent)),
    drops: Math.max(0, Math.floor(ledger.drops)),
    carsStolen: Math.max(0, Math.floor(ledger.carsStolen)),
    copsDowned: Math.max(0, Math.floor(ledger.copsDowned)),
    enforcersDowned: Math.max(0, Math.floor(ledger.enforcersDowned)),
    shotsFired: Math.max(0, Math.floor(ledger.shotsFired)),
    safehouseVisits: Math.max(0, Math.floor(ledger.safehouseVisits)),
    garageUpgrades: Math.max(0, Math.floor(ledger.garageUpgrades)),
    missionsDone: Math.max(0, Math.floor(ledger.missionsDone)),
  };
}

/**
 * Rebuild a ledger from save data: every field defaults to 0 when the save
 * predates it (a round-2 save has none of these), so an old save loads clean.
 * A hand-edited save with a negative or non-number field clamps to 0.
 */
export function readLedger(data) {
  const ledger = createLedger();
  if (!data || typeof data !== 'object') return ledger;
  for (const key of Object.keys(ledger)) {
    const value = data[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      ledger[key] = Math.max(0, Math.floor(value));
    }
  }
  return ledger;
}

/** One line the HUD and the safehouse panel share: earned, spent, debt left. */
export function ledgerLine(ledger) {
  const money = (n) => '$' + n.toLocaleString('en-US');
  return `Earned ${money(ledger.earned)} · Spent ${money(ledger.spent)} · Debt ${money(debtLeft(ledger))} left`;
}

/** One line for the safehouse panel: what Rook owns and has done. */
export function ledgerOwnsLine(ledger, safehouseOwned) {
  const owns = safehouseOwned ? "ROOK'S PLACE" : 'nothing yet';
  return `Owns: ${owns} · Cars stolen: ${ledger.carsStolen} · Upgrades: ${ledger.garageUpgrades} · Jobs done: ${ledger.missionsDone}`;
}
