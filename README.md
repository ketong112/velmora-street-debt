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
- **Wanted level and police** — 0 to 5 stars. Foot cops at 1–2 stars, police cars at 3+ that pursue on the grid and ram. Lose sight of them for 12 seconds and a star drops off. At 0 HP you're BUSTED.
- **Missions and a story** — three jobs that pay the debt down: collect $1,500 of drops and return to the plaza, a timed parcel delivery, and a getaway in a gold coupe. Debt arc: $50,000 → $41,000.
- **Combat** — punch (F) with auto-face assist, pistol (G, 12 rounds) once you earn it, and enforcers who chase and punch back.
- **HUD with minimap** — cash, debt, HP, wanted stars, mission objective with a direction arrow, mission timer, and a live minimap with a beacon.
- **Save system** — versioned autosave (cash, missions done, best score, pistol/ammo) in localStorage; BUSTED retries from the autosave.
- **Sound, synthesized** — engine hum that follows your speed, sirens, pickup chimes, punch thuds, gunshots and a title music loop. WebAudio only, no audio files. M mutes.

## Controls

- **W A S D** move / drive · **Mouse** look · **Shift** sprint
- **E** steal / exit car · **F** punch · **G** fire · **M** mute · **P** or **Esc** pause

---

<sub>Entered on [make.fun](https://make.fun/?ref=dmgw15y1&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
