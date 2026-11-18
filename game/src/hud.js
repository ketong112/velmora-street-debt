// The HUD: cash, health, wanted stars, a live minimap and toast messages. It lives in the
// DOM (not the WebGL canvas) so text stays crisp at any size, and it is event-driven — a
// value is written to the page only when it actually changes. The minimap is the one thing
// redrawn every frame: a 180x180 canvas is cheap, and Rook never stops moving.

import { CITY, COMBAT, PLAYER, RADIO, SHOP_ITEMS, STORY } from './config.js';
import { currentMission, redZonesActive } from './missions.js';
import { nearestShop } from './shops.js';

const MAP_SIZE = 180;

// Minimap dots: cash drops are small green circles, police cars flash at this rate.
const PICKUP_DOT = 2.5;
const POLICE_DOT = 3;
const CAR_DOT = 3; // parked and traffic cars: small grey squares, this many pixels a side
const FLASH_RATE = 3; // light-bar flips per second

export function createHud() {
  const cashEl = document.getElementById('hud-cash');
  const debtEl = document.getElementById('hud-debt');
  const healthFill = document.getElementById('hud-health-fill');
  const healthText = document.getElementById('hud-health-text');
  const starsEl = document.getElementById('hud-stars');
  const speedEl = document.getElementById('hud-speed');
  const sirenEl = document.getElementById('hud-siren');
  const objectiveEl = document.getElementById('hud-objective');
  const arrowEl = document.getElementById('hud-arrow');
  const ammoEl = document.getElementById('hud-ammo');
  const radioEl = document.getElementById('hud-radio');
  const shopEl = document.getElementById('hud-shop');
  const timerEl = document.getElementById('hud-timer');
  const map = document.getElementById('hud-minimap');
  const toastEl = document.getElementById('hud-toast');
  const mapCtx = map.getContext('2d');

  let lastCash = -1;
  let lastHealth = -1;
  let lastArmor = -1;
  let lastWanted = -1;
  let lastSpeed = -1;
  let lastObjective = '';
  let lastAmmo = '';
  let lastRadio = '';
  let lastShop = '';
  let lastTimer = '';
  let toastTimer = 0;

  function money(n) {
    return '$' + n.toLocaleString('en-US');
  }

  /** A toast line for a few seconds: drop collected, debt reminder, that kind of thing. */
  function toast(message, seconds = 3) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    toastTimer = seconds;
  }

  function drawMinimap(state) {
    const ctx = mapCtx;
    const bounds = state.city.bounds;
    const scale = MAP_SIZE / (bounds * 2);
    const toMap = (x, z) => [(x + bounds) * scale, (z + bounds) * scale];
    ctx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
    ctx.fillStyle = '#10151d';
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
    // Streets: the avenue grid.
    ctx.strokeStyle = '#3d434c';
    ctx.lineWidth = 5;
    for (const s of state.city.streets) {
      const [x] = toMap(s, 0);
      const [, z] = toMap(0, s);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, MAP_SIZE);
      ctx.moveTo(0, z);
      ctx.lineTo(MAP_SIZE, z);
      ctx.stroke();
    }
    // Buildings as blocks, the plaza as a warm square.
    ctx.fillStyle = '#6b7280';
    for (const b of state.city.buildings) {
      const [x, z] = toMap(b.x - b.w / 2, b.z - b.d / 2);
      ctx.fillRect(x, z, Math.max(1.5, b.w * scale), Math.max(1.5, b.d * scale));
    }
    const plazaHalf = CITY.blockSize / 2 + CITY.streetWidth / 2;
    const [px, pz] = toMap(-plazaHalf, -plazaHalf);
    ctx.fillStyle = '#b09a7a';
    ctx.fillRect(px, pz, plazaHalf * 2 * scale, plazaHalf * 2 * scale);
    // Cash drops as green dots.
    ctx.fillStyle = '#37d67a';
    for (const pickup of state.pickups) {
      if (!pickup.active) continue;
      const [x, z] = toMap(pickup.x, pickup.z);
      ctx.beginPath();
      ctx.arc(x, z, PICKUP_DOT, 0, Math.PI * 2);
      ctx.fill();
    }
    // Parked and traffic cars as grey dots, police cars flashing blue/red.
    ctx.fillStyle = '#c8ccd4';
    for (const car of state.cars) {
      const [x, z] = toMap(car.x, car.z);
      ctx.fillRect(x - CAR_DOT / 2, z - CAR_DOT / 2, CAR_DOT, CAR_DOT);
    }
    for (const car of state.traffic) {
      const [x, z] = toMap(car.x, car.z);
      ctx.fillRect(x - CAR_DOT / 2, z - CAR_DOT / 2, CAR_DOT, CAR_DOT);
    }
    const flash = Math.floor(state.elapsed * FLASH_RATE) % 2 === 0;
    ctx.fillStyle = flash ? '#3b82f6' : '#ef4444';
    for (const car of state.police.cars) {
      const [x, z] = toMap(car.x, car.z);
      ctx.beginPath();
      ctx.arc(x, z, POLICE_DOT, 0, Math.PI * 2);
      ctx.fill();
    }
    // The helicopter as a yellow ring: it is the one dot that can see everything.
    if (state.police.heli) {
      const [x, z] = toMap(state.police.heli.x, state.police.heli.z);
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, z, POLICE_DOT + 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Shops as orange squares, so Rook can find the shelf from across town.
    ctx.fillStyle = '#ff9e2c';
    for (const shop of state.shops) {
      const [x, z] = toMap(shop.x, shop.z);
      ctx.fillRect(x - 2.5, z - 2.5, 5, 5);
    }
    // The mission objective as a gold diamond.
    if (state.objective) {
      const [x, z] = toMap(state.objective.x, state.objective.z);
      ctx.fillStyle = '#f2c94c';
      ctx.beginPath();
      ctx.moveTo(x, z - 5);
      ctx.lineTo(x + 4, z);
      ctx.lineTo(x, z + 5);
      ctx.lineTo(x - 4, z);
      ctx.closePath();
      ctx.fill();
    }
    // Red zones, while a delivery is running: speeding inside one draws the law fast.
    const zones = redZonesActive(state.missions);
    if (zones) {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
      ctx.lineWidth = 1;
      for (const zone of zones) {
        const [x, z] = toMap(zone.x, zone.z);
        ctx.beginPath();
        ctx.arc(x, z, zone.r * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    // Enforcers as red dots, the pistol pickup as a gold one.
    ctx.fillStyle = '#ef4444';
    for (const e of state.combat.enforcers) {
      if (e.state === 'down') continue;
      const [x, z] = toMap(e.x, e.z);
      ctx.beginPath();
      ctx.arc(x, z, POLICE_DOT, 0, Math.PI * 2);
      ctx.fill();
    }
    if (state.combat.pistol && !state.combat.pistol.taken) {
      const [x, z] = toMap(state.combat.pistol.x, state.combat.pistol.z);
      ctx.fillStyle = '#f2c94c';
      ctx.beginPath();
      ctx.arc(x, z, POLICE_DOT, 0, Math.PI * 2);
      ctx.fill();
    }
    // Rook: a white arrow that turns with him. The arrow is drawn pointing up
    // (north on the map); heading 0 faces +Z, which is down on the map, hence the PI.
    const [rx, rz] = toMap(state.player.x, state.player.z);
    ctx.save();
    ctx.translate(rx, rz);
    ctx.rotate(Math.PI - state.player.heading); // heading 0 faces +Z, which is down on the map
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.5, 5);
    ctx.lineTo(-4.5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** Refresh the HUD from the world state; call every frame, it writes only what changed. */
  function update(state, dt, camYaw) {
    if (state.cash !== lastCash) {
      lastCash = state.cash;
      cashEl.textContent = money(state.cash);
      cashEl.classList.remove('bump');
      void cashEl.offsetWidth; // restart the bump animation
      cashEl.classList.add('bump');
      debtEl.textContent = `Debt ${money(STORY.debt - state.cash)} left`;
    }
    const health = Math.round(state.player.health);
    const armor = Math.round(state.player.armor);
    if (health !== lastHealth || armor !== lastArmor) {
      lastHealth = health;
      lastArmor = armor;
      healthFill.style.width = `${(health / PLAYER.maxHealth) * 100}%`;
      healthFill.style.background = health < 30 ? '#e5534b' : '#4ade80';
      // Armor rides on the health line: "100 +50" reads at a glance, and the
      // shield only shows while there is armor left to show.
      healthText.textContent = armor > 0 ? `${health} +${armor}🛡` : `${health}`;
    }
    if (state.wanted !== lastWanted) {
      lastWanted = state.wanted;
      starsEl.textContent = '★'.repeat(state.wanted) + '☆'.repeat(5 - state.wanted);
      starsEl.classList.toggle('hot', state.wanted > 0);
      sirenEl.classList.toggle('show', state.wanted > 0);
    }
    // Speed: only behind the wheel, in km/h.
    const speed = state.inCar && state.currentCar ? Math.round(Math.abs(state.currentCar.speed) * 3.6) : 0;
    if (speed !== lastSpeed) {
      lastSpeed = speed;
      speedEl.textContent = state.inCar ? `${speed} km/h` : '';
    }
    // The guns: the one in hand, its rounds, and Q to switch when both are owned.
    let ammo = '';
    if (state.combat.hasPistol || state.combat.hasShotgun) {
      const both = state.combat.hasPistol && state.combat.hasShotgun;
      if (state.combat.weapon === 'shotgun' && state.combat.hasShotgun) {
        ammo = `💥 Shotgun ${state.combat.shells} shells${both ? ' (Q)' : ''}`;
      } else {
        ammo = `🔫 Pistol ${state.combat.ammo} / ${COMBAT.pistolAmmo}${both ? ' (Q)' : ''}`;
      }
    }
    if (ammo !== lastAmmo) {
      lastAmmo = ammo;
      ammoEl.textContent = ammo;
    }
    // The radio: the station R cycles to, or nothing before the loop starts.
    const radio = `📻 ${RADIO[state.radioStation]?.name ?? RADIO[0].name}`;
    if (radio !== lastRadio) {
      lastRadio = radio;
      radioEl.textContent = radio;
    }
    // The shop shelf, while Rook stands at a shop on foot: the whole menu in one
    // line, so the digit to press is right there — 1 medkit, 2 armor, 3 ammo,
    // 4 shotgun, 5 shells. Away from a shop the line is gone.
    const shop = !state.inCar ? nearestShop(state.shops, state.player.x, state.player.z) : null;
    const shopLine = shop
      ? `🏪 ${shop.name} — ${SHOP_ITEMS.map((item) => `[${item.key}] ${item.label} $${item.price}`).join(' · ')}`
      : '';
    if (shopLine !== lastShop) {
      lastShop = shopLine;
      shopEl.textContent = shopLine;
      shopEl.classList.toggle('show', shopLine !== '');
    }
    // The delivery timer: counts down while a parcel — or the contraband — is in
    // hand, red under 10 seconds.
    const mission = currentMission(state.missions);
    const timer = mission && (mission.kind === 'delivery' || mission.kind === 'smuggle') && mission.phase === 'deliver'
      ? `⏱ ${Math.max(0, Math.ceil(mission.timeLeft))}s`
      : '';
    if (timer !== lastTimer) {
      lastTimer = timer;
      timerEl.textContent = timer;
      timerEl.classList.toggle('show', timer !== '');
      timerEl.classList.toggle(
        'urgent',
        mission !== null && (mission.kind === 'delivery' || mission.kind === 'smuggle') && mission.phase === 'deliver' && mission.timeLeft < 10,
      );
    }
    // The objective line and its compass arrow: the arrow turns with the camera.
    const objectiveLabel = state.objective ? state.objective.label : '';
    if (objectiveLabel !== lastObjective) {
      lastObjective = objectiveLabel;
      objectiveEl.textContent = objectiveLabel;
      objectiveEl.classList.toggle('show', objectiveLabel !== '');
    }
    if (state.objective && typeof camYaw === 'number') {
      const dx = state.objective.x - state.player.x;
      const dz = state.objective.z - state.player.z;
      const bearing = Math.atan2(dx, dz); // heading 0 faces +Z, like the player
      // The arrow element points up (north on screen); the +PI turns the bearing,
      // which is measured from +Z (down on the map), into that frame.
      const relative = bearing + camYaw + Math.PI;
      arrowEl.style.transform = `translateX(-50%) rotate(${relative}rad)`;
      arrowEl.classList.add('show');
    } else {
      arrowEl.classList.remove('show');
    }
    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) toastEl.classList.remove('show');
    }
    drawMinimap(state);
  }

  return { update, toast };
}
