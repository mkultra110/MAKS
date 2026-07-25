// Moteur de combat : physique Matter.js + rendu 3D Three.js + IA automatique.
import * as THREE from 'three';
import { buildCarSpec } from './car.js';
import { copilotMods, activeSets } from './state.js';
import { COPILOTS, WHEELS, partMult, partDef } from './data.js';
import { createRenderer, disposeModel, makeBlobShadow, INK, toonGradient } from './render3d.js';
import { createCarModel, createArena, createDeathWall, skyTexture, addSkyDecor, addForegroundProps, layoutForegroundProps, pulseLaserLens, toonMat, kerbTexture, ARENA_THEMES, S } from './models3d.js';
import {
  sfxHit, sfxBoom, sfxLaser, sfxShot, sfxRocket, sfxCount, sfxGo, sfxSiren, sfxClang,
  startBattleAudio, stopBattleAudio, setEngineSpeed, crowdExcite, startMusic, stopMusic,
} from './sfx.js';
import { EffectComposer } from './lib/postprocessing/EffectComposer.js';
import { RenderPass } from './lib/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './lib/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './lib/postprocessing/OutputPass.js';

const { Engine, Bodies, Body, Composite, Constraint, Events, Vector } = Matter;

const ARENA_W = 1400;
const GROUND_Y = 620;

// Terrains par ligue : le sol n'est plus plat à partir du Bronze.
// bump = colline (cercle enterré), ramp = tremplin incliné, plateau = podium central.
const TERRAINS = [
  [], // Bois : plat, pour apprendre
  [{ type: 'bump', x: ARENA_W / 2, r: 150, drop: 80 }], // Bronze : colline centrale à disputer
  [ // Argent : double tremplin vers le centre
    { type: 'ramp', x: ARENA_W / 2 - 270, w: 260, h: 26, angle: 0.2 },
    { type: 'ramp', x: ARENA_W / 2 + 270, w: 260, h: 26, angle: -0.2 },
  ],
  [ // Or : podium central surélevé
    { type: 'plateau', x: ARENA_W / 2, w: 300, h: 64 },
    { type: 'ramp', x: ARENA_W / 2 - 230, w: 190, h: 24, angle: 0.34 },
    { type: 'ramp', x: ARENA_W / 2 + 230, w: 190, h: 24, angle: -0.34 },
  ],
  [ // Diamant : deux bosses
    { type: 'bump', x: ARENA_W / 2 - 290, r: 120, drop: 65 },
    { type: 'bump', x: ARENA_W / 2 + 290, r: 120, drop: 65 },
  ],
  [ // Légende : grand tremplin central
    { type: 'ramp', x: ARENA_W / 2 - 150, w: 280, h: 28, angle: 0.3 },
    { type: 'ramp', x: ARENA_W / 2 + 150, w: 280, h: 28, angle: -0.3 },
  ],
];
const BATTLE_TIME = 45;     // secondes avant les murs de la mort
const MELEE_TICK = 0.25;    // période des dégâts de mêlée
const FLIP_TIME = 2.5;      // secondes retourné avant KO

let current = null;
let renderer = null; // WebGL persistant entre les combats

// ---------- conversion physique 2D -> monde 3D ----------
const to3x = x => (x - ARENA_W / 2) * S;
const to3y = y => (GROUND_Y - y) * S;

// ---------- construction d'un véhicule physique ----------
function makeCar(engine, lo, opts) {
  const { x, dir, team, name, statBoost = 1, dmgBoost = null, copilot = null } = opts;
  const mods = copilotMods(copilot);
  // bonus des sets de pièces (le bonus hp est déjà dans computeCarStats)
  for (const s of activeSets(lo)) {
    if (!s.active) continue;
    if (s.bonus.melee) mods.melee *= s.bonus.melee;
    if (s.bonus.ranged) mods.ranged *= s.bonus.ranged;
    if (s.bonus.speed) mods.speed *= s.bonus.speed;
  }
  const spec = buildCarSpec(lo);
  const group = Body.nextGroup(true);
  const bw = spec.body.w, bh = spec.body.h;
  const y = GROUND_Y - Math.max(...spec.wheels.map(w => w.r), 20) - bh / 2 - 12;

  const parts = [Bodies.rectangle(x, y, bw, bh, { label: `chassis:${team}` })];
  spec.weapons.forEach((wp, i) => {
    const px = x + wp.ox * dir, py = y + wp.oy;
    const opt = { label: `weapon:${team}:${i}`, density: 0.0006 };
    if (wp.shape === 'circle') parts.push(Bodies.circle(px, py, wp.r, opt));
    else parts.push(Bodies.rectangle(px, py, wp.w, wp.h, { ...opt, angle: (wp.angle || 0) * dir }));
  });
  const chassis = Body.create({
    parts, friction: 0.3, restitution: 0.1,
    collisionFilter: { group },
  });
  const centerOffset = { x: x - chassis.position.x, y: y - chassis.position.y };

  const wheels = [], axles = [];
  spec.wheels.forEach((w, wi) => {
    const wheel = Bodies.circle(x + w.ox * dir, y + w.oy, w.r, {
      collisionFilter: { group },
      friction: 1.1, frictionStatic: 8, restitution: 0.05,
      density: 0.0025, label: `wheel:${team}:${wi}`,
    });
    axles.push(Constraint.create({
      bodyA: chassis,
      pointA: { x: centerOffset.x + w.ox * dir, y: centerOffset.y + w.oy },
      bodyB: wheel,
      stiffness: 0.9, length: 0,
    }));
    wheels.push({
      body: wheel, speed: w.speed, r: w.r,
      contactDps: (WHEELS[w.type].contactDps || 0) * partMult(w.part),
      contactLast: 0,
    });
  });
  Composite.add(engine.world, [chassis, ...wheels.map(w => w.body), ...axles]);

  // gadgets passifs du catalogue : pointes, boost d'attaque, blindage réactif
  let thorns = 0, gadgetDmg = 1, dmgTaken = 1;
  for (const g of lo.gadgets) {
    const d = partDef(g);
    if (d.thorns) thorns += d.thorns;          // dégâts/s renvoyés au contact
    if (d.dmgBoost) gadgetDmg *= 1 + d.dmgBoost;   // dégâts infligés ×(1+x)
    if (d.dmgReduce) dmgTaken *= 1 - d.dmgReduce;  // dégâts subis ×(1-x)
  }

  const maxHp = Math.round(spec.stats.hp * statBoost * mods.hp);
  return {
    team, name, dir, spec, chassis, wheels, axles, group,
    centerOffset,
    hp: maxHp, maxHp,
    heal: spec.stats.heal,
    boost: spec.stats.hasBooster, backpedal: spec.stats.hasBackpedal,
    dmgMult: (dmgBoost ?? statBoost) * gadgetDmg,
    dmgTaken, thorns,
    hitFlash: 0,
    copilot,
    meleeMult: mods.melee, rangedMult: mods.ranged, speedMult: mods.speed,
    cdMult: 1, frenzyUntil: -1, copilotUsed: false,
    weaponTimers: spec.weapons.map(() => 0),
    chargeTimers: spec.weapons.map(() => 0),
    meleeLast: spec.weapons.map(() => 0),
    boostTimer: 1.2,
    flipTimer: 0,
    dead: false,
    z: team === 0 ? 0.55 : -0.55,
    model: null, yaw: null,
  };
}

// Position monde 2D d'un point local (repère châssis avant création).
function worldPoint(car, lx, ly) {
  const a = car.chassis.angle;
  const px = car.centerOffset.x + lx * car.dir, py = car.centerOffset.y + ly;
  return {
    x: car.chassis.position.x + px * Math.cos(a) - py * Math.sin(a),
    y: car.chassis.position.y + px * Math.sin(a) + py * Math.cos(a),
  };
}

