// Moteur de combat : physique Matter.js + rendu 3D Three.js + IA automatique.
import * as THREE from 'three';
import { buildCarSpec } from './car.js';
import { copilotMods } from './state.js';
import { COPILOTS } from './data.js';
import { createRenderer } from './render3d.js';
import { createCarModel, createArena, createDeathWall, skyTexture, S } from './models3d.js';
import { sfxHit, sfxBoom, sfxLaser, sfxShot } from './sfx.js';
import { EffectComposer } from './lib/postprocessing/EffectComposer.js';
import { RenderPass } from './lib/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './lib/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './lib/postprocessing/OutputPass.js';

const { Engine, Bodies, Body, Composite, Constraint, Events, Vector } = Matter;

const ARENA_W = 1400;
const GROUND_Y = 620;
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
  const { x, dir, team, name, statBoost = 1, copilot = null } = opts;
  const mods = copilotMods(copilot);
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
  for (const w of spec.wheels) {
    const wheel = Bodies.circle(x + w.ox * dir, y + w.oy, w.r, {
      collisionFilter: { group },
      friction: 1.1, frictionStatic: 8, restitution: 0.05,
      density: 0.0025, label: `wheel:${team}`,
    });
    axles.push(Constraint.create({
      bodyA: chassis,
      pointA: { x: centerOffset.x + w.ox * dir, y: centerOffset.y + w.oy },
      bodyB: wheel,
      stiffness: 0.9, length: 0,
    }));
    wheels.push({ body: wheel, speed: w.speed, r: w.r });
  }
  Composite.add(engine.world, [chassis, ...wheels.map(w => w.body), ...axles]);

  const maxHp = Math.round(spec.stats.hp * statBoost * mods.hp);
  return {
    team, name, dir, spec, chassis, wheels, axles, group,
    centerOffset,
    hp: maxHp, maxHp,
    heal: spec.stats.heal,
    boost: spec.stats.hasBooster, backpedal: spec.stats.hasBackpedal,
    dmgMult: statBoost,
    copilot,
    meleeMult: mods.melee, rangedMult: mods.ranged, speedMult: mods.speed,
    cdMult: 1, frenzyUntil: -1, copilotUsed: false,
    weaponTimers: spec.weapons.map(() => 0),
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
function buildScene(battle) {
  const scene = new THREE.Scene();
  scene.background = skyTexture();
  scene.fog = new THREE.Fog(0x191636, 55, 140);

  const hemi = new THREE.HemisphereLight(0xcfd6ff, 0x241a38, 0.75);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff2dd, 2.2);
  key.position.set(6, 14, 9);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -16; key.shadow.camera.right = 16;
  key.shadow.camera.top = 12; key.shadow.camera.bottom = -6;
  key.shadow.bias = -0.0015;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x7a9dff, 0.9);
  rim.position.set(-8, 6, -9);
  scene.add(rim);

  battle.env = createArena(scene, ARENA_W);

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
  battle.camX = 0; battle.camDist = 12;

  // post-processing : bloom léger (lasers, phares, explosions, néons)
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.65, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  battle.composer = composer;
}

