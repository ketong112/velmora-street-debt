// Drawing only: the three.js scene for Port Velmora — sky, late-afternoon sun with
// shadows, fog, the procedural city from city.js, street props, cash drops and Rook.
// The camera is third-person orbit in play and a slow orbit over the plaza on the title
// screen; a fixed camera serves the ?shot= screenshot scenes. No network, no imported
// models: every texture is painted on a canvas in code, every mesh built from boxes.

import * as THREE from 'three';
import { CAMERA, CAR, CITY, DAY, ENFORCER, GARAGE, PALETTE, PED, SAFEHOUSE, SKY, SUN } from './config.js';
import { FACADES } from './city.js';
import { createPlayerMesh, playerPickupPop, updatePlayerMesh } from './player.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';

// The muzzle flash lives this long — the same 0.09 s combat.js sets muzzle to.
// Keep the two in sync or the flash outlives (or never fills) the shot.
const MUZZLE_SECONDS = 0.09;
// The tone-mapping exposure at midday, and how much dusk dims it.
const EXPOSURE_BASE = 1.18;
const EXPOSURE_DUSK_DROP = 0.12;
// The police light bar flips this many times a second.
const LIGHT_FLASH_RATE = 4;

/** Paint a facade texture: base colour, a lit/unlit window grid, darker toward the street. */
function makeFacadeTexture(facade, random) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = facade.base;
  ctx.fillRect(0, 0, 128, 256);
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255,255,255,0.08)');
  grad.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 256);
  const cols = 4;
  const rows = 8;
  const ww = 20;
  const wh = 18;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x = 8 + c * 30;
      const y = 10 + r * 30;
      ctx.fillStyle = random() < facade.windows ? facade.lit : '#232a36';
      ctx.fillRect(x, y, ww, wh);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x, y, ww, 3);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** Soft radial glow for cash drops, painted on a canvas — no image file needed. */
function makeGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(120,255,170,0.85)');
  grad.addColorStop(0.5, 'rgba(55,214,122,0.28)');
  grad.addColorStop(1, 'rgba(55,214,122,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Paint a shop sign: the shop's name in gold on a dark board, no image file needed. */
function makeShopSignTexture(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#17191d';
  ctx.fillRect(0, 0, 256, 64);
  ctx.strokeStyle = '#f2c94c';
  ctx.lineWidth = 4;
  ctx.strokeRect(3, 3, 250, 58);
  ctx.fillStyle = '#f2c94c';
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 128, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Warm radial glow for the muzzle flash: white-hot centre, orange edge. The
 * cash-drop glow above is green, and a green flash reads as a pickup, not a
 * gunshot — so the flash gets its own texture. */
function makeFlashTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,244,214,0.95)');
  grad.addColorStop(0.5, 'rgba(255,190,90,0.4)');
  grad.addColorStop(1, 'rgba(255,150,40,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
function makeSmokeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(200,200,200,0.75)');
  grad.addColorStop(0.5, 'rgba(160,160,160,0.35)');
  grad.addColorStop(1, 'rgba(160,160,160,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Gradient sky dome with a soft sun glow toward the sun's direction. */
function makeSky(sunDir) {
  const geometry = new THREE.SphereGeometry(700, 24, 16);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(SKY.top) },
      horizon: { value: new THREE.Color(SKY.horizon) },
      sunDir: { value: sunDir.clone().normalize() },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 top;
      uniform vec3 horizon;
      uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 col = mix(horizon, top, pow(h, 0.55));
        float sun = pow(max(dot(vDir, sunDir), 0.0), 90.0);
        col += vec3(1.0, 0.75, 0.45) * sun * 0.9;
        float glow = pow(max(dot(vDir, sunDir), 0.0), 6.0);
        col += vec3(1.0, 0.6, 0.3) * glow * 0.18;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  return new THREE.Mesh(geometry, material);
}

export function createRenderer(canvas, random) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = EXPOSURE_BASE;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(new THREE.Color(SKY.fog), SKY.fogNear, SKY.fogFar);

  const sunDir = new THREE.Vector3(...SUN.position);
  const skyMesh = makeSky(sunDir);
  scene.add(skyMesh);

  const sun = new THREE.DirectionalLight(new THREE.Color(SUN.color), SUN.intensity);
  sun.position.copy(sunDir);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SUN.shadowSize, SUN.shadowSize);
  sun.shadow.camera.left = -SUN.shadowExtent;
  sun.shadow.camera.right = SUN.shadowExtent;
  sun.shadow.camera.top = SUN.shadowExtent;
  sun.shadow.camera.bottom = -SUN.shadowExtent;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 500;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0xbcd6ff, 0x5a4a3a, 0.95);
  scene.add(hemi);

  // Cool bounce from the opposite sky: lifts the faces the sun never reaches.
  const bounce = new THREE.DirectionalLight(0x8fb0d8, 0.55);
  bounce.position.set(-90, 70, -60);
  scene.add(bounce);

  // Shared materials and geometries: one per kind, reused by every mesh of that kind.
  const asphaltMat = new THREE.MeshStandardMaterial({ color: PALETTE.asphalt, roughness: 0.95 });
  const sidewalkMat = new THREE.MeshStandardMaterial({ color: PALETTE.sidewalk, roughness: 0.9 });
  const plazaMat = new THREE.MeshStandardMaterial({ color: PALETTE.plazaStone, roughness: 0.85 });
  const roofMat = new THREE.MeshStandardMaterial({ color: PALETTE.buildingRoof, roughness: 0.9 });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#17191d', roughness: 1 });
  const stoneMat = new THREE.MeshStandardMaterial({ color: '#9a938a', roughness: 0.85 });
  const waterMat = new THREE.MeshStandardMaterial({
    color: '#3f8fbf', roughness: 0.15, metalness: 0.1, emissive: '#0e3a55', emissiveIntensity: 0.4,
  });
  const lampPoleMat = new THREE.MeshStandardMaterial({ color: '#22252b', roughness: 0.6, metalness: 0.6 });
  const lampHeadMat = new THREE.MeshStandardMaterial({
    color: '#fff2cf', emissive: PALETTE.lampGlow, emissiveIntensity: 1.6, roughness: 0.4,
  });
  const hydrantMat = new THREE.MeshStandardMaterial({ color: '#c0392b', roughness: 0.6 });
  const benchMat = new THREE.MeshStandardMaterial({ color: '#6b4a2f', roughness: 0.85 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: '#e8e8e8', roughness: 0.8 });
  const dashMat = new THREE.MeshStandardMaterial({ color: '#d8b13c', roughness: 0.8 });
  const cashMat = new THREE.MeshStandardMaterial({
    color: PALETTE.cash, emissive: PALETTE.cash, emissiveIntensity: 0.55, roughness: 0.5,
  });
  const cashBandMat = new THREE.MeshStandardMaterial({
    color: PALETTE.cashBand, emissive: PALETTE.cashBand, emissiveIntensity: 0.35, roughness: 0.5,
  });
  const antennaTipMat = new THREE.MeshStandardMaterial({
    color: '#ff4444', emissive: '#ff2222', emissiveIntensity: 2.2,
  });
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#5a3d28', roughness: 0.95 });
  const foliageMat = new THREE.MeshStandardMaterial({ color: '#3f7a44', roughness: 0.9 });
  const planterMat = new THREE.MeshStandardMaterial({ color: '#7a6a58', roughness: 0.85 });
  const bushMat = new THREE.MeshStandardMaterial({ color: '#4a8a4f', roughness: 0.9 });
  const pistolMat = new THREE.MeshStandardMaterial({ color: '#1c1e22', roughness: 0.35, metalness: 0.7 });
  const pistolGripMat = new THREE.MeshStandardMaterial({ color: '#d8a13c', roughness: 0.5, metalness: 0.3 });

  const facadeTextures = FACADES.map((f) => makeFacadeTexture(f, random));
  const glowTexture = makeGlowTexture();
  const flashTexture = makeFlashTexture();
  const smokeTexture = makeSmokeTexture();

  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 12);

  function addBox(material, w, h, d, x, y, z, shadow = true) {
    const mesh = new THREE.Mesh(boxGeometry, material);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  }

  /** Build every static mesh of the city from the layout. Called once, at boot. */
  function buildCity(city) {
    const extent = city.bounds * 2 + 40;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(extent, extent), asphaltMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const { blockSize, blocks, streetWidth, pitch } = CITY;
    const half = (blocks - 1) / 2;
    for (let bx = -half; bx <= half; bx += 1) {
      for (let bz = -half; bz <= half; bz += 1) {
        if (bx === 0 && bz === 0) continue;
        addBox(sidewalkMat, blockSize, 0.24, blockSize, bx * pitch, 0.12, bz * pitch, false);
      }
    }
    addBox(plazaMat, blockSize + streetWidth, 0.24, blockSize + streetWidth, 0, 0.12, 0, false);

    // Buildings: textured sides, dark roof, a parapet cap, and roof dressing.
    for (const b of city.buildings) {
      const facade = facadeTextures[b.facade];
      const side = facade.clone();
      side.needsUpdate = true;
      side.repeat.set(Math.max(1, Math.round(b.w / 8)), Math.max(1, Math.round(b.h / 8)));
      const sideMat = new THREE.MeshStandardMaterial({ map: side, roughness: 0.9 });
      // One material for the whole box: the parapet cap below covers the top face, and
      // the bottom is never seen — so this is 1 draw call per building, not 6.
      const mesh = new THREE.Mesh(boxGeometry, sideMat);
      mesh.scale.set(b.w, b.h, b.d);
      mesh.position.set(b.x, b.h / 2, b.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      addBox(roofMat, b.w + 0.6, 0.5, b.d + 0.6, b.x, b.h + 0.25, b.z);
      if (b.roof === 1) {
        addBox(darkMat, Math.min(6, b.w * 0.4), 1.4, Math.min(5, b.d * 0.4), b.x - b.w * 0.18, b.h + 1.2, b.z - b.d * 0.15);
      } else if (b.roof === 2) {
        const pole = new THREE.Mesh(cylinderGeometry, darkMat);
        pole.scale.set(0.12, 9, 0.12);
        pole.position.set(b.x + b.w * 0.2, b.h + 4.5, b.z + b.d * 0.2);
        pole.castShadow = true;
        scene.add(pole);
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), antennaTipMat);
        tip.position.set(b.x + b.w * 0.2, b.h + 9.2, b.z + b.d * 0.2);
        scene.add(tip);
      }
    }

    // Crosswalk stripes at every intersection, one instanced draw call.
    const stripeGeo = new THREE.BoxGeometry(0.7, 0.06, 3.6);
    const stripes = [];
    const dummy = new THREE.Object3D();
    for (const sx of city.streets) {
      for (const sz of city.streets) {
        for (const [ox, oz, rot] of [[0, -8.4, 0], [0, 8.4, 0], [-8.4, 0, Math.PI / 2], [8.4, 0, Math.PI / 2]]) {
          for (let s = -2; s <= 2; s += 1) {
            stripes.push({ x: sx + ox + (rot === 0 ? s * 1.6 : 0), z: sz + oz + (rot === 0 ? 0 : s * 1.6), rot });
          }
        }
      }
    }
    const stripeMesh = new THREE.InstancedMesh(stripeGeo, stripeMat, stripes.length);
    stripes.forEach((s, i) => {
      dummy.position.set(s.x, 0.28, s.z);
      dummy.rotation.set(0, s.rot, 0);
      dummy.updateMatrix();
      stripeMesh.setMatrixAt(i, dummy.matrix);
    });
    stripeMesh.receiveShadow = true;
    scene.add(stripeMesh);

    // Dashed centre lines down every avenue, one instanced draw call.
    const dashGeo = new THREE.BoxGeometry(0.5, 0.06, 3);
    const dashes = [];
    for (const s of city.streets) {
      for (let d = -city.bounds + 8; d < city.bounds - 8; d += 7) {
        if (city.streets.some((c) => Math.abs(d - c) < 9)) continue;
        dashes.push({ x: s, z: d, rot: 0 });
        dashes.push({ x: d, z: s, rot: Math.PI / 2 });
      }
    }
    const dashMesh = new THREE.InstancedMesh(dashGeo, dashMat, dashes.length);
    dashes.forEach((s, i) => {
      dummy.position.set(s.x, 0.28, s.z);
      dummy.rotation.set(0, s.rot, 0);
      dummy.updateMatrix();
      dashMesh.setMatrixAt(i, dummy.matrix);
    });
    dashMesh.receiveShadow = true;
    scene.add(dashMesh);

    // Street lamps: instanced poles and glowing heads.
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 5.5, 8);
    const poleMesh = new THREE.InstancedMesh(poleGeo, lampPoleMat, city.lamps.length);
    const headGeo = new THREE.BoxGeometry(0.9, 0.18, 0.32);
    const headMesh = new THREE.InstancedMesh(headGeo, lampHeadMat, city.lamps.length);
    city.lamps.forEach((lamp, i) => {
      dummy.position.set(lamp.x, 2.75, lamp.z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      poleMesh.setMatrixAt(i, dummy.matrix);
      dummy.position.set(lamp.x, 5.55, lamp.z);
      dummy.updateMatrix();
      headMesh.setMatrixAt(i, dummy.matrix);
    });
    poleMesh.castShadow = true;
    scene.add(poleMesh, headMesh);

    // Hydrants: instanced red bodies with caps.
    const hydGeo = new THREE.CylinderGeometry(0.22, 0.26, 0.7, 10);
    const hydMesh = new THREE.InstancedMesh(hydGeo, hydrantMat, city.hydrants.length);
    city.hydrants.forEach((h, i) => {
      dummy.position.set(h.x, 0.6, h.z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      hydMesh.setMatrixAt(i, dummy.matrix);
    });
    hydMesh.castShadow = true;
    scene.add(hydMesh);

    // Plaza benches: instanced seats and backs, ringing the fountain.
    const seatGeo = new THREE.BoxGeometry(2.2, 0.12, 0.6);
    const seatMesh = new THREE.InstancedMesh(seatGeo, benchMat, city.benches.length);
    const backGeo = new THREE.BoxGeometry(2.2, 0.7, 0.12);
    const backMesh = new THREE.InstancedMesh(backGeo, benchMat, city.benches.length);
    city.benches.forEach((bench, i) => {
      dummy.position.set(bench.x, 0.55, bench.z);
      dummy.rotation.set(0, bench.angle, 0);
      dummy.updateMatrix();
      seatMesh.setMatrixAt(i, dummy.matrix);
      dummy.position.set(bench.x - Math.sin(bench.angle) * 0.32, 0.85, bench.z - Math.cos(bench.angle) * 0.32);
      dummy.updateMatrix();
      backMesh.setMatrixAt(i, dummy.matrix);
    });
    seatMesh.castShadow = true;
    backMesh.castShadow = true;
    scene.add(seatMesh, backMesh);

    // Plaza trees: a trunk and two crowns each, ringing the plaza outside the benches.
    for (const tree of city.trees) {
      const s = tree.size;
      const trunk = new THREE.Mesh(cylinderGeometry, trunkMat);
      trunk.scale.set(0.28 * s, 2.6 * s, 0.28 * s);
      trunk.position.set(tree.x, 1.3 * s, tree.z);
      trunk.castShadow = true;
      scene.add(trunk);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(1.7 * s, 10, 8), foliageMat);
      crown.position.set(tree.x, 3.4 * s, tree.z);
      crown.castShadow = true;
      scene.add(crown);
      const crown2 = new THREE.Mesh(new THREE.SphereGeometry(1.1 * s, 10, 8), foliageMat);
      crown2.position.set(tree.x + 0.8 * s, 4.4 * s, tree.z + 0.4 * s);
      crown2.castShadow = true;
      scene.add(crown2);
    }

    // Plaza planters: stone boxes with a bush in each, dressing the plaza corners.
    for (const planter of city.planters) {
      const box = new THREE.Mesh(boxGeometry, planterMat);
      box.scale.set(2.4, 0.7, 2.4);
      box.position.set(planter.x, 0.35, planter.z);
      box.castShadow = true;
      box.receiveShadow = true;
      scene.add(box);
      const bush = new THREE.Mesh(new THREE.SphereGeometry(1.0, 10, 8), bushMat);
      bush.position.set(planter.x, 1.1, planter.z);
      bush.scale.y = 0.75;
      bush.castShadow = true;
      scene.add(bush);
    }

    // The plaza fountain: stone basin, water, centre column.
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.6, 0.9, 24), stoneMat);
    basin.position.set(0, 0.45, 0);
    basin.castShadow = true;
    basin.receiveShadow = true;
    scene.add(basin);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(4.1, 4.1, 0.2, 24), waterMat);
    water.position.set(0, 0.82, 0);
    scene.add(water);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 2.2, 12), stoneMat);
    column.position.set(0, 1.6, 0);
    column.castShadow = true;
    scene.add(column);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.9, 0.35, 12), stoneMat);
    cap.position.set(0, 2.8, 0);
    cap.castShadow = true;
    scene.add(cap);
  }

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1600);
  const playerMesh = createPlayerMesh();
  scene.add(playerMesh.group);

  // Day cycle: the light drifts over DAY.period seconds of play, late afternoon
  // toward dusk and back. The two ends are precomputed; each frame lerps between
  // them, so the shift costs a handful of colour lerps and nothing else.
  const daySunColor = new THREE.Color(SUN.color);
  const duskSunColor = new THREE.Color('#ff9e5e');
  const daySkyTop = new THREE.Color(SKY.top);
  const duskSkyTop = new THREE.Color('#24365e');
  const daySkyHorizon = new THREE.Color(SKY.horizon);
  const duskSkyHorizon = new THREE.Color('#e08a5a');
  const dayFog = new THREE.Color(SKY.fog);
  const duskFog = new THREE.Color('#c98a6a');
  const tmpColor = new THREE.Color();

  function applyDayCycle(elapsed) {
    const k = 0.5 + 0.5 * Math.sin((elapsed / DAY.period) * Math.PI * 2);
    sun.intensity = SUN.intensity - 0.5 * k;
    sun.color.copy(tmpColor.copy(daySunColor).lerp(duskSunColor, k));
    hemi.intensity = 0.95 - 0.2 * k;
    renderer.toneMappingExposure = EXPOSURE_BASE - EXPOSURE_DUSK_DROP * k;
    skyMesh.material.uniforms.top.value.copy(tmpColor.copy(daySkyTop).lerp(duskSkyTop, k));
    skyMesh.material.uniforms.horizon.value.copy(tmpColor.copy(daySkyHorizon).lerp(duskSkyHorizon, k));
    scene.fog.color.copy(tmpColor.copy(dayFog).lerp(duskFog, k));
  }

  let pickupMeshes = [];
  let built = false;
  let trauma = 0;
  let shakeTime = 0;

  /** Build the cash-drop meshes once, aligned with state.pickups by index. */
  function buildPickups(state) {
    pickupMeshes = state.pickups.map(() => {
      const group = new THREE.Group();
      const bundle = new THREE.Mesh(boxGeometry, cashMat);
      bundle.scale.set(0.62, 0.26, 0.42);
      bundle.castShadow = true;
      const band = new THREE.Mesh(boxGeometry, cashBandMat);
      band.scale.set(0.64, 0.1, 0.44);
      group.add(bundle, band);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      glow.scale.set(2.6, 2.6, 1);
      group.add(glow);
      scene.add(group);
      return group;
    });
  }

  /** A small camera shake on pickup: trauma on the camera only, never the player. */
  function addTrauma(amount) {
    trauma = Math.min(1, trauma + amount);
  }

  // --- Cars, walkers, cops and the mission beacon (phase 2) ---------------------
  // Shared materials, one per car colour, so 17 cars cost a handful of materials.
  const carBodyMats = CAR.colors.map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.55 }),
  );
  const carGlassMat = new THREE.MeshStandardMaterial({ color: '#1a2530', roughness: 0.15, metalness: 0.4 });
  const tyreMat = new THREE.MeshStandardMaterial({ color: '#14161a', roughness: 1 });
  const headlightMat = new THREE.MeshStandardMaterial({
    color: '#fff6cf', emissive: '#ffedb0', emissiveIntensity: 1.4, roughness: 0.3,
  });
  const taillightMat = new THREE.MeshStandardMaterial({
    color: '#a02020', emissive: '#ff2a2a', emissiveIntensity: 0.9, roughness: 0.3,
  });
  const policeBodyMat = new THREE.MeshStandardMaterial({ color: '#e8e8e8', roughness: 0.35, metalness: 0.4 });
  const policeDoorMat = new THREE.MeshStandardMaterial({ color: '#1c2f5e', roughness: 0.4, metalness: 0.4 });
  const copLightRedMat = new THREE.MeshStandardMaterial({
    color: '#ff2222', emissive: '#ff2222', emissiveIntensity: 2.5,
  });
  const copLightBlueMat = new THREE.MeshStandardMaterial({
    color: '#2244ff', emissive: '#2244ff', emissiveIntensity: 2.5,
  });
  const copLightOffMat = new THREE.MeshStandardMaterial({ color: '#3a3f46', roughness: 0.6 });

  /** A car from boxes: body, cabin, two axle wheel-bars, headlights, taillights. */
  function createCarMesh(bodyMat, isPolice) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(boxGeometry, bodyMat);
    body.scale.set(CAR.width, 0.62, CAR.length);
    body.position.y = 0.55;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    const cabin = new THREE.Mesh(boxGeometry, isPolice ? policeDoorMat : carGlassMat);
    cabin.scale.set(CAR.width - 0.3, 0.55, CAR.length * 0.42);
    cabin.position.set(0, 1.1, -0.25);
    cabin.castShadow = true;
    group.add(cabin);
    for (const z of [1.35, -1.35]) {
      const axle = new THREE.Mesh(boxGeometry, tyreMat);
      axle.scale.set(CAR.width + 0.12, 0.5, 0.55);
      axle.position.set(0, 0.3, z);
      axle.castShadow = true;
      group.add(axle);
    }
    const head = new THREE.Mesh(boxGeometry, headlightMat);
    head.scale.set(CAR.width - 0.4, 0.14, 0.1);
    head.position.set(0, 0.62, CAR.length / 2 + 0.01);
    group.add(head);
    const tail = new THREE.Mesh(boxGeometry, taillightMat);
    tail.scale.set(CAR.width - 0.4, 0.14, 0.1);
    tail.position.set(0, 0.62, -CAR.length / 2 - 0.01);
    group.add(tail);
    // The spoiler: a flat wing on two struts at the back. Hidden until the garage
    // bolts an engine tune on — the visible proof the car is tuned.
    const spoiler = new THREE.Group();
    const spoilerWing = new THREE.Mesh(boxGeometry, new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4 }));
    spoilerWing.scale.set(CAR.width - 0.2, 0.08, 0.5);
    spoilerWing.position.y = 1.35;
    const spoilerStrutL = new THREE.Mesh(boxGeometry, spoilerWing.material);
    spoilerStrutL.scale.set(0.08, 0.35, 0.08);
    spoilerStrutL.position.set(-0.6, 1.15, 0);
    const spoilerStrutR = new THREE.Mesh(boxGeometry, spoilerWing.material);
    spoilerStrutR.scale.set(0.08, 0.35, 0.08);
    spoilerStrutR.position.set(0.6, 1.15, 0);
    spoiler.add(spoilerWing, spoilerStrutL, spoilerStrutR);
    spoiler.position.z = -CAR.length / 2 + 0.3;
    spoiler.visible = false;
    group.add(spoiler);
    let lightL = null;
    let lightR = null;
    if (isPolice) {
      lightL = new THREE.Mesh(boxGeometry, copLightRedMat);
      lightL.scale.set(0.42, 0.16, 0.3);
      lightL.position.set(-0.28, 1.48, -0.25);
      lightR = new THREE.Mesh(boxGeometry, copLightBlueMat);
      lightR.scale.set(0.42, 0.16, 0.3);
      lightR.position.set(0.28, 1.48, -0.25);
      group.add(lightL, lightR);
    }
    return { group, body, spoiler, lightL, lightR };
  }

  /** A walker from boxes: legs, torso, head. Shirt colour varies; cops are navy. */
  function createWalkerMesh(shirtColor) {
    const group = new THREE.Group();
    const shirtMat = new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.85 });
    const pantsMat = new THREE.MeshStandardMaterial({ color: '#2b2f38', roughness: 0.9 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xc98e6b, roughness: 0.7 });
    const legs = new THREE.Mesh(boxGeometry, pantsMat);
    legs.scale.set(0.34, 0.85, 0.22);
    legs.position.y = 0.43;
    legs.castShadow = true;
    const torso = new THREE.Mesh(boxGeometry, shirtMat);
    torso.scale.set(0.48, 0.6, 0.28);
    torso.position.y = 1.15;
    torso.castShadow = true;
    const head = new THREE.Mesh(boxGeometry, skinMat);
    head.scale.set(0.28, 0.28, 0.28);
    head.position.y = 1.6;
    head.castShadow = true;
    group.add(legs, torso, head);
    return { group, legs, torso, head };
  }

  let carMeshes = [];
  let pedMeshes = [];
  let copMeshes = [];
  let enforcerMeshes = [];
  let pistolMesh = null;
  let smokeSprites = [];
  let muzzleFlash = null;
  let beacon = null;
  let beaconMarker = null;
  let heliGroup = null;
  let heliRotor = null;
  let heliCone = null;
  let heliDisc = null;
  let shopMeshes = [];
  let safehouseMarker = null;
  let garageMarker = null;

  /** Build the phase-2 meshes once, aligned with the state arrays by index. */
  function buildPhaseTwo(state) {
    carMeshes = [];
    for (const car of state.cars) {
      const mesh = createCarMesh(carBodyMats[car.color % carBodyMats.length], false);
      scene.add(mesh.group);
      carMeshes.push({ car, ...mesh });
    }
    for (const car of state.traffic) {
      const mesh = createCarMesh(carBodyMats[car.color % carBodyMats.length], false);
      scene.add(mesh.group);
      carMeshes.push({ car, ...mesh });
    }
    // Police cars spawn later, up to 3: build the pool now, hide until needed.
    for (let i = 0; i < 3; i += 1) {
      const mesh = createCarMesh(policeBodyMat, true);
      mesh.group.visible = false;
      scene.add(mesh.group);
      carMeshes.push({ car: null, ...mesh, policeSlot: i });
    }
    pedMeshes = state.peds.map((ped) => {
      const mesh = createWalkerMesh(ped.shirt);
      scene.add(mesh.group);
      return { ped, ...mesh };
    });
    copMeshes = [];
    for (let i = 0; i < 2; i += 1) {
      const mesh = createWalkerMesh(0x1c2f5e);
      mesh.group.visible = false;
      scene.add(mesh.group);
      copMeshes.push({ cop: null, ...mesh });
    }
    // The mission beacon: a gold pillar of light plus a floating diamond.
    const beaconMat = new THREE.MeshBasicMaterial({
      color: 0xf2c94c, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 34, 12, 1, true), beaconMat);
    beacon.visible = false;
    scene.add(beacon);
    beaconMarker = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.9),
      new THREE.MeshStandardMaterial({ color: 0xf2c94c, emissive: 0xf2c94c, emissiveIntensity: 0.9 }),
    );
    beaconMarker.visible = false;
    beaconMarker.castShadow = true;
    scene.add(beaconMarker);

    // Enforcers spawn during the getaway, up to 3: build the pool now, hide until needed.
    // Dark red shirts, so they read as hostile at a glance next to the navy cops.
    enforcerMeshes = [];
    for (let i = 0; i < ENFORCER.count; i += 1) {
      const mesh = createWalkerMesh(0x8a2f2f);
      mesh.group.visible = false;
      scene.add(mesh.group);
      enforcerMeshes.push({ enforcer: null, ...mesh });
    }

    // The pistol pickup: a dark slide, a gold grip, a glow — small, but findable.
    pistolMesh = new THREE.Group();
    const slide = new THREE.Mesh(boxGeometry, pistolMat);
    slide.scale.set(0.14, 0.1, 0.5);
    slide.position.y = 0.12;
    slide.castShadow = true;
    const grip = new THREE.Mesh(boxGeometry, pistolGripMat);
    grip.scale.set(0.12, 0.22, 0.12);
    grip.position.set(0, 0, -0.16);
    grip.castShadow = true;
    const pistolGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    pistolGlow.scale.set(2.0, 2.0, 1);
    pistolMesh.add(slide, grip, pistolGlow);
    pistolMesh.visible = false;
    scene.add(pistolMesh);

    // Car smoke: grey puffs that rise from a damaged hood, one sprite each.
    smokeSprites = [];
    for (let i = 0; i < 8; i += 1) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: smokeTexture, transparent: true, depthWrite: false, opacity: 0,
      }));
      sprite.visible = false;
      scene.add(sprite);
      smokeSprites.push(sprite);
    }

    // The muzzle flash: a bright sprite at the barrel, alive for a frame or two.
    muzzleFlash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flashTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      color: 0xffd27a,
    }));
    muzzleFlash.visible = false;
    scene.add(muzzleFlash);

    // The police helicopter: a dark-navy body with a white stripe, a tail, and a
    // spinning rotor, built once and hidden until the heat hits four stars.
    heliGroup = new THREE.Group();
    const heliBody = new THREE.Mesh(boxGeometry, policeBodyMat);
    heliBody.scale.set(2.4, 1.1, 1.4);
    heliBody.position.y = 0;
    heliBody.castShadow = true;
    const heliStripe = new THREE.Mesh(boxGeometry, new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.4 }));
    heliStripe.scale.set(2.42, 0.3, 1.42);
    heliStripe.position.y = 0.1;
    const heliTail = new THREE.Mesh(boxGeometry, policeBodyMat);
    heliTail.scale.set(0.35, 0.35, 2.4);
    heliTail.position.set(0, 0.15, -1.9);
    heliTail.castShadow = true;
    const heliFin = new THREE.Mesh(boxGeometry, policeBodyMat);
    heliFin.scale.set(0.12, 0.9, 0.5);
    heliFin.position.set(0, 0.5, -3.0);
    const heliSkidL = new THREE.Mesh(boxGeometry, new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 }));
    heliSkidL.scale.set(0.12, 0.12, 2.6);
    heliSkidL.position.set(-0.7, -0.7, 0);
    const heliSkidR = heliSkidL.clone();
    heliSkidR.position.x = 0.7;
    heliRotor = new THREE.Group();
    const rotorBlade = new THREE.Mesh(boxGeometry, new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 }));
    rotorBlade.scale.set(7.5, 0.08, 0.4);
    rotorBlade.position.y = 0.75;
    const rotorCross = new THREE.Mesh(boxGeometry, new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 }));
    rotorCross.scale.set(0.4, 0.08, 7.5);
    rotorCross.position.y = 0.75;
    heliRotor.add(rotorBlade, rotorCross);
    heliGroup.add(heliBody, heliStripe, heliTail, heliFin, heliSkidL, heliSkidR, heliRotor);
    heliGroup.visible = false;
    scene.add(heliGroup);
    // The searchlight: a cone from the helicopter to the ground under Rook, plus
    // a warm pool of light on the street where it lands.
    heliCone = new THREE.Mesh(
      new THREE.ConeGeometry(6, 1, 20, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xfff2b0, transparent: true, opacity: 0.16,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    heliCone.visible = false;
    scene.add(heliCone);
    heliDisc = new THREE.Mesh(
      new THREE.CircleGeometry(5, 24),
      new THREE.MeshBasicMaterial({
        color: 0xfff2b0, transparent: true, opacity: 0.22,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    heliDisc.rotation.x = -Math.PI / 2;
    heliDisc.visible = false;
    scene.add(heliDisc);

    // The shops: a kiosk with a coloured awning and a painted name sign, facing
    // the plaza so the shelf is readable from the street.
    shopMeshes = [];
    for (const shop of state.shops) {
      const group = new THREE.Group();
      const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.85 });
      const awningMat = new THREE.MeshStandardMaterial({ color: shop.awning, roughness: 0.7 });
      const kiosk = new THREE.Mesh(boxGeometry, wallMat);
      kiosk.scale.set(3.4, 2.6, 2.6);
      kiosk.position.y = 1.3;
      kiosk.castShadow = true;
      const awning = new THREE.Mesh(boxGeometry, awningMat);
      awning.scale.set(3.6, 0.14, 1.4);
      awning.position.set(0, 2.35, 1.6);
      awning.rotation.x = 0.22;
      const door = new THREE.Mesh(boxGeometry, new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 }));
      door.scale.set(0.9, 1.9, 0.1);
      door.position.set(0, 0.95, 1.32);
      const signTexture = makeShopSignTexture(shop.name);
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(3.2, 0.8),
        new THREE.MeshStandardMaterial({ map: signTexture, emissive: 0xffffff, emissiveMap: signTexture, emissiveIntensity: 0.25 }),
      );
      sign.position.set(0, 3.0, 1.32);
      group.add(kiosk, awning, door, sign);
      group.position.set(shop.x, 0, shop.z);
      // Face the plaza: the sign reads from the street, not from the block behind.
      group.rotation.y = Math.atan2(-shop.x, -shop.z);
      scene.add(group);
      shopMeshes.push({ shop, group });
    }

    // The safehouse: a small house with a pitched roof, warm lit windows and a
    // painted sign — Rook's place, the one address that is his. A green diamond
    // bobs over the door so it reads as a place, not just a building.
    const houseGroup = new THREE.Group();
    const houseWallMat = new THREE.MeshStandardMaterial({ color: 0x8a6f4d, roughness: 0.9 });
    const houseRoofMat = new THREE.MeshStandardMaterial({ color: 0x5b3a2e, roughness: 0.9 });
    const houseWalls = new THREE.Mesh(boxGeometry, houseWallMat);
    houseWalls.scale.set(3.8, 2.4, 3.2);
    houseWalls.position.y = 1.2;
    houseWalls.castShadow = true;
    const houseRoof = new THREE.Mesh(boxGeometry, houseRoofMat);
    houseRoof.scale.set(4.2, 0.5, 3.6);
    houseRoof.position.y = 2.6;
    houseRoof.rotation.z = 0.0;
    houseRoof.castShadow = true;
    const houseRoofTop = new THREE.Mesh(boxGeometry, houseRoofMat);
    houseRoofTop.scale.set(2.2, 0.5, 3.6);
    houseRoofTop.position.y = 3.0;
    const houseDoor = new THREE.Mesh(boxGeometry, new THREE.MeshStandardMaterial({ color: 0x2e4a3a, roughness: 0.6 }));
    houseDoor.scale.set(0.9, 1.9, 0.1);
    houseDoor.position.set(0, 0.95, 1.62);
    const houseWindowMat = new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xffb84d, emissiveIntensity: 0.8 });
    const houseWindowL = new THREE.Mesh(boxGeometry, houseWindowMat);
    houseWindowL.scale.set(0.8, 0.8, 0.1);
    houseWindowL.position.set(-1.1, 1.4, 1.62);
    const houseWindowR = new THREE.Mesh(boxGeometry, houseWindowMat);
    houseWindowR.scale.set(0.8, 0.8, 0.1);
    houseWindowR.position.set(1.1, 1.4, 1.62);
    const houseSignTexture = makeShopSignTexture(SAFEHOUSE.name);
    const houseSign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 0.85),
      new THREE.MeshStandardMaterial({ map: houseSignTexture, emissive: 0xffffff, emissiveMap: houseSignTexture, emissiveIntensity: 0.25 }),
    );
    houseSign.position.set(0, 3.6, 1.7);
    houseGroup.add(houseWalls, houseRoof, houseRoofTop, houseDoor, houseWindowL, houseWindowR, houseSign);
    houseGroup.position.set(SAFEHOUSE.x, 0, SAFEHOUSE.z);
    // Face the street: the door and the sign read from the intersection.
    houseGroup.rotation.y = Math.atan2(-SAFEHOUSE.x, -SAFEHOUSE.z);
    scene.add(houseGroup);
    safehouseMarker = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.7),
      new THREE.MeshStandardMaterial({ color: 0x37d67a, emissive: 0x37d67a, emissiveIntensity: 0.9 }),
    );
    safehouseMarker.position.set(SAFEHOUSE.x, 4.4, SAFEHOUSE.z);
    safehouseMarker.castShadow = true;
    scene.add(safehouseMarker);

    // The garage: a wide workshop with a dark open bay, a painted sign and a
    // tyre stack by the door — plus the yellow bay lines on the street in front,
    // where a car waits to be tuned. A blue diamond bobs over the door.
    const garageGroup = new THREE.Group();
    const garageWallMat = new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.85 });
    const garageBox = new THREE.Mesh(boxGeometry, garageWallMat);
    garageBox.scale.set(4.2, 3.0, 3.4);
    garageBox.position.y = 1.5;
    garageBox.castShadow = true;
    const garageDoor = new THREE.Mesh(boxGeometry, new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.5 }));
    garageDoor.scale.set(2.6, 2.2, 0.1);
    garageDoor.position.set(0, 1.1, 1.72);
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
    for (let i = 0; i < 3; i += 1) {
      const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.3, 12), tyreMat);
      tyre.position.set(2.6, 0.15 + i * 0.32, 1.2);
      tyre.castShadow = true;
      garageGroup.add(tyre);
    }
    const garageSignTexture = makeShopSignTexture(GARAGE.name);
    const garageSign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 0.9),
      new THREE.MeshStandardMaterial({ map: garageSignTexture, emissive: 0xffffff, emissiveMap: garageSignTexture, emissiveIntensity: 0.25 }),
    );
    garageSign.position.set(0, 3.4, 1.72);
    garageGroup.add(garageBox, garageDoor, garageSign);
    garageGroup.position.set(GARAGE.x, 0, GARAGE.z);
    garageGroup.rotation.y = Math.atan2(-GARAGE.x, -GARAGE.z);
    scene.add(garageGroup);
    // The bay lines: four thin yellow strips marking the parking bay on the
    // street in front of the garage door.
    const bayMat = new THREE.MeshStandardMaterial({ color: 0xf2c94c, roughness: 0.6 });
    const bayX = GARAGE.bayX;
    const bayZ = GARAGE.bayZ;
    for (const [bx, bz, bw, bd] of [
      [bayX - 3.4, bayZ, 0.25, 7], [bayX + 3.4, bayZ, 0.25, 7],
      [bayX, bayZ - 3.4, 7, 0.25], [bayX, bayZ + 3.4, 7, 0.25],
    ]) {
      const line = new THREE.Mesh(boxGeometry, bayMat);
      line.scale.set(bw, 0.04, bd);
      line.position.set(bx, 0.03, bz);
      scene.add(line);
    }
    garageMarker = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.7),
      new THREE.MeshStandardMaterial({ color: 0x3b82f6, emissive: 0x3b82f6, emissiveIntensity: 0.9 }),
    );
    garageMarker.position.set(GARAGE.x, 4.4, GARAGE.z);
    garageMarker.castShadow = true;
    scene.add(garageMarker);
  }

  /** Sync every phase-2 mesh to the world state for this frame. */
  function updatePhaseTwo(state, dt) {
    for (const entry of carMeshes) {
      const car = entry.car;
      if (!car) continue;
      entry.group.position.set(car.x, 0, car.z);
      entry.group.rotation.y = car.heading;
      // A parked car's paint and spoiler follow its tuning: a paint job swaps
      // the body material, an engine tune shows the spoiler. Traffic cars have
      // no tuning record, so they keep their factory paint.
      if (car.tuning && entry.body) {
        if (entry.lastColor !== car.color) {
          entry.lastColor = car.color;
          entry.body.material = carBodyMats[car.color % carBodyMats.length];
        }
        if (entry.spoiler) entry.spoiler.visible = car.tuning.engine >= 1;
      }
    }
    // Police pool: bind each visible slot to a live police car, flash its light bar.
    const lightOn = Math.floor(state.police.lightPhase * LIGHT_FLASH_RATE) % 2 === 0;
    for (let i = 0; i < 3; i += 1) {
      const slot = carMeshes.find((e) => e.policeSlot === i);
      if (!slot) continue;
      const car = state.police.cars[i];
      slot.car = car ?? null;
      slot.group.visible = !!car;
      if (!car) continue;
      slot.group.position.set(car.x, 0, car.z);
      slot.group.rotation.y = car.heading;
      if (slot.lightL && slot.lightR) {
        slot.lightL.material = lightOn ? copLightRedMat : copLightOffMat;
        slot.lightR.material = lightOn ? copLightOffMat : copLightBlueMat;
      }
    }
    for (const entry of pedMeshes) {
      const ped = entry.ped;
      entry.group.position.set(ped.x, 0, ped.z);
      if (ped.state === 'down') {
        entry.group.rotation.set(Math.PI / 2, 0, ped.heading);
        entry.group.position.y = 0.3;
      } else {
        entry.group.rotation.set(0, ped.heading, 0);
        entry.group.position.y = Math.abs(Math.sin(ped.walkPhase)) * 0.05;
        entry.legs.rotation.x = Math.sin(ped.walkPhase) * 0.5;
        entry.torso.rotation.x = Math.sin(ped.walkPhase) * 0.06;
      }
    }
    for (let i = 0; i < 2; i += 1) {
      const entry = copMeshes[i];
      const cop = state.police.footCops[i];
      entry.cop = cop ?? null;
      entry.group.visible = !!cop;
      if (!cop) continue;
      if (cop.state === 'down') {
        // A cop on the ground lies flat, like a walker who was hit.
        entry.group.position.set(cop.x, 0.3, cop.z);
        entry.group.rotation.set(Math.PI / 2, 0, cop.heading);
        continue;
      }
      entry.group.position.set(cop.x, Math.abs(Math.sin(cop.walkPhase)) * 0.05, cop.z);
      entry.group.rotation.set(0, cop.heading, 0);
      entry.legs.rotation.x = Math.sin(cop.walkPhase) * 0.5;
    }
    // Enforcers: the pool binds by index to the live ones, like the cops.
    for (let i = 0; i < ENFORCER.count; i += 1) {
      const entry = enforcerMeshes[i];
      const e = state.combat.enforcers[i];
      entry.enforcer = e ?? null;
      entry.group.visible = !!e;
      if (!e) continue;
      if (e.state === 'down') {
        entry.group.position.set(e.x, 0.3, e.z);
        entry.group.rotation.set(Math.PI / 2, 0, e.heading);
        continue;
      }
      entry.group.position.set(e.x, Math.abs(Math.sin(e.walkPhase)) * 0.05, e.z);
      entry.group.rotation.set(0, e.heading, 0);
      entry.legs.rotation.x = Math.sin(e.walkPhase) * 0.5;
      entry.torso.rotation.x = Math.sin(e.walkPhase) * 0.06;
    }
    // The pistol pickup: bobs and turns where the story left it, until taken.
    const pistol = state.combat.pistol;
    const showPistol = !!pistol && !pistol.taken;
    pistolMesh.visible = showPistol;
    if (showPistol) {
      pistolMesh.position.set(pistol.x, 0.7 + Math.sin(state.elapsed * 2.2) * 0.12, pistol.z);
      pistolMesh.rotation.y += dt * 1.4;
    }
    // Smoke from a damaged player car: puffs rise from the hood, grow and fade.
    // The threshold is CAR.smokeBelow — the same one world.js uses to flag it.
    const car = state.currentCar;
    const smoking = !!car && car.hp !== undefined && car.hp > 0 && car.hp < CAR.smokeBelow;
    for (let i = 0; i < smokeSprites.length; i += 1) {
      const sprite = smokeSprites[i];
      sprite.visible = smoking;
      if (!smoking) continue;
      const cycle = ((state.elapsed * 0.7 + i / smokeSprites.length) % 1);
      const fx = Math.sin(car.heading);
      const fz = Math.cos(car.heading);
      sprite.position.set(
        car.x + fx * 1.6 + Math.sin(i * 2.4) * 0.4,
        1.0 + cycle * 3.2,
        car.z + fz * 1.6 + Math.cos(i * 1.7) * 0.4,
      );
      const scale = 0.8 + cycle * 2.2;
      sprite.scale.set(scale, scale, 1);
      sprite.material.opacity = 0.55 * (1 - cycle);
    }
    // The muzzle flash lives where the barrel points, for the life of the flash.
    const muzzle = state.combat.muzzle;
    muzzleFlash.visible = muzzle > 0 && !state.inCar;
    if (muzzleFlash.visible) {
      const p = state.player;
      muzzleFlash.position.set(p.x + Math.sin(p.heading) * 0.9, 1.4, p.z + Math.cos(p.heading) * 0.9);
      const life = muzzle / MUZZLE_SECONDS;
      const scale = 0.9 + life * 0.9;
      muzzleFlash.scale.set(scale, scale, 1);
      muzzleFlash.material.opacity = life;
    }
    const objective = state.objective;
    const showBeacon = !!objective;
    beacon.visible = showBeacon;
    beaconMarker.visible = showBeacon;
    if (showBeacon) {
      beacon.position.set(objective.x, 17, objective.z);
      beaconMarker.position.set(objective.x, 4.2 + Math.sin(state.elapsed * 2) * 0.35, objective.z);
      beaconMarker.rotation.y += dt * 1.2;
    }
    // The safehouse and garage diamonds bob over their doors, like the beacon.
    if (safehouseMarker) {
      safehouseMarker.position.y = 4.4 + Math.sin(state.elapsed * 2) * 0.3;
      safehouseMarker.rotation.y += dt * 1.2;
    }
    if (garageMarker) {
      garageMarker.position.y = 4.4 + Math.sin(state.elapsed * 2 + 1) * 0.3;
      garageMarker.rotation.y += dt * 1.2;
    }
    // The helicopter: over Rook at four stars, its rotor spinning, the searchlight
    // cone from the belly down to the street under him. Gone below four stars.
    const heli = state.police.heli;
    const showHeli = !!heli;
    heliGroup.visible = showHeli;
    heliCone.visible = showHeli;
    heliDisc.visible = showHeli;
    if (showHeli) {
      heliGroup.position.set(heli.x, heli.y, heli.z);
      // The nose points at Rook: the searchlight is always on the hunted.
      heliGroup.rotation.y = Math.atan2(state.player.x - heli.x, state.player.z - heli.z);
      heliRotor.rotation.y = heli.rotor;
      const dx = state.player.x - heli.x;
      const dz = state.player.z - heli.z;
      const dist = Math.hypot(dx, heli.y, dz);
      // The cone's +Y is its apex: point it at the helicopter, sit it halfway
      // between the belly and the street, and stretch it to the distance.
      scratchDir.set(-dx, heli.y, -dz).normalize();
      heliCone.quaternion.setFromUnitVectors(UP, scratchDir);
      heliCone.position.set((heli.x + state.player.x) / 2, heli.y / 2, (heli.z + state.player.z) / 2);
      heliCone.scale.set(1, dist, 1);
      heliDisc.position.set(state.player.x, 0.06, state.player.z);
    }
  }

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(ratio);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    camera.updateProjectionMatrix();
  }

  // Scratch vectors for the camera work, reused every frame: the follow camera
  // used to allocate a handful of Vector3s per frame, every frame, forever.
  const scratchDir = new THREE.Vector3();
  const scratchPoint = new THREE.Vector3();
  const scratchHead = new THREE.Vector3();
  const scratchOffset = new THREE.Vector3();
  const scratchDesired = new THREE.Vector3();
  const scratchPos = new THREE.Vector3();
  const scratchAhead = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  /** Walk from `from` toward `to`, stopping just before a building: the camera's collision. */
  function collisionDistance(from, to, city) {
    const dir = scratchDir.subVectors(to, from);
    const total = dir.length();
    if (total < 0.01) return total;
    dir.normalize();
    const steps = Math.ceil(total / 0.4);
    for (let i = 1; i <= steps; i += 1) {
      const p = scratchPoint.copy(from).addScaledVector(dir, (total * i) / steps);
      if (p.y < 0.6) return Math.max(0.5, (total * (i - 1)) / steps);
      let hit = false;
      for (const b of city.buildings) {
        if (
          p.x > b.x - b.w / 2 - CAMERA.collisionPadding &&
          p.x < b.x + b.w / 2 + CAMERA.collisionPadding &&
          p.z > b.z - b.d / 2 - CAMERA.collisionPadding &&
          p.z < b.z + b.d / 2 + CAMERA.collisionPadding &&
          p.y < b.h
        ) {
          hit = true;
          break;
        }
      }
      if (hit) return Math.max(0.5, (total * (i - 1)) / steps - CAMERA.collisionPadding);
    }
    return total;
  }

  function updateCamera(state, view, dt) {
    const player = state.player;
    if (view.mode === 'fixed') {
      camera.position.set(...view.pos);
      camera.lookAt(new THREE.Vector3(...view.target));
      return;
    }
    if (view.mode === 'orbit') {
      const a = view.angle;
      camera.position.set(
        Math.cos(a) * view.radius,
        view.height,
        Math.sin(a) * view.radius,
      );
      camera.lookAt(0, 2, 12);
      return;
    }
    // Follow: orbit around Rook's head, pulled in by buildings. Behind the wheel the
    // camera rides further back and higher, looking ahead down the road (camera-systems
    // skill: chase cam with collision push-in, shake added on top, never driving it).
    const driving = !!state.inCar;
    const head = scratchHead.set(player.x, 1.7, player.z);
    const camDist = driving ? 11 : CAMERA.distance;
    const cp = Math.cos(view.pitch);
    const offset = scratchOffset.set(
      Math.sin(view.yaw) * cp,
      Math.sin(view.pitch),
      Math.cos(view.yaw) * cp,
    ).multiplyScalar(camDist);
    const desired = scratchDesired.copy(head).add(offset);
    const dist = collisionDistance(head, desired, state.city);
    // offset is normalized in place here: desired already captured the unscaled sum.
    const pos = scratchPos.copy(head).addScaledVector(offset.normalize(), dist);
    pos.y = Math.max(0.6, pos.y);
    camera.position.copy(pos);
    if (driving) {
      const ahead = scratchAhead.set(
        player.x + Math.sin(player.heading) * 6,
        1.2,
        player.z + Math.cos(player.heading) * 6,
      );
      camera.lookAt(ahead);
    } else {
      camera.lookAt(head.x, head.y + CAMERA.height - 1.4, head.z);
    }
    // Trauma shake decays on its own; smooth sines, never a per-frame random jump.
    if (trauma > 0) {
      trauma = Math.max(0, trauma - CAMERA.shakeDecay * dt);
      shakeTime += dt * 31;
      const s = trauma * trauma;
      camera.rotateZ(Math.sin(shakeTime * 1.1) * 0.02 * s);
      camera.rotateX(Math.sin(shakeTime * 1.7) * 0.015 * s);
    }
  }

  /**
   * Paint one frame: the player, the drops, the camera, then the scene. `view` describes
   * the camera (follow / orbit / fixed); `onCoin` flips true the frame a drop is collected.
   */
  function draw(state, screen, view, dt, onCoin) {
    if (!built) {
      buildCity(state.city);
      buildPickups(state);
      buildPhaseTwo(state);
      built = true;
    }
    if (onCoin) {
      playerPickupPop();
      addTrauma(0.18);
    }
    playerMesh.group.visible = !state.inCar;
    updatePlayerMesh(playerMesh, state.player, dt, state.combat);
    updatePhaseTwo(state, dt);
    for (let i = 0; i < state.pickups.length; i += 1) {
      const pickup = state.pickups[i];
      const mesh = pickupMeshes[i];
      mesh.visible = pickup.active;
      if (!pickup.active) continue;
      mesh.position.set(pickup.x, 0.9 + Math.sin(pickup.bob) * 0.16, pickup.z);
      mesh.rotation.y += dt * 1.4;
    }
    updateCamera(state, view, dt);
    applyDayCycle(state.elapsed);
    renderer.render(scene, camera);
  }

  resize();
  window.addEventListener('resize', resize);

  // Diagnostics for the site-check pass: draw calls, triangles, renderer handle.
  window.__app = { renderer, scene, camera };
  return { draw };
}