// ---------- scène 3D ----------
function buildScene(battle, themeIndex = 0) {
  const theme = ARENA_THEMES[Math.min(themeIndex, ARENA_THEMES.length - 1)];
  const scene = new THREE.Scene();
  scene.background = skyTexture(theme);
  scene.fog = new THREE.Fog(theme.fog, 33.5, 56);

  // éclairage cartoon : une ambiance + un soleil, les aplats font le reste
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(6, 14, 9);
  scene.add(sun);

  battle.env = createArena(scene, ARENA_W, theme);
  addSkyDecor(scene, theme); // soleil + nuages en plans 3D nets

  // meshes du terrain (alignés sur les corps statiques Matter)
  // terrain : version « jouet » — collines en herbe foncée, rampes claires, contour d'encre
  // le terrain est l'ancre sombre de l'image : c'est lui qui empêche le combat
  // de flotter dans une purée pâle une fois le décor lavé
  const hillColor = new THREE.Color(theme.ground).multiplyScalar(0.66).getHex();
  const rampColor = new THREE.Color(theme.track).lerp(new THREE.Color(0xffffff), 0.25).getHex();
  const inkMat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
  const addWithOutline = (mesh, geoBig) => {
    scene.add(mesh);
    const shell = new THREE.Mesh(geoBig, inkMat);
    shell.position.copy(mesh.position);
    shell.rotation.copy(mesh.rotation);
    scene.add(shell);
  };

  // décor « samedi matin » des collines : glaçage à pois, vibreur de crête, touffes.
  // UNE texture et UN modèle de touffe par buildScene, partagés entre les collines.
  const hillLight = new THREE.Color(hillColor).lerp(new THREE.Color(0xffffff), 0.16);
  let hillFaceTex = null;
  const hillFaceTexture = () => {
    if (hillFaceTex) return hillFaceTex;
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const x = c.getContext('2d');
    x.fillStyle = '#' + hillLight.getHexString();
    x.fillRect(0, 0, 256, 256);
    // 6 pois un ton plus foncé que la colline
    x.fillStyle = '#' + new THREE.Color(hillColor).multiplyScalar(0.85).getHexString();
    for (const [px, py] of [[42, 58], [148, 36], [222, 118], [70, 172], [182, 204], [120, 108]]) {
      x.beginPath();
      x.ellipse(px, py, 14, 14, 0, 0, Math.PI * 2);
      x.fill();
    }
    // 3 fleurs : 5 pétales crème autour d'un cœur jaune
    for (const [fx, fy] of [[96, 152], [204, 60], [58, 226]]) {
      x.fillStyle = '#FFF6E0';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        x.beginPath();
        x.arc(fx + Math.cos(a) * 9, fy + Math.sin(a) * 9, 8, 0, Math.PI * 2);
        x.fill();
      }
      x.fillStyle = '#FFB800';
      x.beginPath();
      x.arc(fx, fy, 5, 0, Math.PI * 2);
      x.fill();
    }
    hillFaceTex = new THREE.CanvasTexture(c);
    hillFaceTex.colorSpace = THREE.SRGBColorSpace;
    return hillFaceTex;
  };
  let tuftModel = null;
  const tuftTemplate = () => {
    if (tuftModel) return tuftModel;
    tuftModel = new THREE.Group();
    const tuftGeo = new THREE.ConeGeometry(0.10, 0.26, 5);
    const tuftMat = toonMat(new THREE.Color(theme.ground).multiplyScalar(0.7));
    [-0.35, 0, 0.35].forEach((lean, i) => {
      const blade = new THREE.Mesh(tuftGeo, tuftMat);
      blade.position.set((i - 1) * 0.07, 0.08, 0);
      blade.rotation.z = lean;
      tuftModel.add(blade);
    });
    return tuftModel;
  };

  for (const t of battle.terrain) {
    if (t.type === 'bump') {
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(t.r * S, t.r * S, 6, 36), toonMat(hillColor));
      cyl.rotation.x = Math.PI / 2;
      cyl.position.set(to3x(t.x), to3y(GROUND_Y + t.r - t.drop), 0);
      addWithOutline(cyl, new THREE.CylinderGeometry(t.r * S + 0.07, t.r * S + 0.07, 6.06, 36));
      const R = t.r * S, C = cyl.position;
      // glaçage : pastille claire à pois posée au-dessus du cap de la coque d'encre (z=3.03)
      const icing = new THREE.Mesh(
        new THREE.CircleGeometry(R - 0.12, 36),
        new THREE.MeshToonMaterial({ color: hillLight, gradientMap: toonGradient(), map: hillFaceTexture() })
      );
      icing.position.set(C.x, C.y, 3.06);
      scene.add(icing);
      // vibreur de crête : arc damier rouge/crème centré au sommet
      const kerb = new THREE.Mesh(
        new THREE.TorusGeometry(R + 0.02, 0.10, 8, 48, Math.PI * 0.5),
        new THREE.MeshBasicMaterial({ map: kerbTexture(8) })
      );
      kerb.rotation.z = Math.PI / 4;
      kerb.position.set(C.x, C.y, 3.0);
      scene.add(kerb);
      // touffes d'herbe plantées sur la crête (angles depuis la verticale)
      for (const a of [-0.5, 0.15, 0.7]) {
        const tuft = tuftTemplate().clone();
        tuft.position.set(C.x + Math.sin(a) * R, C.y + Math.cos(a) * R, 2.6);
        tuft.rotation.z = -a;
        scene.add(tuft);
      }
    } else if (t.type === 'plateau') {
      const box = new THREE.Mesh(new THREE.BoxGeometry(t.w * S, t.h * S + 0.3, 6), toonMat(rampColor));
      box.position.set(to3x(t.x), to3y(GROUND_Y - t.h / 2) - 0.1, 0);
      addWithOutline(box, new THREE.BoxGeometry(t.w * S + 0.12, t.h * S + 0.42, 6.06));
      const edge = new THREE.Mesh(new THREE.BoxGeometry(t.w * S, 0.07, 6.1), edgeMat);
      edge.position.set(to3x(t.x), to3y(GROUND_Y - t.h) + 0.03, 0);
      scene.add(edge);
    } else { // ramp
      const lift = Math.abs(Math.sin(t.angle)) * t.w * 0.25;
      const box = new THREE.Mesh(new THREE.BoxGeometry(t.w * S, t.h * S + 0.24, 6), toonMat(rampColor));
      box.position.set(to3x(t.x), to3y(GROUND_Y - t.h / 2 - lift) - 0.08, 0);
      box.rotation.z = -t.angle;
      addWithOutline(box, new THREE.BoxGeometry(t.w * S + 0.12, t.h * S + 0.36, 6.06));
      const edge = new THREE.Mesh(new THREE.BoxGeometry(t.w * S, 0.07, 6.1), edgeMat);
      edge.position.set(to3x(t.x), to3y(GROUND_Y - t.h / 2 - lift) - 0.08 + (t.h * S + 0.24) / 2, 0);
      edge.rotation.z = -t.angle;
      scene.add(edge);
    }
  }

  // collines-boules d'horizon : cassent la ligne sol/ciel devant la skyline
  const hillBallGeo = new THREE.SphereGeometry(6, 16, 10);
  const hillBallMat = new THREE.MeshToonMaterial({
    color: new THREE.Color(theme.ground).lerp(new THREE.Color(theme.fog), 0.5),
    gradientMap: toonGradient(),
  });
  for (const hx of [-23, -12.4, -4.8, 5.9, 13.2, 24]) {
    const ball = new THREE.Mesh(hillBallGeo, hillBallMat);
    ball.scale.set(1.6, 0.5, 1);
    ball.position.set(hx, 0, -28);
    scene.add(ball);
  }

  // véhicules
  for (const car of battle.cars) {
    const model = createCarModel(car.spec);
    const yaw = new THREE.Group();
    yaw.rotation.y = car.dir === 1 ? 0 : Math.PI;
    yaw.add(model.userData.bodyGroup);
    scene.add(yaw);
    car.model = model.userData;
    car.yaw = yaw;
    for (const wm of car.model.wheelMeshes) scene.add(wm);
    car.blob = model.userData.blob;
    scene.add(car.blob);
    // en combat, les armes tournent : leurs disques de flou deviennent visibles
    car.yaw.traverse(o => { if (o.name === 'spinblur') o.visible = true; });
  }

  // murs de la mort
  battle.wall3L = createDeathWall(1);
  battle.wall3R = createDeathWall(-1);
  scene.add(battle.wall3L, battle.wall3R);

  // lumière de flash des explosions
  battle.flash = new THREE.PointLight(0xffb060, 0, 30);
  scene.add(battle.flash);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 160);
  camera.position.set(0, 2.6, 12);
  battle.scene = scene;
  battle.camera = camera;
  // départ large : le dolly-in pendant le compte à rebours sert d'intro
  battle.camX = 0; battle.camDist = 30; battle.camLookY = 4.5;
  battle.baseFov = 42; battle.tanV = Math.tan(21 * Math.PI / 180); battle.tanH = battle.tanV * 0.46;
  // masses floues aux bords du cadre — enfants de la caméra, donc solidaires
  // du zoom : elles ferment la composition à tous les niveaux de dézoom
  battle.fgProps = addForegroundProps(scene, camera);

  // post-processing : bloom léger (lasers, phares, explosions, néons)
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // seuil 1.02 : au-dessus de tout ce qui n'est pas HDR — seuls les phares, lasers,
  // flashs et bursts additifs bloomant vraiment (le crème #FFF6E0 vaut 0.926 de luma)
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.80, 0.7, 1.02);
  composer.addPass(bloom);
  const output = new OutputPass();
  composer.addPass(output);
  battle.composer = composer;
  battle.bloomPass = bloom;
  battle.outputPass = output;
}

// ---------- onomatopées cartoon : mots sur étoile-explosion ----------
const WORD_TEX = {};
// Couleurs par onomatopée (bible graphique) : étoile teintée + texte contrasté.
const WORD_STYLE = {
  'BAM !': ['#FFB800', '#26183A'],
  'KRAK !!': ['#FF4D5E', '#FFF6E0'],
  'CLANG !': ['#49C4F0', '#26183A'],
  'BOOM !': ['#A66CFF', '#FFF6E0'],
  'PAF !': ['#2FD573', '#26183A'],
};
function wordTexture(word) {
  if (WORD_TEX[word]) return WORD_TEX[word];
  const [starFill, txtFill] = WORD_STYLE[word] || ['#FFB800', '#26183A'];
  const c = document.createElement('canvas');
  c.width = 320; c.height = 220;
  const x = c.getContext('2d');
  x.translate(160, 110);
  x.rotate(-0.09);
  // étoile-explosion 12 branches
  x.fillStyle = starFill;
  x.strokeStyle = '#26183A';
  x.lineWidth = 7;
  x.beginPath();
  for (let i = 0; i < 24; i++) {
    const a2 = (i / 24) * Math.PI * 2;
    const rr = i % 2 ? 62 : 100;
    x.lineTo(Math.cos(a2) * rr * 1.35, Math.sin(a2) * rr * 0.82);
  }
  x.closePath();
  x.fill(); x.stroke();
  // le mot
  x.font = "800 56px 'Baloo 2', sans-serif";
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.strokeStyle = '#26183A'; x.lineWidth = 10; x.lineJoin = 'round';
  x.strokeText(word, 0, 2);
  x.fillStyle = txtFill;
  x.fillText(word, 0, 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.shared = true;
  WORD_TEX[word] = tex;
  return tex;
}

function spawnWord(battle, x2, y2, z, word) {
  // soustractif : jamais deux onomatopées coup sur coup, jamais plus de 2 à l'écran,
  // et toujours décalées HORS des machines — le duel doit rester visible
  if (battle.time - (battle.wordLast ?? -9) < 0.45) return;
  battle.wordLast = battle.time;
  while (battle.words.length >= 2) {
    const old = battle.words.shift();
    battle.scene.remove(old.sprite);
    old.sprite.material.dispose();
  }
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: wordTexture(word), transparent: true, depthWrite: false,
  }));
  const side = to3x(x2) < battle.camX ? -1 : 1;
  sprite.position.set(to3x(x2) + side * 1.0, to3y(y2) + 1.5, z + 1.2);
  sprite.scale.setScalar(0.001);
  battle.scene.add(sprite);
  battle.words.push({ sprite, life: 0.55, maxLife: 0.55 });
}