// ---------- effets : jets de particules (un burst = un THREE.Points) ----------
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
  const mtl = new THREE.PointsMaterial({
    color, size: opt.size || 0.14, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
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

// ---------- combat ----------
export function startBattle(config) {
  const { playerLoadout, opponent, onEnd, copilot = null } = config;
  const canvas = document.getElementById('battle-canvas');
  if (!renderer) renderer = createRenderer(canvas);

  const engine = Engine.create();
  engine.gravity.y = 1;

  const ground = Bodies.rectangle(ARENA_W / 2, GROUND_Y + 40, ARENA_W * 3, 80, { isStatic: true, label: 'ground', friction: 0.9 });
  const wallL = Bodies.rectangle(-30, GROUND_Y - 300, 60, 700, { isStatic: true, label: 'wall:L' });
  const wallR = Bodies.rectangle(ARENA_W + 30, GROUND_Y - 300, 60, 700, { isStatic: true, label: 'wall:R' });
  Composite.add(engine.world, [ground, wallL, wallR]);

  const me = makeCar(engine, playerLoadout, { x: 390, dir: 1, team: 0, name: 'Toi', copilot });
  const foe = makeCar(engine, opponent.loadout, { x: ARENA_W - 390, dir: -1, team: 1, name: opponent.name, statBoost: opponent.statBoost });

  const battle = {
    engine, canvas, cars: [me, foe], ground, wallL, wallR,
    projectiles: [], beams: [], bursts: [], waves: [], floaters: [],
    time: -3.2, wallsDeadly: false,
    shake: 0, slowmo: 1,
    finished: false, raf: 0, lastMsg: '',
    result: null, endTimer: 0,
    overlay: document.getElementById('battle-overlay'),
  };
  current = battle;
  buildScene(battle);

  Events.on(engine, 'collisionActive', ev => {
    for (const pair of ev.pairs) handleMeleePair(battle, pair);
  });
  Events.on(engine, 'collisionStart', ev => {
    for (const pair of ev.pairs) {
      handleProjectilePair(battle, pair);
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
  Events.off(current.engine);
  Composite.clear(current.engine.world, false);
  Engine.clear(current.engine);
  // libère la scène 3D
  current.composer?.dispose();
  current.scene.traverse(o => {
    if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose?.();
  });
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
      const dmg = wp.def.dps * wp.mult * MELEE_TICK * owner.dmgMult * owner.meleeMult * frenzy;
      const at = pair.collision.supports[0] || target.chassis.position;
      applyDamage(battle, target, dmg, at);
      burst(battle, at.x, at.y, target.z, 7, 0xffd060, { speed: 3.6, size: 0.1, life: 0.45 });
      if (wp.def.push) {
        Body.setVelocity(target.chassis, { x: target.chassis.velocity.x + owner.dir * 2.2, y: target.chassis.velocity.y - 0.6 });
      }
      sfxHit();
    }
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
      battle.shake = Math.max(battle.shake, 8);
      for (const car of battle.cars) {
        if (car === proj.owner || car.dead) continue;
        const d = Vector.magnitude(Vector.sub(car.chassis.position, pos));
        if (target === car || d < 110) {
          applyDamage(battle, car, proj.dmg, pos);
          Body.setVelocity(car.chassis, { x: car.chassis.velocity.x + proj.owner.dir * 1.5, y: car.chassis.velocity.y - 1 });
        }
      }
    } else if (target && target !== proj.owner && !target.dead) {
      applyDamage(battle, target, proj.dmg, pos);
      burst(battle, pos.x, pos.y, proj.z, 4, 0xffe080, { speed: 2.4, size: 0.09, life: 0.35 });
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

function applyDamage(battle, car, dmg, at) {
  if (car.dead || (battle.finished && battle.endTimer > 0.4)) return;
  car.hp -= dmg;
  battle.floaters.push({
    x: at.x + (Math.random() - 0.5) * 20, y: at.y - 30, z: car.z,
    vy: -90, life: 0.85, text: '-' + Math.max(1, Math.round(dmg)),
    color: car.team === 0 ? '#ff8fa4' : '#ffe08a',
  });
  if (car.hp <= 0) killCar(battle, car, 'détruit');
}

function killCar(battle, car, cause) {
  if (car.dead || battle.finished) return;
  car.dead = true;
  car.hp = Math.max(0, car.hp);
  sfxBoom(true);
  battle.shake = 22;
  const p = car.chassis.position;
  burst(battle, p.x, p.y, car.z, 46, 0xff8040, { speed: 7, size: 0.2, life: 1.0, grav: 5 });
  burst(battle, p.x, p.y, car.z, 30, 0xffd060, { speed: 5, size: 0.14, life: 0.8 });
  burst(battle, p.x, p.y, car.z, 18, 0xffffff, { speed: 3, size: 0.1, life: 0.5 });
  shockwave(battle, p.x, p.y, car.z, 0xff5030);
  flashLight(battle, p.x, p.y, 160);
  for (const a of car.axles) Composite.remove(battle.engine.world, a);
  for (const w of car.wheels) Body.setVelocity(w.body, { x: (Math.random() - 0.5) * 14, y: -8 - Math.random() * 5 });
  Body.setVelocity(car.chassis, { x: car.chassis.velocity.x, y: -7 });
  Body.setAngularVelocity(car.chassis, (Math.random() - 0.5) * 0.4);

  battle.finished = true;
  battle.slowmo = 0.25;
  battle.endTimer = 1.7;
  const playerWon = car.team === 1;
  battle.result = {
    win: playerWon,
    reason: cause === 'mur' ? 'Écrasé par le mur !' : (cause === 'retourné' ? 'KO — retourné !' : 'Destruction totale !'),
  };
  showMsg(battle, playerWon ? 'K.O. !' : 'PERDU…');
}

function showToast(battle, text) {
  const el = document.getElementById('battle-toast');
  el.textContent = text;
  el.classList.remove('hidden');
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  clearTimeout(battle.toastTimer);
  battle.toastTimer = setTimeout(() => el.classList.add('hidden'), 1600);
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

  if (battle.time < 0) {
    const n = Math.ceil(-battle.time);
    showMsg(battle, n <= 3 ? String(n) : '');
    return;
  }
  if (prev < 0) showMsg(battle, 'MIAOU !');
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
  }

  Engine.update(engine, 1000 / 60 * battle.slowmo);
  updateEffects(battle, dt);
  updateHud(battle, remaining);
}

// Capacités automatiques des co-pilotes (une fois par combat).
function updateCopilot(battle, car, remaining) {
  if (!car.copilot || car.copilotUsed) return;
  const cp = COPILOTS[car.copilot];
  if (car.copilot === 'ronron' && car.hp < car.maxHp * 0.35) {
    car.copilotUsed = true;
    const healed = Math.round(car.maxHp * 0.3);
    car.hp = Math.min(car.maxHp, car.hp + healed);
    const p = car.chassis.position;
    burst(battle, p.x, p.y - 40, car.z, 16, 0x4de08a, { speed: 2.2, size: 0.13, life: 0.8, grav: -2 });
    battle.floaters.push({ x: p.x, y: p.y - 60, z: car.z, vy: -70, life: 1, text: '+' + healed, color: '#7dffb0' });
    showToast(battle, `${cp.name} soigne ${healed} PV !`);
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
  if (car.dustTimer <= 0 && Math.abs(v.x) > 2.5) {
    car.dustTimer = 0.09;
    const w = car.wheels[Math.random() < 0.5 ? 0 : 1];
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
  car.spec.weapons.forEach((wp, i) => {
    if (wp.kind === 'melee') return;
    car.weaponTimers[i] -= dt;
    if (car.weaponTimers[i] > 0) return;
    const muzzle = worldPoint(car, wp.ox + (wp.w || 20) / 2, wp.oy);
    const target = enemy.chassis.position;
    const dist = Vector.magnitude(Vector.sub(target, muzzle));
    const dmg = wp.def.dmg * wp.mult * car.dmgMult * car.rangedMult;

    if (wp.kind === 'rocket') {
      car.weaponTimers[i] = wp.def.cooldown * car.cdMult;
      fireProjectile(battle, car, muzzle, target, { type: 'rocket', dmg, speed: 15, arc: -3.2, r: 7 });
      sfxShot();
    } else if (wp.kind === 'gun') {
      if (dist > wp.def.range) { car.weaponTimers[i] = 0.1; return; }
      car.weaponTimers[i] = wp.def.cooldown * car.cdMult;
      fireProjectile(battle, car, muzzle, { x: target.x, y: target.y - 10 + Math.random() * 20 }, { type: 'bullet', dmg, speed: 22, arc: 0, r: 3 });
      sfxShot();
    } else if (wp.kind === 'laser') {
      if (dist > wp.def.range) { car.weaponTimers[i] = 0.15; return; }
      car.weaponTimers[i] = wp.def.cooldown * car.cdMult;
      addBeam(battle, muzzle, target, car.z);
      applyDamage(battle, enemy, dmg, target);
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
      new THREE.MeshStandardMaterial({ color: 0xd8dce8, metalness: 0.7, roughness: 0.35 }));
    tube.rotation.z = Math.PI / 2;
    mesh.add(tube);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.18, 8),
      new THREE.MeshStandardMaterial({ color: 0xff4b5e, roughness: 0.4 }));
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
    mesh = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe080 }));
  }
  battle.scene.add(mesh);
  battle.projectiles.push({ body, mesh, owner, type: opt.type, dmg: opt.dmg, z: owner.z, hit: false, life: 4, smoke: 0 });
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
    }
  }
  battle.projectiles = battle.projectiles.filter(p => !p.removed);

  // bursts de particules
  for (const b of battle.bursts) {
    b.life -= dt;
    if (b.life <= 0) { battle.scene.remove(b.points); b.points.geometry.dispose(); b.points.material.dispose(); continue; }
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

  // textes flottants
  for (const f of battle.floaters) { f.y += f.vy * dt; f.life -= dt; }
  battle.floaters = battle.floaters.filter(f => f.life > 0);

  battle.flash.intensity = Math.max(0, battle.flash.intensity - 350 * dt);
  battle.shake = Math.max(0, battle.shake - 60 * dt);
}

function updateHud(battle, remaining) {
  const [me, foe] = battle.cars;
  document.getElementById('hp-l').style.width = Math.max(0, (me.hp / me.maxHp) * 100) + '%';
  document.getElementById('hp-r').style.width = Math.max(0, (foe.hp / foe.maxHp) * 100) + '%';
  const t = document.getElementById('hud-timer');
  if (battle.time < 0) t.textContent = BATTLE_TIME;
  else if (remaining > 0) t.textContent = Math.ceil(remaining);
  else t.textContent = '☠';
  t.style.color = remaining < 10 ? '#ff6d84' : '';
}

// ---------- rendu 3D ----------
function resize(battle) {
  const canvas = battle.canvas;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  battle.composer.setSize(w, h);
  battle.camera.aspect = w / h;
  battle.camera.updateProjectionMatrix();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  battle.overlay.width = w * dpr;
  battle.overlay.height = h * dpr;
  battle.dpr = dpr;
}

function syncCar(battle, car, t) {
  const c = car.chassis;
  const off = car.centerOffset, ang = c.angle;
  // centre géométrique du châssis (le centre de masse est décalé par les armes)
  const cx = c.position.x + off.x * Math.cos(ang) - off.y * Math.sin(ang);
  const cy = c.position.y + off.x * Math.sin(ang) + off.y * Math.cos(ang);
  car.yaw.position.set(to3x(cx), to3y(cy), car.z);
  car.model.bodyGroup.rotation.z = -ang * car.dir;
  car.spec.wheels.forEach((w, i) => {
    const wb = car.wheels[i].body;
    const wm = car.model.wheelMeshes[i];
    wm.position.set(to3x(wb.position.x), to3y(wb.position.y), car.z);
    wm.rotation.z = -wb.angle;
  });
  // animations : scies/perceuses qui tournent, flammes qui vacillent
  for (const anim of car.model.spins) {
    for (const s of anim.spin) {
      if (anim.axis === 'x') s.rotation.x = t * 20;
      else s.rotation.z = -t * 16;
    }
  }
  for (const f of car.model.flames) {
    const k = 0.8 + Math.sin(t * 31 + car.team) * 0.25;
    f.scale.set(k, 0.9 + Math.sin(t * 43) * 0.3, k);
  }
}

function render(battle, t, dt) {
  const { camera, cars } = battle;

  for (const car of cars) syncCar(battle, car, t);

  // projectiles
  for (const p of battle.projectiles) {
    if (p.removed || p.hit) continue;
    p.mesh.position.set(to3x(p.body.position.x), to3y(p.body.position.y), p.z);
    if (p.type === 'rocket') {
      p.mesh.rotation.z = -Math.atan2(p.body.velocity.y, p.body.velocity.x);
      const f = p.mesh.userData.flame;
      f.scale.setScalar(0.8 + Math.random() * 0.5);
    }
  }

  // murs
  battle.wall3L.position.x = to3x(battle.wallL.position.x + 30);
  battle.wall3R.position.x = to3x(battle.wallR.position.x - 30);
  for (const w3 of [battle.wall3L, battle.wall3R]) {
    const glow = w3.userData.glow;
    if (battle.wallsDeadly) {
      glow.material.opacity = 0.3 + Math.sin(t * 9) * 0.18;
      w3.userData.wallMat.emissive = new THREE.Color(0x8f1024);
    }
  }

  // caméra : cadre les deux véhicules, avec inertie
  const [a, b] = cars;
  const ax = to3x(a.chassis.position.x), bx = to3x(b.chassis.position.x);
  const midX = (ax + bx) / 2;
  const span = Math.abs(ax - bx) + 3.2;
  const vFov = camera.fov * Math.PI / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const targetDist = Math.min(Math.max((span / 2) / Math.tan(hFov / 2), 6.5), 46);
  battle.camX += (midX - battle.camX) * Math.min(1, dt * 5);
  battle.camDist += (targetDist - battle.camDist) * Math.min(1, dt * 3.5);
  const shk = battle.shake * 0.012;
  camera.position.set(
    battle.camX + (Math.random() - 0.5) * shk,
    2.0 + battle.camDist * 0.13 + (Math.random() - 0.5) * shk,
    battle.camDist
  );
  camera.lookAt(battle.camX, 0.85 + battle.camDist * 0.075, 0);
  // le brouillard suit la caméra pour ne jamais noyer les combattants
  battle.scene.fog.near = battle.camDist + 9;
  battle.scene.fog.far = battle.camDist + 85;

  // la foule saute et s'agite
  const crowd = battle.env.userData.crowd;
  if (crowd) {
    for (let i = 0; i < crowd.data.length; i++) {
      const f = crowd.data[i];
      const excite = battle.finished ? 2.2 : 1;
      crowd.dummy.position.set(f.x, f.y + Math.max(0, Math.sin(t * f.speed * excite + f.phase)) * f.amp * excite, f.z);
      crowd.dummy.updateMatrix();
      crowd.mesh.setMatrixAt(i, crowd.dummy.matrix);
    }
    crowd.mesh.instanceMatrix.needsUpdate = true;
  }

  battle.composer.render();
  renderOverlay(battle);
}

// Superposition 2D : dégâts flottants + mini barres de PV projetées.
function renderOverlay(battle) {
  const ctx = battle.overlay.getContext('2d');
  const W = battle.overlay.width, H = battle.overlay.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const v = new THREE.Vector3();
  const project = (x2, y2, z) => {
    v.set(to3x(x2), to3y(y2), z).project(battle.camera);
    return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H];
  };

  // mini barres de PV
  for (const car of battle.cars) {
    if (car.dead) continue;
    const p = car.chassis.position;
    const [sx, sy] = project(p.x, p.y - car.spec.body.h / 2 - 46, car.z);
    const bw = 0.062 * W;
    ctx.fillStyle = 'rgba(4,4,14,.55)';
    ctx.beginPath(); ctx.roundRect(sx - bw / 2, sy, bw, 8 * battle.dpr / 2 + 4, 4); ctx.fill();
    ctx.fillStyle = car.team === 0 ? '#4fc3ff' : '#ff5d7a';
    const ratio = Math.max(0, car.hp / car.maxHp);
    ctx.beginPath(); ctx.roundRect(sx - bw / 2 + 1.5, sy + 1.5, (bw - 3) * ratio, 8 * battle.dpr / 2 + 1, 3); ctx.fill();
  }

  // dégâts flottants
  ctx.textAlign = 'center';
  const fs = Math.round(15 * battle.dpr);
  for (const f of battle.floaters) {
    const [sx, sy] = project(f.x, f.y, f.z);
    ctx.font = `800 ${fs}px 'Baloo 2', sans-serif`;
    ctx.globalAlpha = Math.min(1, f.life * 2.2);
    ctx.strokeStyle = 'rgba(0,0,8,.7)';
    ctx.lineWidth = 4;
    ctx.strokeText(f.text, sx, sy);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, sx, sy);
  }
  ctx.globalAlpha = 1;
}
