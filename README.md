# VELMORA: Street Debt

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/ketong112/velmora-street-debt/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/ketong112/velmora-street-debt/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

An open-world crime game built for make.fun's [Make GTA 6](https://make.fun/bounty/gta6-01) bounty ($1,666 in USDC). Fully original: the city of Port Velmora, its people, its cars and its story are all our own — nothing from Rockstar or any commercial game.

Rook Marlowe owes the Harbormaster $50,000. The green cash drops are out on the streets of Port Velmora — collect them, stay on your feet, pay it down.

## Play it

```sh
node serve.ts
```

Then open http://localhost:8080 in desktop Chrome. No build step, no network requests at runtime — every script, model and sound is a file in `game/` (three.js is vendored under `game/vendor/`).

## What's in the game

- **A city to explore on foot and by car** — a seeded 5×5 block grid with buildings, a plaza, streets, crosswalks and props.
- **Cars to steal and drive** — 8 parked cars with arcade physics; stealing one raises your wanted level.
- **Traffic and pedestrians** — AI cars drive the grid and yield; walkers stroll the sidewalks and flee when you come at them.
- **Wanted level and police** — 0 to 5 stars. Foot cops at 1–2 stars, police cars at 3+ that pursue on the grid and ram. At 4+ stars a police helicopter circles overhead with its searchlight on you — it watches from the sky, so the heat never decays while it's up. Cops need line of sight to stay on you: break it — hide behind a building, put distance between you — and the heat drops; the HUD says whether you're spotted or hidden. At 0 HP you're BUSTED.
- **Missions and a story** — ten jobs that pay the debt down: collect $1,500 of drops and return to the plaza, a timed parcel delivery, a getaway in a gold coupe, a timed cross-town smuggling run, a chop-shop steal of a violet coupe, a final haul of 8 drops under two stars of heat, a three-door courier run on one clock, a four-checkpoint harbor race, a five-wave stand at the safehouse, and the final payment — 10 drops under three stars, carried to the docks. Debt arc: $50,000 → $0.
- **Combat** — punch (F) with auto-face assist, pistol (G, 12 rounds) once you earn it, the shotgun (spread pellets, slow pump, shells bought at the shops), the SMG (near-automatic spray, 30-round mags) and the rifle (one hard shot from across the plaza, 8-round mags) — Q cycles the guns you own. Enforcers chase and punch back. Body armor from the shops absorbs damage before your health does.
- **Shops** — three storefronts (Doc's Meds, Iron & Ammo, Harbor General) on street corners. Walk up and press 1–9: medkit ($150), armor ($300), pistol ammo ($100), shotgun ($800), shells ($120), SMG ($600), SMG rounds ($150), rifle ($1,200), rifle rounds ($200). The shelf shows on the HUD while you stand close, and the shops are orange squares on the minimap.
- **Safehouse** — ROOK'S PLACE, a house at the north-west corner for $2,000: step inside to heal, autosave and count a visit; the police can't see through its walls, so the heat decays even at four stars. A green diamond marks it on the map and in the world.
- **Garage** — VELMORA GARAGE at the south-east corner: park a car in the yellow bay and press E to tune it — engine (3 levels, faster top speed and acceleration, spoiler appears at level 1), armor (3 levels, +50 max car HP each), paint ($400, cycles the colour). Tuning is saved per car and survives a reload. A blue diamond marks it.
- **Ledger** — a running record on the HUD: what Rook earned, what he spent, and the debt left, paid down by earning rather than by holding cash. It persists in the save, along with the safehouse, the garage tuning and the two new guns.
- **Radio** — three synthesized WebAudio stations (R to cycle): Velmora FM, Night Drive, Harbour Jazz. The current station shows on the HUD; on the title screen it's the title music, in play it's the car radio.
- **HUD with minimap** — cash, debt, ledger line, HP + armor, wanted stars, spotted/hidden siren line, mission objective with a direction arrow, mission timer, radio station, shop shelf, safehouse and garage prompts and panels, and a live minimap with a beacon, police dots, the helicopter ring, shop squares, the safehouse and the garage.
- **Save system** — versioned autosave (cash, missions done, best score, pistol/ammo, shotgun/shells, SMG/rifle, armor, ledger, safehouse, garage tuning) in localStorage; autosaves on mission complete and on stepping into the safehouse; BUSTED retries from the autosave.
- **Sound, synthesized** — engine hum that follows your speed, sirens, pickup chimes, punch thuds, gunshots, a shotgun boom and a title music loop. WebAudio only, no audio files. M mutes.

## Controls

- **W A S D** move / drive · **Mouse** look · **Shift** sprint
- **E** steal / exit car, safehouse & garage · **F** punch · **G** fire · **Q** switch gun (pistol / shotgun / SMG / rifle)
- **R** radio station · **1–9** buy at a shop · **1–3** tune at the garage · **M** mute · **P** or **Esc** pause (closes the garage menu)

---

<sub>Entered on [make.fun](https://make.fun/?ref=dmgw15y1&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