// ---------- effets : jets de particules (un burst = un THREE.Points) ----------
// Pool de matériaux réutilisés (clé couleur:taille) : burst() est appelé jusqu'à
// ~35x/s, créer un PointsMaterial à chaque fois mettait le GC sous pression.
// L'opacité étant animée par burst, on recycle au lieu de partager.
const BURST_MAT_POOL = new Map();
function acquireBurstMat(color, size) {
  const key = color + ':' + size;
  const pool = BURST_MAT_POOL.get(key);
  if (pool && pool.length) {
    const mtl = pool.pop();
    mtl.opacity = 1;
    return mtl;
  }
  const mtl = new THREE.PointsMaterial({
    color, size, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  mtl.userData.burstKey = key;
  return mtl;
}
function releaseBurstMat(mtl) {
  let pool = BURST_MAT_POOL.get(mtl.userData.burstKey);
  if (!pool) BURST_MAT_POOL.set(mtl.userData.burstKey, pool = []);
  if (pool.length < 16) pool.push(mtl);
  else mtl.dispose();
}

function burst(battle, x2, y2, z, n, color, opt = {}) {
  const pos = new Float32Array(n * 3);
  const vel = [];
  const x3 = to3x(x2), y3 = to3y(y2);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = x3; pos[i * 3 + 1] = y3; pos[i * 3 + 2] = z;
    const a = Math.random() * Math.PI * 2;
    const sp = (opt.speed || 3.2) * (0.4 + Math.random());
    vel.push(new THREE.Vector3(Math.cos(a) * sp, Math.abs(Math.sin(a)) * sp * 0.9 + 1.2, (Math.random() - 0.5) * sp * 0.7));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mtl = acquireBurstMat(color, opt.size || 0.14);
  const points = new THREE.Points(geo, mtl);
  battle.scene.add(points);
  battle.bursts.push({ points, vel, life: opt.life || 0.6, maxLife: opt.life || 0.6, grav: opt.grav ?? 7 });
}

function shockwave(battle, x2, y2, z, color = 0xffb040) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.28, 0.5, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  ring.position.set(to3x(x2), to3y(y2), z + 0.6);
  battle.scene.add(ring);
  battle.waves.push({ ring, life: 0.4 });
}

function flashLight(battle, x2, y2, intensity = 60) {
  battle.flash.position.set(to3x(x2), to3y(y2) + 0.6, 2.5);
  battle.flash.intensity = intensity;
}

// Marque de brûlure persistante au sol : l'arène garde les cicatrices du combat.
function addScorch(battle, x2) {
  battle.scorchN = (battle.scorchN || 0) + 1;
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(0.6 + Math.random() * 0.4, 16),
    new THREE.MeshBasicMaterial({ color: 0x26183A, transparent: true, opacity: 0.35, depthWrite: false })
  );
  mesh.rotation.x = -Math.PI / 2;
  // léger décalage vertical par marque pour éviter le z-fighting
  mesh.position.set(to3x(x2), 0.02 + (battle.scorchN % 12) * 0.001, 0);
  battle.scene.add(mesh);
  battle.scorch.push({ mesh, life: 10 });
  if (battle.scorch.length > 12) { // cap : la plus vieille disparaît
    const old = battle.scorch.shift();
    battle.scene.remove(old.mesh);
    old.mesh.geometry.dispose();
    old.mesh.material.dispose();
  }
}

// ---------- combat ----------
export function startBattle(config) {
  const { playerLoadout, opponent, onEnd, copilot = null, themeIndex = 0, playerBoost = 1, playerDmgBoost = null, mutator = null } = config;
  const canvas = document.getElementById('battle-canvas');
  // antialias inutile : le rendu passe par l'EffectComposer (le MSAA ne s'applique pas)
  if (!renderer) renderer = createRenderer(canvas, { antialias: false });

  const engine = Engine.create();
  engine.gravity.y = mutator?.key === 'lowgrav' ? 0.45 : (mutator?.key === 'heavy' ? 1.6 : 1);

  const ground = Bodies.rectangle(ARENA_W / 2, GROUND_Y + 40, ARENA_W * 3, 80, { isStatic: true, label: 'ground', friction: 0.9 });
  const wallL = Bodies.rectangle(-30, GROUND_Y - 300, 60, 700, { isStatic: true, label: 'wall:L' });
  const wallR = Bodies.rectangle(ARENA_W + 30, GROUND_Y - 300, 60, 700, { isStatic: true, label: 'wall:R' });
  Composite.add(engine.world, [ground, wallL, wallR]);

  // terrain de la ligue (collines/tremplins/podium)
  const terrain = TERRAINS[Math.min(themeIndex, TERRAINS.length - 1)] || [];
  for (const t of terrain) {
    let body;
    if (t.type === 'bump') {
      body = Bodies.circle(t.x, GROUND_Y + t.r - t.drop, t.r, { isStatic: true, label: 'ground', friction: 0.9 });
    } else if (t.type === 'plateau') {
      body = Bodies.rectangle(t.x, GROUND_Y - t.h / 2, t.w, t.h, { isStatic: true, label: 'ground', friction: 0.9 });
    } else { // ramp
      const lift = Math.abs(Math.sin(t.angle)) * t.w * 0.25;
      body = Bodies.rectangle(t.x, GROUND_Y - t.h / 2 - lift, t.w, t.h, { isStatic: true, angle: t.angle, label: 'ground', friction: 0.9 });
    }
    Composite.add(engine.world, body);
  }

  const me = makeCar(engine, playerLoadout, {
    x: 390, dir: 1, team: 0, name: 'Toi', copilot,
    statBoost: playerBoost, dmgBoost: playerDmgBoost ?? playerBoost,
  });
  const foe = makeCar(engine, opponent.loadout, {
    x: ARENA_W - 390, dir: -1, team: 1, name: opponent.name,
    statBoost: opponent.statBoost, dmgBoost: opponent.dmgBoost,
  });

  const battle = {
    engine, canvas, cars: [me, foe], ground, wallL, wallR, terrain,
    projectiles: [], beams: [], bursts: [], waves: [], floaters: [], debris: [], words: [], scorch: [],
    time: -3.2, wallsDeadly: false,
    shake: 0, slowmo: 1, hitStop: 0, acc: 0, sdt: 0,
    // pipeline caméra : impulsions accumulées, décrues chaque frame
    roll: 0, rollKick: 0, kickX: 0, fovKick: 0, menace: 0, shakeAng: 0,
    focusX: 0, focusT: 0, clashLast: -9, clashCount: 0,
    ghostL: 100, ghostR: 100, ghostHoldL: 0, ghostHoldR: 0,
    finished: false, raf: 0, lastMsg: '',
    result: null, endTimer: 0,
    overlay: document.getElementById('battle-overlay'),
  };
  current = battle;
  if (localStorage.getItem('maks_debug')) { window.__battle = battle; battle.renderer = renderer; }

  // mutateurs du Défi du jour (appliqués aux DEUX camps, équitable)
  battle.mutator = mutator;
  if (mutator) {
    for (const car of battle.cars) {
      if (mutator.key === 'turbo') car.speedMult *= 1.6;
      if (mutator.key === 'glass') car.dmgMult *= 1.8;
      if (mutator.key === 'rockets') car.cdMult *= 0.4;
      if (mutator.key === 'bouncy') {
        car.chassis.restitution = 0.85;
        for (const w of car.wheels) w.body.restitution = 0.85;
      }
    }
  }
  buildScene(battle, themeIndex);

  Events.on(engine, 'collisionActive', ev => {
    for (const pair of ev.pairs) {
      handleMeleePair(battle, pair);
      handleSpikePair(battle, pair); // roues cloutées : dégâts de contact
      handleWallPair(battle, pair); // un véhicule déjà collé au mur doit mourir aussi
    }
  });
  Events.on(engine, 'collisionStart', ev => {
    for (const pair of ev.pairs) {
      handleProjectilePair(battle, pair);
      handleClashPair(battle, pair);
      handleWallPair(battle, pair);
    }
  });

  resize(battle);
  window.addEventListener('resize', battle.onResize = () => resize(battle));

  let last = performance.now();
  const loop = now => {
    battle.raf = requestAnimationFrame(loop);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    step(battle, dt, onEnd);
    if (current === battle) render(battle, now / 1000, dt);
  };
  battle.raf = requestAnimationFrame(loop);
  return battle;
}

export function stopBattle() {
  if (!current) return;
  cancelAnimationFrame(current.raf);
  window.removeEventListener('resize', current.onResize);
  stopBattleAudio();
  stopMusic();
  Events.off(current.engine);
  Composite.clear(current.engine.world, false);
  Engine.clear(current.engine);
  // libère TOUTES les ressources GPU de la scène (le bloom alloue ~11 render
  // targets que composer.dispose() ne touche pas)
  current.bloomPass?.dispose();
  current.outputPass?.dispose();
  current.composer?.dispose();
  current.scene.background?.dispose?.();
  disposeModel(current.scene, { textures: true });
  current.scene.clear();
  current = null;
}

function carOfLabel(battle, label) {
  if (!label) return null;
  const m = label.match(/^(chassis|weapon|wheel):(\d)/);
  return m ? battle.cars[+m[2]] : null;
}

function handleMeleePair(battle, pair) {
  if (battle.time < 0 || battle.finished) return;
  for (const [a, b] of [[pair.bodyA, pair.bodyB], [pair.bodyB, pair.bodyA]]) {
    const m = a.label && a.label.match(/^weapon:(\d):(\d+)$/);
    if (!m) continue;
    const owner = battle.cars[+m[1]];
    const target = carOfLabel(battle, b.label);
    if (!target || target === owner || target.dead) continue;
    const wIdx = +m[2];
    const wp = owner.spec.weapons[wIdx];
    if (wp.kind !== 'melee') continue;
    if (battle.time - owner.meleeLast[wIdx] >= MELEE_TICK) {
      owner.meleeLast[wIdx] = battle.time;
      // Tigrou : frénésie au premier coup porté
      if (owner.copilot === 'tigrou' && !owner.copilotUsed) {
        owner.copilotUsed = true;
        owner.frenzyUntil = battle.time + 4;
        showToast(battle, 'Tigrou enrage ! Dégâts ×1,5');
      }
      const frenzy = battle.time < owner.frenzyUntil ? 1.5 : 1;
      // dmgMult de l'attaquant appliqué dans applyDamage (centralisé)
      const dmg = wp.def.dps * wp.mult * MELEE_TICK * owner.meleeMult * frenzy;
      const at = pair.collision.supports[0] || target.chassis.position;
      applyDamage(battle, target, dmg, at, owner);
      // pointes défensives : l'attaquant se blesse au même tick de contact
      if (target.thorns) {
        applyDamage(battle, owner, target.thorns * MELEE_TICK, at);
      }
      burst(battle, at.x, at.y, target.z, 7, 0xffd060, { speed: 3.6, size: 0.1, life: 0.45 });
      if (wp.def.push) {
        Body.setVelocity(target.chassis, { x: target.chassis.velocity.x + owner.dir * 2.2, y: target.chassis.velocity.y - 0.6 });
      }
      // chaque coup de mêlée a du poids : micro-accroc + kick caméra + haptique
      hitStop(battle, 0.035, 0.15);
      battle.kickX += owner.dir * 0.09;
      if (target.team === 0 && battle.time - (battle.lastVibe || 0) > 0.15) {
        navigator.vibrate?.(15);
        battle.lastVibe = battle.time;
      }
      sfxHit();
    }
  }
}

