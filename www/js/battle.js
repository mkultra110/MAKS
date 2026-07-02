// Moteur de combat : physique Matter.js + rendu canvas + IA automatique.
import { buildCarSpec, drawBodyLocal, drawWheel } from './car.js';
import { sfxHit, sfxBoom, sfxLaser, sfxShot } from './sfx.js';

const { Engine, Bodies, Body, Composite, Constraint, Events, Vector } = Matter;

const ARENA_W = 1400;
const GROUND_Y = 620;
const BATTLE_TIME = 45;     // secondes avant les murs de la mort
const MELEE_TICK = 0.25;    // période d'application des dégâts de mêlée
const FLIP_TIME = 2.5;      // secondes retourné avant KO

let current = null; // combat en cours

// ---------- Construction d'un véhicule physique ----------
function makeCar(engine, lo, opts) {
  const { x, dir, team, name, statBoost = 1 } = opts;
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
  // décalage entre centre de masse et centre géométrique du châssis
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

  const maxHp = Math.round(spec.stats.hp * statBoost);
  return {
    team, name, dir, spec, chassis, wheels, axles, group,
    centerOffset,
    hp: maxHp, maxHp,
    heal: spec.stats.heal,
    boost: spec.stats.hasBooster, backpedal: spec.stats.hasBackpedal,
    dmgMult: statBoost,
    weaponTimers: spec.weapons.map(() => 0),
    meleeLast: spec.weapons.map(() => 0),
    meleeTouch: spec.weapons.map(() => -1),
    boostTimer: 1.2,
    flipTimer: 0,
    dead: false,
  };
}

// Position monde d'un point local (repère châssis, avant création) du véhicule.
function worldPoint(car, lx, ly) {
  const a = car.chassis.angle;
  const px = car.centerOffset.x + lx * car.dir, py = car.centerOffset.y + ly;
  return {
    x: car.chassis.position.x + px * Math.cos(a) - py * Math.sin(a),
    y: car.chassis.position.y + px * Math.sin(a) + py * Math.cos(a),
  };
}