// Clash mêlée contre mêlée : les armes s'entrechoquent, les machines reculent.
function handleClashPair(battle, pair) {
  if (battle.time < 0 || battle.finished) return;
  const ma = pair.bodyA.label?.match(/^weapon:(\d):(\d+)$/);
  const mb = pair.bodyB.label?.match(/^weapon:(\d):(\d+)$/);
  if (!ma || !mb || ma[1] === mb[1]) return;
  const carA = battle.cars[+ma[1]], carB = battle.cars[+mb[1]];
  const wa = carA.spec.weapons[+ma[2]], wb = carB.spec.weapons[+mb[2]];
  if (wa.kind !== 'melee' || wb.kind !== 'melee') return;
  if (Vector.magnitude(Vector.sub(pair.bodyA.velocity, pair.bodyB.velocity)) < 3.5) return;
  if (battle.time - battle.clashLast < 0.9) return;
  battle.clashLast = battle.time;
  battle.clashCount++;
  const sup = pair.collision.supports[0] || carA.chassis.position;
  hitStop(battle, 0.11, 0.04);
  battle.shake = Math.max(battle.shake, 13);
  battle.rollKick += 0.06;
  burst(battle, sup.x, sup.y, 0, 26, 0xfff2b0, { speed: 6.5, size: 0.11, life: 0.5 });
  shockwave(battle, sup.x, sup.y, 0, 0xffffff);
  for (const car of [carA, carB]) {
    Body.setVelocity(car.chassis, { x: car.chassis.velocity.x - car.dir * 3.4, y: -1.6 });
  }
  sfxClang();
  spawnWord(battle, sup.x, sup.y - 30, 0, 'CLANG !');
}

// Roues cloutées : elles mordent tout ce qu'elles touchent chez l'adversaire.
function handleSpikePair(battle, pair) {
  if (battle.time < 0 || battle.finished) return;
  for (const [a, b] of [[pair.bodyA, pair.bodyB], [pair.bodyB, pair.bodyA]]) {
    const m = a.label && a.label.match(/^wheel:(\d):(\d+)$/);
    if (!m) continue;
    const owner = battle.cars[+m[1]];
    const wheel = owner && owner.wheels[+m[2]];
    if (!wheel || !wheel.contactDps) continue;
    const target = carOfLabel(battle, b.label);
    if (!target || target === owner || target.dead) continue;
    if (battle.time - wheel.contactLast < MELEE_TICK) continue;
    wheel.contactLast = battle.time;
    const at = pair.collision.supports[0] || target.chassis.position;
    applyDamage(battle, target, wheel.contactDps * MELEE_TICK, at, owner);
    burst(battle, at.x, at.y, target.z, 4, 0xd8dce8, { speed: 2.6, size: 0.08, life: 0.3 });
    sfxHit();
  }
}

function handleProjectilePair(battle, pair) {
  for (const [a, b] of [[pair.bodyA, pair.bodyB], [pair.bodyB, pair.bodyA]]) {
    const proj = battle.projectiles.find(p => p.body === a && !p.hit);
    if (!proj) continue;
    proj.hit = true;
    const target = carOfLabel(battle, b.label);
    const pos = proj.body.position;
    if (proj.type === 'rocket') {
      sfxBoom(false);
      burst(battle, pos.x, pos.y, proj.z, 26, 0xff9040, { speed: 5, size: 0.16, life: 0.7 });
      burst(battle, pos.x, pos.y, proj.z, 12, 0xffd060, { speed: 3, size: 0.12, life: 0.5 });
      shockwave(battle, pos.x, pos.y, proj.z);
      flashLight(battle, pos.x, pos.y, 70);
      addScorch(battle, pos.x); // l'explosion marque le sol
      battle.shake = Math.max(battle.shake, 8);
      hitStop(battle, 0.07, 0.05); // micro-freeze : l'impact se sent
      battle.rollKick += 0.055 * (to3x(pos.x) < battle.camX ? -1 : 1);
      battle.fovKick = 6; // punch de focale
      spawnWord(battle, pos.x, pos.y - 30, proj.z, 'BOOM !');
      for (const car of battle.cars) {
        if (car === proj.owner || car.dead) continue;
        const d = Vector.magnitude(Vector.sub(car.chassis.position, pos));
        if (target === car || d < 110) {
          applyDamage(battle, car, proj.dmg, pos, proj.owner);
          Body.setVelocity(car.chassis, { x: car.chassis.velocity.x + proj.owner.dir * 1.5, y: car.chassis.velocity.y - 1 });
        }
      }
    } else if (target && target !== proj.owner && !target.dead) {
      applyDamage(battle, target, proj.dmg, pos, proj.owner);
      burst(battle, pos.x, pos.y, proj.z, 4, 0xffe080, { speed: 2.4, size: 0.09, life: 0.35 });
      // l'impact de balle se sent : son + onomatopée occasionnelle
      sfxHit();
      if (Math.random() < 0.25) spawnWord(battle, pos.x, pos.y - 30, proj.z, 'PAF !');
    }
  }
}

function handleWallPair(battle, pair) {
  if (!battle.wallsDeadly || battle.finished) return;
  for (const [a, b] of [[pair.bodyA, pair.bodyB], [pair.bodyB, pair.bodyA]]) {
    if (!(a.label && a.label.startsWith('wall:'))) continue;
    const car = carOfLabel(battle, b.label);
    if (car && !car.dead) killCar(battle, car, 'mur');
  }
}

function applyDamage(battle, car, dmg, at, attacker = null) {
  if (car.dead || (battle.finished && battle.endTimer > 0.4)) return;
  // multiplicateurs : boost de l'attaquant (statBoost, gadgets, mutateurs)
  // et réduction de la victime (gadget blindage réactif)
  if (attacker) dmg *= attacker.dmgMult;
  if (car.dmgTaken != null) dmg *= car.dmgTaken;
  car.hp -= dmg;
  car.hitFlash = 0.14; // flash rouge du véhicule touché
  // mutateur vampire : l'attaquant récupère 30 % des dégâts infligés
  if (battle.mutator?.key === 'vampire' && attacker && !attacker.dead) {
    attacker.hp = Math.min(attacker.maxHp, attacker.hp + dmg * 0.3);
  }
  // le commentateur s'enflamme au premier sang
  if (!battle.firstBlood) {
    battle.firstBlood = true;
    showToast(battle, 'PREMIER SANG !');
  }
  const crit = dmg >= 25;
  // un SEUL chiffre par machine qui cumule : deux tics de mêlée ne font pas deux nombres
  const prev = car.dmgFloater;
  if (prev && prev.life > 0 && battle.time - prev.born < 0.30) {
    prev.amount += dmg;
    const tot = Math.max(1, Math.round(prev.amount));
    prev.text = '-' + tot;
    prev.scale = Math.max(prev.scale, tot >= 25 ? 2.4 : 1.7);
    prev.color = tot >= 25 ? '#FFB800' : '#FF4D5E';
    prev.life = Math.max(prev.life, 0.7);
  } else {
    const f = {
      x: at.x + (Math.random() - 0.5) * 20, y: at.y - 30, z: car.z,
      vy: -90, life: 0.85, text: '-' + Math.max(1, Math.round(dmg)),
      scale: crit ? 2.4 : 1.7, // pope puis se stabilise
      color: crit ? '#FFB800' : '#FF4D5E',
      amount: dmg, born: battle.time,
    };
    battle.floaters.push(f);
    car.dmgFloater = f;
  }
  if (crit) {
    shockwave(battle, at.x, at.y, car.z, 0xffd23e);
    spawnWord(battle, at.x, at.y - 40, car.z, 'BAM !');
  }
  // dutch angle sur les gros impacts
  if (dmg > 14) battle.rollKick += 0.055 * (to3x(at.x) < battle.camX ? -1 : 1);
  // flash de douleur sur la barre de PV du HUD
  const bar = document.getElementById(car.team === 0 ? 'hp-l' : 'hp-r')?.parentElement;
  if (bar) {
    bar.classList.remove('hurt');
    void bar.offsetWidth;
    bar.classList.add('hurt');
  }
  // « dernier souffle » : slow-mo dramatique la première fois sous 15% de PV
  if (!car.lastStand && car.hp > 0 && car.hp < car.maxHp * 0.15) {
    car.lastStand = true;
    hitStop(battle, 0.75, 0.32);
    battle.rollKick += 0.05;
    crowdExcite(1);
    battle.focusX = to3x(car.chassis.position.x);
    battle.focusT = 0.75;
    showToast(battle, car.team === 0 ? 'TIENS BON !' : 'ACHÈVE-LE !');
  }
  if (car.hp <= 0) killCar(battle, car, 'détruit');
}

// Micro-freeze d'impact ; le slowmo est restauré à la fin dans step().
function hitStop(battle, duration, factor) {
  battle.hitStop = Math.max(battle.hitStop, duration);
  battle.slowmo = Math.min(battle.slowmo, factor);
}

// Débris de carrosserie projetés au KO (animés à la main, hors physique 2D).
function spawnDebris(battle, car) {
  const debrisMat = toonMat(car.model.bodyMat.color.getHex());
  const darkMat = toonMat(0x3a3f55);
  const p = car.chassis.position;
  for (let i = 0; i < 12; i++) {
    const s = 0.1 + Math.random() * 0.2;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(s, s * (0.5 + Math.random()), s),
      i % 3 === 0 ? darkMat : debrisMat
    );
    mesh.position.set(to3x(p.x), to3y(p.y), car.z + (Math.random() - 0.5) * 0.8);
    battle.scene.add(mesh);
    const a = Math.random() * Math.PI * 2;
    battle.debris.push({
      mesh,
      vel: new THREE.Vector3(Math.cos(a) * (2 + Math.random() * 5), 4 + Math.random() * 5, (Math.random() - 0.5) * 3),
      rot: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
      life: 2.5,
    });
  }
  // les 2 matériaux partagés sont libérés avec le dernier débris expiré
  battle.debris[battle.debris.length - 1].mats = [debrisMat, darkMat];
}

function killCar(battle, car, cause) {
  if (car.dead || battle.finished) return;
  car.dead = true;
  car.hp = Math.max(0, car.hp);
  sfxBoom(true);
  battle.shake = 22;
  hitStop(battle, 0.12, 0.02);
  const p = car.chassis.position;
  burst(battle, p.x, p.y, car.z, 46, 0xff8040, { speed: 7, size: 0.2, life: 1.0, grav: 5 });
  burst(battle, p.x, p.y, car.z, 30, 0xffd060, { speed: 5, size: 0.14, life: 0.8 });
  burst(battle, p.x, p.y, car.z, 18, 0xffffff, { speed: 3, size: 0.1, life: 0.5 });
  shockwave(battle, p.x, p.y, car.z, 0xff5030);
  flashLight(battle, p.x, p.y, 160);
  spawnDebris(battle, car);
  for (const a of car.axles) Composite.remove(battle.engine.world, a);
  for (const w of car.wheels) Body.setVelocity(w.body, { x: (Math.random() - 0.5) * 14, y: -8 - Math.random() * 5 });
  Body.setVelocity(car.chassis, { x: car.chassis.velocity.x, y: -7 });
  Body.setAngularVelocity(car.chassis, (Math.random() - 0.5) * 0.4);

  battle.finished = true;
  battle.slowmo = 0.25;
  battle.endTimer = 1.7;
  addScorch(battle, p.x); // l'épave marque le sol
  // punch-in caméra : focus sur l'épave + coup de focale inversé (dolly-in)
  battle.focusX = to3x(p.x);
  battle.focusT = 1.7;
  battle.fovKick = -8;
  const playerWon = car.team === 1;
  battle.result = {
    win: playerWon,
    reason: cause === 'mur' ? 'Écrasé par le mur !' : (cause === 'retourné' ? 'KO — retourné !' : 'Destruction totale !'),
  };
  showMsg(battle, playerWon ? 'K.O. !' : 'PERDU…');
  // punchline du commentateur
  const LINES = ['QUEL CARNAGE !', 'DÉMOLITION TOTALE !', 'ADIEU LA CARROSSERIE !', 'ÇA VA LAISSER DES TRACES !', 'ET ÇA REPART EN CROQUETTES !'];
  showToast(battle, LINES[Math.floor(Math.random() * LINES.length)]);
  spawnWord(battle, p.x, p.y - 50, car.z, 'KRAK !!');
}

function showToast(battle, text) {
  battle.wordLast = battle.time + 0.3; // toast et onomatopée ne tombent jamais ensemble
  const el = document.getElementById('battle-toast');
  el.textContent = text;
  el.classList.remove('hidden');
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  clearTimeout(battle.toastTimer);
  battle.toastTimer = setTimeout(() => el.classList.add('hidden'), 1100);
}

function showMsg(battle, text) {
  const el = document.getElementById('battle-msg');
  if (battle.lastMsg === text) return;
  battle.lastMsg = text;
  el.textContent = text;
  el.classList.remove('hidden');
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  if (text === '') el.classList.add('hidden');
}

// ---------- boucle de simulation (identique à la version 2D, physique inchangée) ----------
function step(battle, dt, onEnd) {
  const { engine, cars } = battle;
  const prev = battle.time;
  battle.time += dt;

  // fin du micro-freeze d'impact
  if (battle.hitStop > 0) {
    battle.hitStop -= dt;
    if (battle.hitStop <= 0) battle.slowmo = battle.finished ? 0.25 : 1;
  }

  if (battle.time < 0) {
    const n = Math.ceil(-battle.time);
    const label = n <= 3 ? String(n) : '';
    if (label && label !== battle.lastMsg) sfxCount();
    showMsg(battle, label);
    return;
  }
  if (prev < 0) {
    showMsg(battle, 'MIAOU !');
    sfxGo();
    startBattleAudio(); // foule + moteurs en continu
    startMusic('battle');
    if (battle.mutator) showToast(battle, `DÉFI : ${battle.mutator.name.toUpperCase()} !`);
    battle.shake = 6;
    for (const car of cars) {
      const back = worldPoint(car, -car.spec.body.w / 2 - 10, car.spec.body.h / 2);
      burst(battle, back.x, back.y, car.z, 10, 0x8a7fae, { speed: 2, size: 0.18, life: 0.6, grav: -1 });
    }
  }
  if (battle.time > 0.9 && battle.lastMsg === 'MIAOU !') showMsg(battle, '');

  if (battle.finished) {
    battle.endTimer -= dt;
    if (battle.endTimer <= 0) {
      const r = battle.result;
      stopBattle();
      onEnd(r);
      return;
    }
  }

  const remaining = BATTLE_TIME - battle.time;
  if (remaining <= 0 && !battle.wallsDeadly) {
    battle.wallsDeadly = true;
    showMsg(battle, 'LES MURS !');
    sfxSiren();
    // couleur des murs figée ici (une fois) ; seule l'intensité est animée ensuite
    for (const w3 of [battle.wall3L, battle.wall3R]) {
      w3.userData.wallMat.emissive.setHex(0xFFF6E0); // flash crème, lisible sur le mur POW
    }
    setTimeout(() => battle.lastMsg === 'LES MURS !' && showMsg(battle, ''), 900);
  }
  if (battle.wallsDeadly && !battle.finished) {
    const speed = 42 * dt;
    Body.setPosition(battle.wallL, { x: battle.wallL.position.x + speed, y: battle.wallL.position.y });
    Body.setPosition(battle.wallR, { x: battle.wallR.position.x - speed, y: battle.wallR.position.y });
  }

  for (const car of cars) {
    if (car.dead || battle.finished) continue;
    const enemy = cars[1 - car.team];
    updateDrive(battle, car, enemy, dt);
    updateWeapons(battle, car, enemy, dt);
    updateCopilot(battle, car, remaining);
    if (car.heal && car.hp > 0) car.hp = Math.min(car.maxHp, car.hp + car.heal * dt);
    if (Math.cos(car.chassis.angle) < -0.25) {
      car.flipTimer += dt;
      if (car.flipTimer > FLIP_TIME) killCar(battle, car, 'retourné');
    } else car.flipTimer = 0;
    // squash & stretch : détection décollage/atterrissage
    const wasAirborne = car.airborne;
    car.airborne = car.wheels.length > 0 &&
      car.wheels.every(w => w.body.position.y < GROUND_Y - w.r - 8);
    if (car.airborne) {
      car.squash = Math.max(car.squash ?? 1, 1 + Math.min(0.16, Math.abs(car.prevVy || 0) * 0.015));
    } else if (wasAirborne && (car.prevVy || 0) > 4) {
      car.squashVel = -3.5; // écrasement à l'atterrissage
      for (const w of car.wheels) {
        burst(battle, w.body.position.x, GROUND_Y - 4, car.z, 6, 0x8a7fae, { speed: 2, size: 0.16, life: 0.4 });
      }
      battle.shake = Math.max(battle.shake, Math.min(7, car.prevVy * 0.8));
      sfxHit();
    }
    car.prevVy = car.chassis.velocity.y;

    // fumée puis flammes selon les PV : l'état de la machine se lit sans HUD
    const hpRatio = car.hp / car.maxHp;
    if (hpRatio < 0.5) {
      if (!car.scarred) {
        car.scarred = true; // carrosserie ternie, une seule fois
        car.model.bodyMat?.color.multiplyScalar(0.85);
      }
      const burning = hpRatio < 0.25;
      car.smokeT = (car.smokeT ?? 0) - dt;
      if (car.smokeT <= 0) {
        car.smokeT = burning ? 0.12 : 0.3;
        const top = worldPoint(car, 0, -car.spec.body.h / 2);
        burst(battle, top.x, top.y, car.z, 1, burning ? 0xff7030 : 0x555a6e,
          { speed: 0.6, size: 0.24, life: 0.9, grav: -1.8 });
      }
      if (burning) { // étincelles épisodiques sous 25 %
        car.sparkT = (car.sparkT ?? 0) - dt;
        if (car.sparkT <= 0) {
          car.sparkT = 0.4 + Math.random() * 0.2;
          const top = worldPoint(car, 0, -car.spec.body.h / 2);
          burst(battle, top.x, top.y, car.z, 3, 0xffd060, { speed: 2.4, size: 0.09, life: 0.4 });
        }
      }
    }
  }

  // physique à pas fixe : indépendante du taux de rafraîchissement (60/120 Hz)
  const STEP = 1000 / 60;
  battle.acc += dt * 1000 * battle.slowmo;
  let iter = 0;
  while (battle.acc >= STEP && iter < 4) {
    Engine.update(engine, STEP);
    battle.acc -= STEP;
    iter++;
  }
  // les VFX vivent au même temps ralenti que la physique : pendant le slow-mo
  // de KO et les hit-stops, débris, explosions et onomatopées flottent aussi
  const sdt = dt * battle.slowmo;
  battle.sdt = sdt;
  updateEffects(battle, sdt);
  // la décrue du shake caméra reste en temps réel (sinon la caméra devient molle)
  battle.shake = Math.max(0, battle.shake - 60 * dt);
  updateHud(battle, remaining, dt);
  // le moteur ronronne selon la vitesse du joueur, la foule s'excite à la fin
  setEngineSpeed(Math.abs(cars[0].chassis.velocity.x) + Math.abs(cars[1].chassis.velocity.x));
  crowdExcite(battle.finished ? 1 : (battle.wallsDeadly ? 0.5 : 0));
}