// ---------- Combat ----------
export function startBattle(config) {
  const { playerLoadout, playerName, opponent, onEnd } = config;
  const canvas = document.getElementById('battle-canvas');
  const ctx = canvas.getContext('2d');
  const msgEl = document.getElementById('battle-msg');

  const engine = Engine.create();
  engine.gravity.y = 1;

  // sol et bords
  const ground = Bodies.rectangle(ARENA_W / 2, GROUND_Y + 40, ARENA_W * 3, 80, { isStatic: true, label: 'ground', friction: 0.9 });
  const wallL = Bodies.rectangle(-30, GROUND_Y - 300, 60, 700, { isStatic: true, label: 'wall:L' });
  const wallR = Bodies.rectangle(ARENA_W + 30, GROUND_Y - 300, 60, 700, { isStatic: true, label: 'wall:R' });
  Composite.add(engine.world, [ground, wallL, wallR]);

  const me = makeCar(engine, playerLoadout, { x: 260, dir: 1, team: 0, name: playerName });
  const foe = makeCar(engine, opponent.loadout, { x: ARENA_W - 260, dir: -1, team: 1, name: opponent.name, statBoost: opponent.statBoost });
  const cars = [me, foe];

  const battle = {
    engine, canvas, ctx, cars, ground, wallL, wallR,
    projectiles: [], particles: [], beams: [], floaters: [],
    time: -3.2,           // compte à rebours
    wallsDeadly: false,
    shake: 0, slowmo: 1,
    finished: false, raf: 0, lastMsg: '',
    result: null, endTimer: 0,
  };
  current = battle;

  // ----- dégâts de mêlée & projectiles via événements de collision -----
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
    render(battle, now / 1000);
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
    owner.meleeTouch[wIdx] = battle.time;
    if (battle.time - owner.meleeLast[wIdx] >= MELEE_TICK) {
      owner.meleeLast[wIdx] = battle.time;
      const dmg = wp.def.dps * wp.mult * MELEE_TICK * owner.dmgMult;
      const at = pair.collision.supports[0] || target.chassis.position;
      applyDamage(battle, target, dmg, at);
      sparks(battle, at.x, at.y, 6, '#ffd060');
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
      sparks(battle, pos.x, pos.y, 18, '#ff9040');
      ring(battle, pos.x, pos.y, '#ffb020');
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
      sparks(battle, pos.x, pos.y, 4, '#ffe080');
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
  if (car.dead || battle.finished && battle.endTimer > 0.4) return;
  car.hp -= dmg;
  battle.floaters.push({
    x: at.x + (Math.random() - 0.5) * 20, y: at.y - 20,
    vy: -60, life: 0.8, text: '-' + Math.max(1, Math.round(dmg)),
    color: car.team === 0 ? '#ff8090' : '#ffe080',
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
  sparks(battle, p.x, p.y, 40, '#ff8040');
  sparks(battle, p.x, p.y, 25, '#ffd060');
  ring(battle, p.x, p.y, '#ff5030');
  // le véhicule se disloque
  for (const a of car.axles) Composite.remove(battle.engine.world, a);
  for (const w of car.wheels) Body.setVelocity(w.body, { x: (Math.random() - 0.5) * 14, y: -8 - Math.random() * 5 });
  Body.setVelocity(car.chassis, { x: car.chassis.velocity.x, y: -7 });
  Body.setAngularVelocity(car.chassis, (Math.random() - 0.5) * 0.4);

  battle.finished = true;
  battle.slowmo = 0.25;
  battle.endTimer = 1.6;
  const playerWon = car.team === 1;
  battle.result = {
    win: playerWon,
    reason: cause === 'mur' ? 'Écrasé par le mur !' : (cause === 'retourné' ? 'KO — retourné !' : 'Destruction totale !'),
  };
  showMsg(battle, playerWon ? 'K.O. !' : 'PERDU…');
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

// ---------- Boucle de simulation ----------
function step(battle, dt, onEnd) {
  const { engine, cars } = battle;
  const prev = battle.time;
  battle.time += dt;

  // compte à rebours
  if (battle.time < 0) {
    const n = Math.ceil(-battle.time);
    showMsg(battle, n <= 3 ? String(n) : '');
    return;
  }
  if (prev < 0) showMsg(battle, 'MIAOU !');
  if (battle.time > 0.9 && battle.lastMsg === 'MIAOU !') showMsg(battle, '');

  // fin de combat : petite scène au ralenti puis résultat
  if (battle.finished) {
    battle.endTimer -= dt;
    if (battle.endTimer <= 0) {
      const r = battle.result;
      stopBattle();
      onEnd(r);
      return;
    }
  }

  // murs de la mort
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

  // conduite + armes + gadgets
  for (const car of cars) {
    if (car.dead || battle.finished) continue;
    const enemy = cars[1 - car.team];
    updateDrive(battle, car, enemy, dt);
    updateWeapons(battle, car, enemy, dt);
    if (car.heal && car.hp > 0) car.hp = Math.min(car.maxHp, car.hp + car.heal * dt);
    // détection retournement
    if (Math.cos(car.chassis.angle) < -0.25) {
      car.flipTimer += dt;
      if (car.flipTimer > FLIP_TIME) killCar(battle, car, 'retourné');
    } else car.flipTimer = 0;
  }

  Engine.update(engine, 1000 / 60 * battle.slowmo);
  updateEffects(battle, dt);
  updateHud(battle, remaining);
}

function updateDrive(battle, car, enemy, dt) {
  const dx = enemy.chassis.position.x - car.chassis.position.x;
  let dir = Math.sign(dx) || 1;
  const dist = Math.abs(dx);
  // la rétrofusée maintient la distance (sauf quand les murs arrivent)
  if (car.backpedal && !battle.wallsDeadly && dist < 380) dir = -dir;
  const upright = Math.cos(car.chassis.angle) > 0.1;
  if (!upright) return;
  for (const w of car.wheels) {
    Body.setAngularVelocity(w.body, dir * 0.42 * w.speed);
  }
  // aide moteur (comme un couple sur le châssis)
  const v = car.chassis.velocity;
  if (Math.abs(v.x) < 7) {
    Body.setVelocity(car.chassis, { x: v.x + dir * 12 * dt, y: v.y });
  }
  // booster périodique
  if (car.boost) {
    car.boostTimer -= dt;
    if (car.boostTimer <= 0) {
      car.boostTimer = 3.5;
      Body.setVelocity(car.chassis, { x: v.x + Math.sign(dx) * 7, y: v.y - 1.2 });
      const back = worldPoint(car, -car.spec.body.w / 2 - 10, 0);
      sparks(battle, back.x, back.y, 10, '#ffb020');
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
    const dmg = wp.def.dmg * wp.mult * car.dmgMult;

    if (wp.kind === 'rocket') {
      car.weaponTimers[i] = wp.def.cooldown;
      fireProjectile(battle, car, muzzle, target, {
        type: 'rocket', dmg, speed: 15, arc: -3.2, r: 7, color: '#ff7040',
      });
      sfxShot();
    } else if (wp.kind === 'gun') {
      if (dist > wp.def.range) { car.weaponTimers[i] = 0.1; return; }
      car.weaponTimers[i] = wp.def.cooldown;
      fireProjectile(battle, car, muzzle, { x: target.x, y: target.y - 10 + Math.random() * 20 }, {
        type: 'bullet', dmg, speed: 22, arc: 0, r: 3, color: '#ffe080',
      });
      sfxShot();
    } else if (wp.kind === 'laser') {
      if (dist > wp.def.range) { car.weaponTimers[i] = 0.15; return; }
      car.weaponTimers[i] = wp.def.cooldown;
      const hitAt = { x: target.x, y: target.y };
      battle.beams.push({ x1: muzzle.x, y1: muzzle.y, x2: hitAt.x, y2: hitAt.y, life: 0.14 });
      applyDamage(battle, enemy, dmg, hitAt);
      sparks(battle, hitAt.x, hitAt.y, 8, '#45e8ff');
      sfxLaser();
    }
  });
}

function fireProjectile(battle, owner, from, to, opt) {
  const dirV = Vector.normalise(Vector.sub(to, from));
  const body = Bodies.circle(from.x + dirV.x * 24, from.y + dirV.y * 24 - 6, opt.r, {
    collisionFilter: { group: owner.group },
    frictionAir: 0, restitution: 0.2, density: 0.001, label: 'proj',
  });
  Body.setVelocity(body, { x: dirV.x * opt.speed, y: dirV.y * opt.speed + opt.arc });
  Composite.add(battle.engine.world, body);
  battle.projectiles.push({ body, owner, type: opt.type, dmg: opt.dmg, color: opt.color, r: opt.r, hit: false, life: 4 });
}

function updateEffects(battle, dt) {
  // projectiles
  for (const p of battle.projectiles) {
    p.life -= dt;
    if (p.type === 'rocket' && !p.hit && Math.random() < 0.5) {
      battle.particles.push({ x: p.body.position.x, y: p.body.position.y, vx: 0, vy: 0, life: 0.3, size: 4, color: 'rgba(200,200,200,.5)' });
    }
    if ((p.hit || p.life <= 0) && !p.removed) {
      p.removed = true;
      Composite.remove(battle.engine.world, p.body);
    }
  }
  battle.projectiles = battle.projectiles.filter(p => !p.removed);
  // particules / rayons / textes
  for (const s of battle.particles) {
    s.x += (s.vx || 0) * dt; s.y += (s.vy || 0) * dt;
    if (s.vy !== undefined) s.vy += 500 * dt;
    s.life -= dt;
  }
  battle.particles = battle.particles.filter(s => s.life > 0);
  for (const b of battle.beams) b.life -= dt;
  battle.beams = battle.beams.filter(b => b.life > 0);
  for (const f of battle.floaters) { f.y += f.vy * dt; f.life -= dt; }
  battle.floaters = battle.floaters.filter(f => f.life > 0);
  battle.shake = Math.max(0, battle.shake - 60 * dt);
}

function sparks(battle, x, y, n, color) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 80 + Math.random() * 260;
    battle.particles.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80,
      life: 0.35 + Math.random() * 0.4, size: 2 + Math.random() * 4, color,
    });
  }
}
function ring(battle, x, y, color) {
  battle.particles.push({ x, y, life: 0.35, size: 10, ring: true, color });
}