// Capacités automatiques des co-pilotes (une fois par combat).
function updateCopilot(battle, car, remaining) {
  if (!car.copilot || car.copilotUsed) return;
  const cp = COPILOTS[car.copilot];
  if (car.copilot === 'ronron' && car.hp < car.maxHp * 0.35) {
    car.copilotUsed = true;
    const extremis = car.hp < car.maxHp * 0.12;
    const healed = Math.round(car.maxHp * 0.3);
    car.hp = Math.min(car.maxHp, car.hp + healed);
    const p = car.chassis.position;
    burst(battle, p.x, p.y - 40, car.z, 16, 0x4de08a, { speed: 2.2, size: 0.13, life: 0.8, grav: -2 });
    battle.floaters.push({ x: p.x, y: p.y - 60, z: car.z, vy: -70, life: 1, text: '+' + healed, color: '#7dffb0', scale: 1.7 });
    if (extremis) {
      hitStop(battle, 0.5, 0.3);
      shockwave(battle, p.x, p.y, car.z, 0x4de08a);
      showToast(battle, 'SAUVETAGE IN EXTREMIS !');
    } else {
      showToast(battle, `${cp.name} soigne ${healed} PV !`);
    }
  } else if (car.copilot === 'zigzag' && battle.time >= 0) {
    car.copilotUsed = true;
    const enemy = battle.cars[1 - car.team];
    const dir = Math.sign(enemy.chassis.position.x - car.chassis.position.x) || 1;
    Body.setVelocity(car.chassis, { x: car.chassis.velocity.x + dir * 10, y: car.chassis.velocity.y - 1 });
    const back = worldPoint(car, -car.spec.body.w / 2 - 10, 0);
    burst(battle, back.x, back.y, car.z, 16, 0x4fd7ff, { speed: 4, size: 0.14, life: 0.6 });
    showToast(battle, `${cp.name} : méga-boost !`);
  } else if (car.copilot === 'pixel' && remaining <= 30) {
    car.copilotUsed = true;
    car.cdMult = 0.6;
    showToast(battle, `${cp.name} surcharge les armes !`);
  }
  // tigrou se déclenche dans handleMeleePair
}

function updateDrive(battle, car, enemy, dt) {
  const dx = enemy.chassis.position.x - car.chassis.position.x;
  let dir = Math.sign(dx) || 1;
  const dist = Math.abs(dx);
  if (car.backpedal && !battle.wallsDeadly && dist < 380) dir = -dir;
  const upright = Math.cos(car.chassis.angle) > 0.1;
  if (!upright) return;
  for (const w of car.wheels) {
    Body.setAngularVelocity(w.body, dir * 0.42 * w.speed * car.speedMult);
  }
  const v = car.chassis.velocity;
  if (Math.abs(v.x) < 7) {
    Body.setVelocity(car.chassis, { x: v.x + dir * 12 * dt, y: v.y });
  }
  // poussière soulevée par les roues
  car.dustTimer = (car.dustTimer || 0) - dt;
  if (car.dustTimer <= 0 && Math.abs(v.x) > 2.5 && car.wheels.length) {
    car.dustTimer = 0.09;
    const w = car.wheels[Math.floor(Math.random() * car.wheels.length)];
    if (w.body.position.y > GROUND_Y - w.r - 10) {
      burst(battle, w.body.position.x, GROUND_Y - 4, car.z + 0.3, 1, 0x8a7fae,
        { speed: 0.9, size: 0.2, life: 0.55, grav: -0.6 });
    }
  }
  if (car.boost) {
    car.boostTimer -= dt;
    if (car.boostTimer <= 0) {
      car.boostTimer = 3.5;
      Body.setVelocity(car.chassis, { x: v.x + Math.sign(dx) * 7, y: v.y - 1.2 });
      const back = worldPoint(car, -car.spec.body.w / 2 - 10, 0);
      burst(battle, back.x, back.y, car.z, 12, 0xffb020, { speed: 3, size: 0.13, life: 0.5 });
    }
  }
}

function updateWeapons(battle, car, enemy, dt) {
  // mutateur pacifiste : les armes à distance se taisent (la mêlée reste)
  if (battle.mutator?.key === 'pacifist') return;
  car.spec.weapons.forEach((wp, i) => {
    if (wp.kind === 'melee') return;
    car.weaponTimers[i] -= dt;
    if (car.weaponTimers[i] > 0) return;
    const muzzle = worldPoint(car, wp.ox + (wp.w || 20) / 2, wp.oy);
    const target = enemy.chassis.position;
    const dist = Vector.magnitude(Vector.sub(target, muzzle));
    // dmgMult de l'attaquant appliqué dans applyDamage (centralisé)
    const dmg = wp.def.dmg * wp.mult * car.rangedMult;

    // feedback au canon : flash de bouche + recul, le tir a du poids
    const muzzleKick = recoil => {
      burst(battle, muzzle.x, muzzle.y, car.z, 8, 0xffe080, { speed: 4, size: 0.12, life: 0.18 });
      flashLight(battle, muzzle.x, muzzle.y, 25);
      const v = car.chassis.velocity;
      Body.setVelocity(car.chassis, { x: v.x - car.dir * recoil, y: v.y - recoil * 0.25 });
      car.squashVel = (car.squashVel ?? 0) - 1.25 * recoil; // -1.5 roquette, -0.5 gun
    };

    if (wp.kind === 'rocket') {
      car.weaponTimers[i] = wp.def.cooldown * car.cdMult;
      fireProjectile(battle, car, muzzle, target, { type: 'rocket', dmg, speed: 15, arc: -3.2, r: 7 });
      muzzleKick(1.2);
      sfxRocket();
    } else if (wp.kind === 'gun') {
      if (dist > wp.def.range) { car.weaponTimers[i] = 0.1; return; }
      car.weaponTimers[i] = wp.def.cooldown * car.cdMult;
      fireProjectile(battle, car, muzzle, { x: target.x, y: target.y - 10 + Math.random() * 20 }, { type: 'bullet', dmg, speed: 22, arc: 0, r: 3 });
      muzzleKick(0.4);
      sfxShot();
    } else if (wp.kind === 'laser') {
      if (dist > wp.def.range) { car.weaponTimers[i] = 0.15; car.chargeTimers[i] = 0; return; }
      // télégraphe : 0,2 s de charge visible au canon avant le rayon
      car.chargeTimers[i] += dt;
      if (car.chargeTimers[i] < 0.2) {
        burst(battle, muzzle.x, muzzle.y, car.z, 1, 0x45e8ff, { speed: 1.2, size: 0.09, life: 0.15 });
        return;
      }
      car.chargeTimers[i] = 0;
      car.weaponTimers[i] = wp.def.cooldown * car.cdMult;
      addBeam(battle, muzzle, target, car.z);
      applyDamage(battle, enemy, dmg, target, car);
      burst(battle, target.x, target.y, enemy.z, 8, 0x45e8ff, { speed: 3, size: 0.11, life: 0.4 });
      sfxLaser();
    }
  });
}

function addBeam(battle, from, to, z) {
  const a = new THREE.Vector3(to3x(from.x), to3y(from.y), z);
  const b = new THREE.Vector3(to3x(to.x), to3y(to.y), z);
  const len = a.distanceTo(b);
  const geo = new THREE.CylinderGeometry(0.045, 0.045, len, 6);
  geo.rotateZ(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: 0x66ecff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.lookAt(b);
  mesh.rotateY(Math.PI / 2);
  battle.scene.add(mesh);
  battle.beams.push({ mesh, life: 0.14 });
}

function fireProjectile(battle, owner, from, to, opt) {
  const dirV = Vector.normalise(Vector.sub(to, from));
  const body = Bodies.circle(from.x + dirV.x * 24, from.y + dirV.y * 24 - 6, opt.r, {
    collisionFilter: { group: owner.group },
    frictionAir: 0, restitution: 0.2, density: 0.001, label: 'proj',
  });
  Body.setVelocity(body, { x: dirV.x * opt.speed, y: dirV.y * opt.speed + opt.arc });
  Composite.add(battle.engine.world, body);

  let mesh;
  if (opt.type === 'rocket') {
    mesh = new THREE.Group();
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 8),
      toonMat(0xc9d2e8));
    tube.rotation.z = Math.PI / 2;
    mesh.add(tube);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.18, 8),
      toonMat(0xff4d5e));
    tip.rotation.z = -Math.PI / 2;
    tip.position.x = 0.32;
    mesh.add(tip);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.4, 8),
      new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    flame.rotation.z = Math.PI / 2;
    flame.position.x = -0.42;
    mesh.add(flame);
    mesh.userData.flame = flame;
  } else {
    // balle traçante : sphère étirée dans le sens du tir
    mesh = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe080, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    mesh.scale.set(3.4, 0.55, 0.55);
  }
  battle.scene.add(mesh);

  // traînée de roquette : ligne des dernières positions
  let trail = null;
  if (opt.type === 'rocket') {
    const N = 16;
    const positions = new Float32Array(N * 3);
    const x3 = to3x(from.x), y3 = to3y(from.y);
    for (let i = 0; i < N; i++) {
      positions[i * 3] = x3; positions[i * 3 + 1] = y3; positions[i * 3 + 2] = owner.z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    trail = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0xffa050, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    battle.scene.add(trail);
  }

  battle.projectiles.push({ body, mesh, trail, owner, type: opt.type, dmg: opt.dmg, z: owner.z, hit: false, life: 4, smoke: 0 });
}

function updateEffects(battle, dt) {
  // projectiles
  for (const p of battle.projectiles) {
    p.life -= dt;
    if (p.type === 'rocket' && !p.hit) {
      p.smoke -= dt;
      if (p.smoke <= 0) {
        p.smoke = 0.07;
        burst(battle, p.body.position.x, p.body.position.y, p.z, 1, 0x9aa0b8, { speed: 0.4, size: 0.16, life: 0.4, grav: -1 });
      }
    }
    if ((p.hit || p.life <= 0) && !p.removed) {
      p.removed = true;
      Composite.remove(battle.engine.world, p.body);
      battle.scene.remove(p.mesh);
      if (p.trail) {
        battle.scene.remove(p.trail);
        p.trail.geometry.dispose();
        p.trail.material.dispose();
      }
    }
  }
  battle.projectiles = battle.projectiles.filter(p => !p.removed);

  // bursts de particules
  for (const b of battle.bursts) {
    b.life -= dt;
    if (b.life <= 0) { battle.scene.remove(b.points); b.points.geometry.dispose(); releaseBurstMat(b.points.material); continue; }
    const pos = b.points.geometry.attributes.position;
    for (let i = 0; i < b.vel.length; i++) {
      const v = b.vel[i];
      v.y -= b.grav * dt;
      pos.array[i * 3] += v.x * dt;
      pos.array[i * 3 + 1] += v.y * dt;
      pos.array[i * 3 + 2] += v.z * dt;
    }
    pos.needsUpdate = true;
    b.points.material.opacity = Math.min(1, b.life / b.maxLife * 1.6);
  }
  battle.bursts = battle.bursts.filter(b => b.life > 0);

  // ondes de choc
  for (const w of battle.waves) {
    w.life -= dt;
    const k = 1 - w.life / 0.4;
    w.ring.scale.setScalar(1 + k * 7);
    w.ring.material.opacity = 0.9 * (1 - k);
    if (w.life <= 0) { battle.scene.remove(w.ring); w.ring.geometry.dispose(); w.ring.material.dispose(); }
  }
  battle.waves = battle.waves.filter(w => w.life > 0);

  // rayons laser
  for (const b of battle.beams) {
    b.life -= dt;
    b.mesh.material.opacity = Math.max(0, b.life / 0.14);
    if (b.life <= 0) { battle.scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); }
  }
  battle.beams = battle.beams.filter(b => b.life > 0);

  // textes flottants (le pop retombe vers l'échelle 1)
  for (const f of battle.floaters) {
    f.y += f.vy * dt;
    f.life -= dt;
    if (f.scale) f.scale += (1 - f.scale) * Math.min(1, dt * 14);
  }
  battle.floaters = battle.floaters.filter(f => f.life > 0);
  // traîne orange des mini-barres de PV
  for (const car of battle.cars) {
    const ratio = Math.max(0, car.hp / car.maxHp);
    car.ghostRatio = car.ghostRatio ?? 1;
    if (car.ghostRatio < ratio) car.ghostRatio = ratio; // soin : rattrape direct
    else car.ghostRatio = Math.max(ratio, car.ghostRatio - 0.8 * dt);
  }

  // débris de carrosserie (gravité + rebond au sol)
  for (const d of battle.debris) {
    d.life -= dt;
    if (d.life <= 0) {
      battle.scene.remove(d.mesh);
      d.mesh.geometry.dispose();
      // le porteur des matériaux partagés les libère en expirant
      if (d.mats) for (const m of d.mats) m.dispose();
      continue;
    }
    d.vel.y -= 12 * dt;
    d.mesh.position.addScaledVector(d.vel, dt);
    if (d.mesh.position.y < 0.08) {
      d.mesh.position.y = 0.08;
      d.vel.y *= -0.45;
      d.vel.x *= 0.8;
    }
    d.mesh.rotation.x += d.rot.x * dt;
    d.mesh.rotation.y += d.rot.y * dt;
    d.mesh.rotation.z += d.rot.z * dt;
    if (d.life < 0.5) d.mesh.scale.setScalar(Math.max(0.01, d.life * 2));
  }
  battle.debris = battle.debris.filter(d => d.life > 0);

  // décroissance du flash de dégâts
  for (const car of battle.cars) {
    if (car.hitFlash > 0) car.hitFlash = Math.max(0, car.hitFlash - dt);
  }

  // onomatopées : pop d'échelle « on twos », disparition sèche
  for (const w of battle.words) {
    w.life -= dt;
    const age = w.maxLife - w.life;
    let s = age < 0.09 ? (age / 0.09) * 1.25 : (age < 0.22 ? 1.25 - (age - 0.09) * 2.2 : 0.95);
    s = Math.max(0.001, Math.round(s * 8) / 8); // quantifie l'anim (12 fps feel)
    w.sprite.scale.set(2.0 * s, 1.4 * s, 1);
    if (w.life <= 0) {
      battle.scene.remove(w.sprite);
      w.sprite.material.dispose();
    }
  }
  battle.words = battle.words.filter(w => w.life > 0);

  // marques de brûlure au sol : fondu lent
  for (const s of battle.scorch) {
    s.life -= dt;
    s.mesh.material.opacity = 0.35 * Math.max(0, s.life / 10);
    if (s.life <= 0) { battle.scene.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose(); }
  }
  battle.scorch = battle.scorch.filter(s => s.life > 0);

  battle.flash.intensity = Math.max(0, battle.flash.intensity - 350 * dt);
  // (la décrue de battle.shake vit dans step(), en temps réel non ralenti)
}

// Barres de PV « qui saignent » : chute instantanée + traîne orange, soin lissé.
function hudBarStep(battle, side, car, dt) {
  const target = Math.max(0, (car.hp / car.maxHp) * 100);
  const dKey = 'disp' + side, gKey = 'ghost' + side, hKey = 'ghostHold' + side;
  let disp = battle[dKey] ?? 100;
  disp = target < disp ? target : Math.min(target, disp + 60 * dt); // soin lissé
  battle[dKey] = disp;
  let ghost = battle[gKey] ?? 100;
  if (ghost > disp + 0.1) {
    battle[hKey] = (battle[hKey] ?? 0.3) - dt;
    if (battle[hKey] <= 0) ghost = Math.max(disp, ghost - 80 * dt);
  } else {
    ghost = disp;
    battle[hKey] = 0.3;
  }
  battle[gKey] = ghost;
  document.getElementById(side === 'L' ? 'hp-l' : 'hp-r').style.width = disp + '%';
  const ghostEl = document.getElementById(side === 'L' ? 'ghost-l' : 'ghost-r');
  if (ghostEl) ghostEl.style.width = ghost + '%';
}

function updateHud(battle, remaining, dt) {
  const [me, foe] = battle.cars;
  hudBarStep(battle, 'L', me, dt);
  hudBarStep(battle, 'R', foe, dt);
  // barre de tension : elle se vide, elle rougit, elle ne parle jamais en chiffres
  const clock = document.getElementById('hud-clock-fill');
  const frac = battle.time < 0 ? 1 : Math.max(0, Math.min(1, remaining / BATTLE_TIME));
  clock.style.width = (frac * 100).toFixed(1) + '%';
  clock.classList.toggle('urgent', remaining > 0 && remaining < 10);
}

// ---------- rendu 3D ----------
function resize(battle) {
  const canvas = battle.canvas;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  // le composer capture le pixelRatio à sa construction (2.0) : sans ça il rend
  // 1,78x plus de fragments que le canvas n'en affiche
  battle.composer.setPixelRatio(dpr);
  battle.composer.setSize(w, h);
  // le bloom travaille en demi-résolution : suffisant et 4x moins cher
  battle.bloomPass.setSize(w * dpr / 2, h * dpr / 2);
  // focale pilotée par l'aspect : en portrait on ouvre pour cadrer le duel
  const DEG = Math.PI / 180, aspect = w / h;
  battle.camera.aspect = aspect;
  battle.baseFov = Math.min(54, Math.max(42, 2 * Math.atan(Math.tan(13 * DEG) / aspect) / DEG));
  battle.tanV = Math.tan(battle.baseFov * DEG / 2);
  battle.tanH = battle.tanV * aspect;
  battle.camera.fov = battle.baseFov;
  battle.camera.updateProjectionMatrix();
  layoutForegroundProps(battle.fgProps, battle.camera); // le cadre a changé, les props aussi
  battle.overlay.width = w * dpr;
  battle.overlay.height = h * dpr;
  battle.dpr = dpr;
}

function syncCar(battle, car, t, dt) {
  const c = car.chassis;
  const off = car.centerOffset, ang = c.angle;
  // centre géométrique du châssis (le centre de masse est décalé par les armes)
  const cx = c.position.x + off.x * Math.cos(ang) - off.y * Math.sin(ang);
  const cy = c.position.y + off.x * Math.sin(ang) + off.y * Math.cos(ang);
  car.yaw.position.set(to3x(cx), to3y(cy), car.z);
  car.model.bodyGroup.rotation.z = -ang * car.dir;
  // squash & stretch : ressort amorti, volume conservé
  car.squash = car.squash ?? 1;
  car.squashVel = car.squashVel ?? 0;
  car.squash += car.squashVel * dt;
  car.squashVel += (1 - car.squash) * 180 * dt;
  car.squashVel *= Math.exp(-9 * dt);
  const sq = Math.min(1.2, Math.max(0.75, car.squash));
  car.model.bodyGroup.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
  car.spec.wheels.forEach((w, i) => {
    const wb = car.wheels[i].body;
    const wm = car.model.wheelMeshes[i];
    wm.position.set(to3x(wb.position.x), to3y(wb.position.y), car.z);
    wm.rotation.z = -wb.angle;
  });
  // flash rouge quand le véhicule encaisse
  const bodyMat = car.model.bodyMat;
  if (bodyMat) {
    if (car.hitFlash > 0) {
      bodyMat.emissive.setHex(0xff2233);
      bodyMat.emissiveIntensity = car.hitFlash * 6;
    } else if (bodyMat.emissiveIntensity !== 0) {
      bodyMat.emissiveIntensity = 0;
    }
  }
  // ombre blob : suit la voiture au sol, rétrécit quand elle décolle
  if (car.blob) {
    const alt = Math.max(0, car.yaw.position.y - 0.75);
    const k = Math.max(0.45, 1.15 - alt * 0.28);
    car.blob.position.set(car.yaw.position.x, 0.03, car.z);
    car.blob.scale.set(1.6 * k, k, 1);
  }
  // animations quantifiées « on twos » (12 fps) : le détail qui fait dessin animé
  // early-out : inutile de recalculer entre deux pas de 12 fps (rendu 60-120 Hz)
  const tq = Math.floor(t * 12) / 12;
  if (tq !== car.lastTq) {
    car.lastTq = tq;
    for (const anim of car.model.spins) {
      for (const s of anim.spin) {
        if (anim.axis === 'x') s.rotation.x = tq * 20;
        else s.rotation.z = -tq * 16;
      }
    }
    for (const f of car.model.flames) {
      const k = 0.8 + Math.sin(tq * 31 + car.team) * 0.25;
      f.scale.set(k, 0.9 + Math.sin(tq * 43) * 0.3, k);
    }
  }
}