function updateHud(battle, remaining) {
  const [me, foe] = battle.cars;
  document.getElementById('hp-l').style.width = Math.max(0, (me.hp / me.maxHp) * 100) + '%';
  document.getElementById('hp-r').style.width = Math.max(0, (foe.hp / foe.maxHp) * 100) + '%';
  const t = document.getElementById('hud-timer');
  if (battle.time < 0) t.textContent = BATTLE_TIME;
  else if (remaining > 0) t.textContent = Math.ceil(remaining);
  else { t.textContent = '☠️'; }
  t.style.color = remaining < 10 ? '#ff6070' : '';
}

// ---------- Rendu ----------
function resize(battle) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  battle.canvas.width = battle.canvas.clientWidth * dpr;
  battle.canvas.height = battle.canvas.clientHeight * dpr;
  battle.dpr = dpr;
}

function render(battle, t) {
  const { ctx, canvas, cars } = battle;
  const W = canvas.width, H = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // fond
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#1a1a3e'); sky.addColorStop(0.6, '#3a2a5e'); sky.addColorStop(1, '#6a3a6e');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

  // caméra dynamique
  const [a, b] = cars;
  const midX = (a.chassis.position.x + b.chassis.position.x) / 2;
  const span = Math.abs(a.chassis.position.x - b.chassis.position.x) + 620;
  const scale = Math.min(W / span, W / 700);
  const camX = Math.max(W / (2 * scale), Math.min(ARENA_W - W / (2 * scale), midX));
  const shx = (Math.random() - 0.5) * battle.shake * battle.dpr;
  const shy = (Math.random() - 0.5) * battle.shake * battle.dpr;
  ctx.save();
  ctx.translate(W / 2 + shx, H * 0.72 + shy);
  ctx.scale(scale, scale);
  ctx.translate(-camX, -GROUND_Y);

  // décor lointain
  ctx.fillStyle = 'rgba(255,220,120,.9)';
  ctx.beginPath(); ctx.arc(ARENA_W * 0.75, GROUND_Y - 420, 55, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(20,20,50,.55)';
  for (let i = 0; i < 8; i++) {
    const bx = i * 190 + 40, bh2 = 90 + ((i * 73) % 140);
    ctx.fillRect(bx, GROUND_Y - bh2, 120, bh2);
  }

  // sol
  ctx.fillStyle = '#2e2e52';
  ctx.fillRect(-200, GROUND_Y, ARENA_W + 400, 400);
  ctx.fillStyle = '#3c3c68';
  ctx.fillRect(-200, GROUND_Y, ARENA_W + 400, 14);
  ctx.fillStyle = 'rgba(255,255,255,.08)';
  for (let x = 0; x < ARENA_W; x += 90) ctx.fillRect(x, GROUND_Y + 26, 46, 8);

  // murs
  for (const wall of [battle.wallL, battle.wallR]) {
    const wx = wall.position.x;
    ctx.fillStyle = battle.wallsDeadly ? '#e03050' : '#44447a';
    ctx.fillRect(wx - 30, GROUND_Y - 640, 60, 640);
    if (battle.wallsDeadly) {
      ctx.fillStyle = 'rgba(255,60,80,.35)';
      ctx.fillRect(wx - 44, GROUND_Y - 640, 88, 640);
      // pointes
      ctx.fillStyle = '#ffb0c0';
      const inward = wall === battle.wallL ? 1 : -1;
      for (let y = GROUND_Y - 600; y < GROUND_Y; y += 60) {
        ctx.beginPath();
        ctx.moveTo(wx + inward * 30, y); ctx.lineTo(wx + inward * 52, y + 18); ctx.lineTo(wx + inward * 30, y + 36);
        ctx.fill();
      }
    }
  }

  // véhicules
  for (const car of cars) {
    for (const w of car.wheels) {
      drawWheel(ctx, w.body.position.x, w.body.position.y, w.r, w.body.angle, car.wheels.indexOf(w) >= 0 ? car.spec.wheels[car.wheels.indexOf(w)].type : 'basic');
    }
    const c = car.chassis;
    const off = car.centerOffset, ang = c.angle;
    const cx = c.position.x + off.x * Math.cos(ang) - off.y * Math.sin(ang);
    const cy = c.position.y + off.x * Math.sin(ang) + off.y * Math.cos(ang);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    drawBodyLocal(ctx, car.spec, car.dir, car.dead ? 0 : t);
    ctx.restore();
    // mini barre de PV au-dessus
    if (!car.dead) {
      const bw2 = 90;
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.fillRect(cx - bw2 / 2, cy - car.spec.body.h / 2 - 46, bw2, 9);
      ctx.fillStyle = car.team === 0 ? '#40b0ff' : '#ff5060';
      ctx.fillRect(cx - bw2 / 2 + 1, cy - car.spec.body.h / 2 - 45, (bw2 - 2) * Math.max(0, car.hp / car.maxHp), 7);
    }
  }

  // projectiles
  for (const p of battle.projectiles) {
    if (p.hit) continue;
    const pos = p.body.position;
    ctx.save();
    ctx.translate(pos.x, pos.y);
    if (p.type === 'rocket') {
      ctx.rotate(Math.atan2(p.body.velocity.y, p.body.velocity.x));
      ctx.fillStyle = '#d0d4e0'; ctx.fillRect(-10, -4, 20, 8);
      ctx.fillStyle = '#ff5060';
      ctx.beginPath(); ctx.moveTo(10, -4); ctx.lineTo(17, 0); ctx.lineTo(10, 4); ctx.fill();
      ctx.fillStyle = '#ffb020';
      ctx.beginPath(); ctx.arc(-12, 0, 4 + Math.random() * 3, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(0, 0, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // rayons laser
  for (const beam of battle.beams) {
    ctx.strokeStyle = 'rgba(90,230,255,' + (beam.life / 0.14) + ')';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(beam.x1, beam.y1); ctx.lineTo(beam.x2, beam.y2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,' + (beam.life / 0.14) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(beam.x1, beam.y1); ctx.lineTo(beam.x2, beam.y2); ctx.stroke();
  }

  // particules
  for (const s of battle.particles) {
    if (s.ring) {
      ctx.strokeStyle = s.color;
      ctx.globalAlpha = s.life / 0.35;
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.size + (0.35 - s.life) * 500, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = s.color;
      ctx.globalAlpha = Math.min(1, s.life * 2.5);
      ctx.fillRect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
      ctx.globalAlpha = 1;
    }
  }

  // dégâts flottants
  ctx.textAlign = 'center';
  for (const f of battle.floaters) {
    ctx.font = '900 26px -apple-system, sans-serif';
    ctx.globalAlpha = Math.min(1, f.life * 2);
    ctx.fillStyle = f.color;
    ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 4;
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillText(f.text, f.x, f.y);
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}