function render(battle, t, dt) {
  const { camera, cars } = battle;

  for (const car of cars) syncCar(battle, car, t, dt);

  // projectiles
  for (const p of battle.projectiles) {
    if (p.removed || p.hit) continue;
    p.mesh.position.set(to3x(p.body.position.x), to3y(p.body.position.y), p.z);
    p.mesh.rotation.z = -Math.atan2(p.body.velocity.y, p.body.velocity.x);
    if (p.type === 'rocket') {
      // traînée et flicker au temps ralenti : pendant le slow-mo la roquette
      // avance moins vite, sa fumée aussi (accumulateur au pas de 60 Hz)
      p.trailAcc = (p.trailAcc || 0) + (battle.sdt ?? dt);
      if (p.trailAcc >= 1 / 60) {
        p.trailAcc = 0;
        const f = p.mesh.userData.flame;
        f.scale.setScalar(0.8 + Math.random() * 0.5);
        // fait glisser la traînée
        const pos = p.trail.geometry.attributes.position;
        for (let i = pos.count - 1; i > 0; i--) {
          pos.array[i * 3] = pos.array[(i - 1) * 3];
          pos.array[i * 3 + 1] = pos.array[(i - 1) * 3 + 1];
          pos.array[i * 3 + 2] = pos.array[(i - 1) * 3 + 2];
        }
        pos.array[0] = p.mesh.position.x;
        pos.array[1] = p.mesh.position.y;
        pos.array[2] = p.mesh.position.z;
        pos.needsUpdate = true;
      }
    }
  }
  pulseLaserLens(t);

  // murs (couleur émissive posée une seule fois au passage en mode mortel)
  battle.wall3L.position.x = to3x(battle.wallL.position.x + 30);
  battle.wall3R.position.x = to3x(battle.wallR.position.x - 30);
  if (battle.wallsDeadly) {
    const pulse = 0.6 + 0.4 * Math.sin(t * 9);
    for (const w3 of [battle.wall3L, battle.wall3R]) {
      w3.userData.glow.material.opacity = 0.3 * pulse + 0.12;
      w3.userData.wallMat.emissiveIntensity = pulse;
    }
  }

  // ---- pipeline caméra de réalisateur (ordre canonique, un seul écrivain) ----
  const [a, b] = cars;
  const ax = to3x(a.chassis.position.x), bx = to3x(b.chassis.position.x);
  const midX = (ax + bx) / 2;
  // 1. cible de focus : « dernier souffle » prioritaire sur le milieu du duel
  const ay = to3y(a.chassis.position.y), by = to3y(b.chassis.position.y);
  battle.focusT = Math.max(0, battle.focusT - dt);
  // le focus BIAISE le cadre, il ne l'écrase pas : on ne perd jamais l'autre machine
  const bias = battle.finished ? 0.75 : 0.5;
  const tx = battle.focusT > 0 ? midX + (battle.focusX - midX) * bias : midX;
  battle.camX += (tx - battle.camX) * Math.min(1, dt * (battle.focusT > 0 ? 8 : 5));
  // 2. cadrage sur la BOÎTE ENGLOBANTE réelle des deux machines (armes comprises)
  const left = Math.min(ax - a.model.radX, bx - b.model.radX);
  const right = Math.max(ax + a.model.radX, bx + b.model.radX);
  const bot = Math.min(ay - a.model.radY, by - b.model.radY);
  const top = Math.max(ay + a.model.radY, by + b.model.radY);
  const halfW = Math.max(right - battle.camX, battle.camX - left) + 1.1;
  const needH = (top - bot) + 3.6;
  // plancher de largeur visible : en portrait c'est LUI qui décide de la taille
  // des machines à l'écran (la hauteur visible vaut ~2,2x la largeur). Le
  // descendre remplit le cadre ; le descendre trop laisse sortir une machine
  // catapultée — 8,4 est le point mesuré où le cadrage reste à 100%.
  const visW = Math.min(19, Math.max(8.4, Math.max(2 * halfW, needH * camera.aspect)));
  let targetDist = Math.min(44, Math.max(11, (visW / 2) / battle.tanH));
  // plan large sur l'explosion avant le dolly-in sur l'épave
  if (battle.finished && battle.endTimer < 1.35) targetDist = Math.min(targetDist, 15);
  // on s'ouvre vite, on se resserre lentement : une machine catapultée reste dans le cadre
  const kz = targetDist > battle.camDist ? 6 : 2.5;
  battle.camDist += (targetDist - battle.camDist) * Math.min(1, dt * kz);
  // 3. menace des murs : contre-plongée progressive à hauteur de capot
  battle.menace += ((battle.wallsDeadly ? 1 : 0) - battle.menace) * Math.min(1, dt / 1.2);
  // l'action est verrouillée à 63% de la hauteur d'image, l'horizon ne bouge JAMAIS
  const tv = battle.camDist * battle.tanV;
  const actY = (top + bot) / 2;
  const lookT = Math.min(0.68 * tv, Math.max(0.20 * tv, actY + 0.15 * tv));
  battle.camLookY += (lookT - battle.camLookY) * Math.min(1, dt * 6);
  const pitch = (2 - 8 * battle.menace) * Math.PI / 180;
  const camY = battle.camLookY + battle.camDist * Math.tan(pitch);
  // 4. position = base + dérive vivante + kick des coups + shake
  // amplitudes proportionnelles à la distance : un impact reste aussi fort à l'écran
  // quel que soit le zoom ; le shake est une oscillation ORIENTÉE, pas du bruit blanc
  const shk = battle.shake * 0.0009 * battle.camDist;
  const osc = Math.sin(t * 58) * shk;
  const sax = Math.cos(battle.shakeAng), say = Math.sin(battle.shakeAng);
  const drift = Math.sin(t * 0.4) * 0.018 * battle.camDist;
  camera.position.set(
    battle.camX + drift + battle.kickX * (battle.camDist / 12) + sax * osc,
    camY + say * osc * 0.8,
    battle.camDist
  );
  camera.lookAt(battle.camX + Math.sin(t * 0.27) * 0.01 * battle.camDist, battle.camLookY, 0);
  // 5. APRÈS lookAt : roll (dutch angle) + punch de focale, avec retour au calme
  battle.roll += (battle.rollKick - battle.roll) * Math.min(1, dt * 10);
  battle.rollKick *= Math.exp(-dt * 4);
  camera.rotation.z += battle.roll;
  battle.kickX *= Math.exp(-14 * dt);
  battle.fovKick *= Math.exp(-dt * 7);
  const fovNow = battle.baseFov * (1 + battle.fovKick / 42);
  if (Math.abs(camera.fov - fovNow) > 0.05) {
    camera.fov = fovNow;
    camera.updateProjectionMatrix();
  }
  // le brouillard suit la caméra pour ne jamais noyer les combattants
  battle.scene.fog.near = battle.camDist + 3.5;
  battle.scene.fog.far = battle.camDist + 26;

  // météo d'ambiance (braises/neige/néons), volume enroulé autour de la caméra
  const weather = battle.env.userData.weather;
  if (weather) {
    const wpos = weather.points.geometry.attributes.position;
    const arr = wpos.array;
    for (let i = 0; i < wpos.count; i++) {
      let x = arr[i * 3], y = arr[i * 3 + 1];
      if (weather.type === 'embers') { y += 1.2 * dt; x += Math.sin(t * 2 + i) * 0.4 * dt; }
      else if (weather.type === 'neon') { y -= 6 * dt; }
      else { y -= 0.8 * dt; x += Math.sin(t + i) * 0.3 * dt; }
      arr[i * 3] = battle.camX + ((x - battle.camX + 22) % 44 + 44) % 44 - 22;
      arr[i * 3 + 1] = ((y % 16) + 16) % 16;
    }
    wpos.needsUpdate = true;
  }

  // la foule saute et s'agite (quantifiée 12 fps : early-out entre deux pas,
  // sinon les ~130 setMatrixAt + upload tournent pour rien à 60-120 Hz)
  const crowd = battle.env.userData.crowd;
  if (crowd) {
    const excite = battle.finished ? 2.2 : 1;
    const tq2 = Math.floor(t * 12) / 12;
    if (tq2 !== crowd.lastTq || excite !== crowd.lastExcite) {
      crowd.lastTq = tq2;
      crowd.lastExcite = excite;
      for (let i = 0; i < crowd.data.length; i++) {
        const f = crowd.data[i];
        crowd.dummy.position.set(f.x, f.y + Math.max(0, Math.sin(tq2 * f.speed * excite + f.phase)) * f.amp * excite, f.z);
        crowd.dummy.updateMatrix();
        crowd.mesh.setMatrixAt(i, crowd.dummy.matrix);
      }
      crowd.mesh.instanceMatrix.needsUpdate = true;
      // grande roue de la fête foraine : rotation lente au même pas de 12 fps
      const ferris = battle.env.userData.ferris;
      if (ferris) ferris.rotation.z = tq2 * 0.15;
    }
  }

  battle.composer.render();
  renderOverlay(battle);
}

// Superposition 2D : dégâts flottants + mini barres de PV projetées.
const PROJ_V = new THREE.Vector3(); // réutilisé à chaque frame, zéro allocation
function renderOverlay(battle) {
  const ctx = battle.overlay.getContext('2d');
  const W = battle.overlay.width, H = battle.overlay.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const v = PROJ_V;
  const project = (x2, y2, z) => {
    v.set(to3x(x2), to3y(y2), z).project(battle.camera);
    return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H];
  };

  // mini barres de PV (avec traîne orange)
  for (const car of battle.cars) {
    if (car.dead) continue;
    const p = car.chassis.position;
    const [sx, sy] = project(p.x, p.y - car.spec.body.h / 2 - 46, car.z);
    const bw = 0.062 * W;
    const bh2 = 8 * battle.dpr / 2;
    ctx.fillStyle = '#26183A';
    ctx.beginPath(); ctx.roundRect(sx - bw / 2, sy, bw, bh2 + 4, 4); ctx.fill();
    ctx.fillStyle = '#ffb347';
    ctx.beginPath(); ctx.roundRect(sx - bw / 2 + 1.5, sy + 1.5, (bw - 3) * (car.ghostRatio ?? 1), bh2 + 1, 3); ctx.fill();
    ctx.fillStyle = car.team === 0 ? '#4fc3ff' : '#ff5d7a';
    const ratio = Math.max(0, car.hp / car.maxHp);
    ctx.beginPath(); ctx.roundRect(sx - bw / 2 + 1.5, sy + 1.5, (bw - 3) * ratio, bh2 + 1, 3); ctx.fill();
  }

  // dégâts flottants (pop d'échelle + critiques dorés)
  ctx.textAlign = 'center';
  const fs = Math.round(15 * battle.dpr);
  for (const f of battle.floaters) {
    const [sx, sy] = project(f.x, f.y, f.z);
    ctx.font = `800 ${Math.round(fs * (f.scale || 1))}px 'Baloo 2', sans-serif`;
    ctx.globalAlpha = Math.min(1, f.life * 2.2);
    ctx.strokeStyle = '#26183A';
    ctx.lineWidth = 5;
    ctx.strokeText(f.text, sx, sy);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, sx, sy);
  }
  ctx.globalAlpha = 1;
}
