// Écran garage : aperçu 3D du véhicule, emplacements, inventaire, fiche pièce.
import * as THREE from 'three';
import { KIND_LABEL, partDef, partStats, maxLevel, upgradeCost, recycleValue, COPILOTS, STICKERS, LEAGUES, leagueIndex } from './data.js';
import { state, save, isEquipped, buildLoadout, computeCarStats, loadoutValid, activeSets, equip, unequip, removePart, getPart, stickerOwned, MEDALS_TO_ADVANCE } from './state.js';
import { buildCarSpec } from './car.js';
import { createRenderer, createStudioScene, disposeModel } from './render3d.js';
import { createCarModel, poseCarStatic, stickerTexture } from './models3d.js';
import { partThumb, copilotThumb } from './thumbs.js';
import { sfxClick, sfxBuy, sfxDenied } from './sfx.js';

let currentTab = 'body';
let sheetPart = null;
let recycleArmed = false;
let recycleTimer = 0;
let toastTimer = 0;

// Petit message transitoire dans le garage.
function garageToast(text) {
  const el = document.getElementById('garage-toast');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
}

// ---- aperçu 3D (plateau tournant) ----
let pv = null; // { renderer, scene, camera, holder, raf, running }

function ensurePreview() {
  if (pv) return;
  const canvas = document.getElementById('preview-canvas');
  const renderer = createRenderer(canvas);
  const scene = createStudioScene(renderer);
  const camera = new THREE.PerspectiveCamera(34, 2, 0.1, 100);
  const holder = new THREE.Group();
  scene.add(holder);
  pv = { renderer, scene, camera, holder, raf: 0, running: false, angle: -0.55 };
}

function previewLoop(now) {
  if (!pv.running) return;
  pv.raf = requestAnimationFrame(previewLoop);
  const canvas = pv.renderer.domElement;
  if (canvas.clientWidth && (canvas.width !== Math.floor(canvas.clientWidth * pv.renderer.getPixelRatio()))) {
    pv.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    pv.camera.aspect = canvas.clientWidth / canvas.clientHeight;
    pv.camera.updateProjectionMatrix();
  }
  pv.holder.rotation.y = pv.angle + now / 4200;
  // la vitrine vit : bob de caisse, armes qui tournent, flammes — quantifié 12 fps (« on twos »)
  if (pv.model) {
    const t = Math.floor(now / 83) * 83;
    const m = pv.model;
    m.bodyGroup.position.y = pv.bodyY + Math.sin(t / 280) * 0.025;
    m.bodyGroup.rotation.z = Math.sin(t / 280) * 0.01;
    const tq = t / 1000;
    for (const anim of m.spins) {
      // rotation lente (~0.5 tr/s), même consommation que syncCar en combat
      for (const s of anim.spin) {
        if (anim.axis === 'x') s.rotation.x = tq * 3.2;
        else s.rotation.z = -tq * 3.2;
      }
    }
    for (const f of m.flames) {
      const k = 0.8 + ((t / 83) % 3) * 0.15;
      f.scale.set(k, 0.9 + ((t / 83) % 2) * 0.2, k);
    }
  }
  // cadrage : tient dans le champ vertical ET horizontal
  const fit = pv.fit || 3.4;
  const vFov = pv.camera.fov * Math.PI / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * pv.camera.aspect);
  const dist = Math.max(
    (fit * 0.62) / Math.tan(vFov / 2),
    (fit * 0.56) / Math.tan(hFov / 2)
  );
  pv.camera.position.set(dist * 0.18, fit * 0.34, dist);
  pv.camera.lookAt(0, fit * 0.2, 0);
  pv.renderer.render(pv.scene, pv.camera);
}

export function startPreview() {
  ensurePreview();
  if (pv.running) return;
  pv.running = true;
  pv.raf = requestAnimationFrame(previewLoop);
}
export function stopPreview() {
  if (!pv) return;
  pv.running = false;
  cancelAnimationFrame(pv.raf);
}

function refreshPreviewModel(lo) {
  ensurePreview();
  disposeModel(pv.holder); // libère l'ancien modèle avant de le remplacer
  pv.holder.clear();
  pv.model = null;
  if (!lo.body) return;
  const spec = buildCarSpec(lo);
  const model = createCarModel(spec);
  poseCarStatic(model, 1);
  pv.holder.add(model);
  pv.fit = Math.max(spec.body.w * 0.02 * 1.6, 3.0);
  // gardé pour l'animation idle de previewLoop
  pv.model = model.userData;
  pv.bodyY = model.userData.bodyGroup.position.y; // base posée par poseCarStatic
}

// ---- interactions ----
export function initGarage() {
  document.querySelectorAll('.inv-tabs .tab').forEach(btn => {
    btn.addEventListener('click', () => {
      sfxClick();
      currentTab = btn.dataset.tab;
      document.querySelectorAll('.inv-tabs .tab').forEach(b => b.classList.toggle('active', b === btn));
      renderInventory();
    });
  });
  document.getElementById('sheet-close').addEventListener('click', closeSheet);
  document.getElementById('part-sheet').addEventListener('click', e => {
    if (e.target.id === 'part-sheet') closeSheet();
  });
  document.getElementById('btn-equip').addEventListener('click', () => {
    if (!sheetPart) return;
    sfxClick();
    if (isEquipped(sheetPart.id) && sheetPart.kind !== 'body') unequip(sheetPart.id);
    else {
      const ejected = equip(sheetPart);
      if (ejected && ejected.length) {
        const names = ejected.map(id => getPart(id) ? partDef(getPart(id)).name : '').filter(Boolean);
        if (names.length) garageToast(`${names.join(', ')} retirée${names.length > 1 ? 's' : ''} (plus de place)`);
      }
    }
    closeSheet();
    renderGarage();
  });
  document.getElementById('btn-upgrade').addEventListener('click', () => {
    if (!sheetPart) return;
    const cost = upgradeCost(sheetPart);
    if (sheetPart.level >= maxLevel(sheetPart) || state.coins < cost) { sfxDenied(); return; }
    sfxBuy(); // achat réussi : son de caisse, pas un simple clic
    state.coins -= cost;
    sheetPart.level++;
    save();
    openSheet(sheetPart);
    renderGarage();
  });
  // recyclage en deux temps : le premier tap arme, le second exécute
  const btnRec = document.getElementById('btn-recycle');
  btnRec.addEventListener('click', () => {
    if (!sheetPart) return;
    sfxClick();
    if (!recycleArmed) {
      recycleArmed = true;
      btnRec.textContent = `Confirmer +${recycleValue(sheetPart)} ?`; // garde la valeur sous les yeux
      clearTimeout(recycleTimer);
      recycleTimer = setTimeout(() => {
        recycleArmed = false;
        if (sheetPart) btnRec.textContent = `Recycler · +${recycleValue(sheetPart)}`;
      }, 3000);
      return;
    }
    clearTimeout(recycleTimer);
    recycleArmed = false;
    state.coins += recycleValue(sheetPart);
    removePart(sheetPart);
    closeSheet();
    renderGarage();
  });
  document.getElementById('copilot-close').addEventListener('click', closeCopilotSheet);
  document.getElementById('copilot-sheet').addEventListener('click', e => {
    if (e.target.id === 'copilot-sheet') closeCopilotSheet();
  });
}

// ---- co-pilotes ----
function openCopilotSheet() {
  const sheet = document.getElementById('copilot-sheet');
  sheet.classList.remove('hidden');
  const list = document.getElementById('copilot-list');
  list.innerHTML = '';
  const li = leagueIndex(state.stage);
  for (const [id, cp] of Object.entries(COPILOTS)) {
    const locked = li < cp.unlock && !state.copilotsBought.includes(id);
    const el = document.createElement('div');
    el.className = 'copilot-card' + (state.copilot === id ? ' selected' : '') + (locked ? ' locked' : '');
    const img = document.createElement('img');
    img.src = copilotThumb(id);
    el.appendChild(img);
    const info = document.createElement('div');
    const nm = document.createElement('div');
    nm.className = 'cp-name';
    nm.textContent = cp.name;
    info.appendChild(nm);
    // passif et pouvoir actif sur deux lignes distinctes, avec micro-labels
    for (const [label, cls, txt] of [['PASSIF', 'cp-tag-passive', cp.passive], ['ACTIF', 'cp-tag-active', cp.active]]) {
      const line = document.createElement('div');
      line.className = 'cp-desc';
      const tag = document.createElement('span');
      tag.className = 'cp-tag ' + cls;
      tag.textContent = label;
      line.appendChild(tag);
      line.appendChild(document.createTextNode(' ' + txt));
      info.appendChild(line);
    }
    el.appendChild(info);
    if (locked) {
      const lock = document.createElement('div');
      lock.className = 'cp-lock';
      lock.textContent = `Ligue ${LEAGUES[cp.unlock].name}`;
      el.appendChild(lock);
    } else {
      el.addEventListener('click', () => {
        sfxClick();
        state.copilot = id;
        save();
        closeCopilotSheet();
        renderGarage();
      });
    }
    list.appendChild(el);
  }
}
function closeCopilotSheet() {
  document.getElementById('copilot-sheet').classList.add('hidden');
}

// La PUISSANCE est une synthèse, pas une nouvelle statistique de jeu : elle ne
// sert qu'à trancher d'un coup d'œil « ce montage est-il meilleur ? ». L'attaque
// pèse plus lourd que les PV parce qu'un combat se gagne en tapant.
export function machinePower(stats) {
  return Math.round(stats.hp + stats.atk * 3);
}
let lastPower = null, bestHp = 1, bestAtk = 1;

// Numéro de série lisible et stable, dérivé de l'identifiant de la pièce.
function serialOf(id) {
  let h = 0;
  for (let i = 0; i < String(id).length; i++) h = (h * 31 + String(id).charCodeAt(i)) & 0xffff;
  return String(h % 10000).padStart(4, '0');
}

export function renderGarage() {
  document.getElementById('coins').textContent = state.coins;
  const li = leagueIndex(state.stage);
  const chip = document.getElementById('stage-label');
  const prestige = state.prestige > 0 ? `★${state.prestige} · ` : '';
  chip.textContent = `${prestige}${LEAGUES[li].name} · Ét. ${state.stage}`;
  chip.parentElement.querySelector('.ic').style.color = LEAGUES[li].color;
  document.getElementById('stage-fill').style.width =
    (state.medals.length / MEDALS_TO_ADVANCE * 100) + '%';

  const lo = buildLoadout();
  const stats = computeCarStats(lo);
  const over = stats.used > stats.capacity;

  // LA PUISSANCE : le seul chiffre qui répond à « ma machine est-elle bonne ? ».
  // Sans lui le joueur devait comparer PV et ATQ de tête pour trancher.
  const power = machinePower(stats);
  document.getElementById('stat-power').textContent = power.toLocaleString('fr-FR');
  const deltaEl = document.getElementById('stat-power-delta');
  const diff = lastPower === null ? 0 : power - lastPower;
  if (diff !== 0) {
    deltaEl.className = 'delta ' + (diff > 0 ? 'up' : 'dn');
    deltaEl.textContent = (diff > 0 ? '▲' : '▼') + Math.abs(diff).toLocaleString('fr-FR');
  } else {
    deltaEl.className = 'delta hidden';
  }
  lastPower = power;

  document.getElementById('stat-hp').textContent = stats.hp;
  document.getElementById('stat-atk').textContent = stats.atk;
  // les micro-barres sont RELATIVES au meilleur montage déjà vu : une barre
  // pleine en permanence ne dirait rien
  bestHp = Math.max(bestHp, stats.hp);
  bestAtk = Math.max(bestAtk, stats.atk);
  document.getElementById('bar-hp').style.width = (stats.hp / Math.max(1, bestHp) * 100) + '%';
  document.getElementById('bar-atk').style.width = (stats.atk / Math.max(1, bestAtk) * 100) + '%';

  // LA JAUGE D'ÉNERGIE : un cran par point. Les crans au-delà de la capacité du
  // châssis sont hachurés en rouge — le dépassement se voit avant de se lire.
  document.getElementById('stat-energy').textContent = `${stats.used}/${stats.capacity}`;
  const track = document.getElementById('energy-track');
  track.innerHTML = '';
  const total = Math.max(stats.capacity, stats.used, 1);
  for (let i = 0; i < total; i++) {
    const seg = document.createElement('i');
    seg.className = 'eseg' + (i < stats.used ? (i >= stats.capacity ? ' over' : ' on') : '');
    track.appendChild(seg);
  }
  document.getElementById('energy-dial').classList.toggle('over', over);

  const warning = document.getElementById('energy-warning');
  const valid = loadoutValid(lo);
  if (over) {
    warning.textContent = 'Énergie dépassée — retire une arme ou un gadget !';
    warning.classList.remove('hidden');
  } else if (!valid) {
    warning.textContent = !lo.body ? 'Équipe un corps !'
      : lo.wheels.length < 2 ? 'Il manque une roue !'
      : 'Équipe au moins une arme !';
    warning.classList.remove('hidden');
  } else {
    warning.classList.add('hidden');
  }
  document.getElementById('btn-fight').disabled = !valid;
  document.getElementById('btn-quick').disabled = !valid;
  // le bouton dit CONTRE QUI on part : « championnat » tout seul ne situait rien
  const fightSub = document.getElementById('fight-sub');
  if (fightSub) fightSub.textContent = `Étape ${state.stage} · ${state.medals.length}/${MEDALS_TO_ADVANCE} médailles`;

  refreshPreviewModel(lo);
  startPreview();
  // petit nom de la machine, façon écurie de course
  const MACHINE_NAMES = {
    classic: 'Le Matou Turbo', titan: 'Le Gros Costaud', surfer: 'La Planche Filante',
    whale: 'La Baleine Blindée', pony: 'Le Poney Fou',
  };
  const nameEl = document.getElementById('machine-name');
  if (nameEl) {
    nameEl.innerHTML = '';
    if (lo.body) {
      const b = document.createElement('b');
      b.textContent = MACHINE_NAMES[lo.body.type] || 'La Machine';
      const sn = document.createElement('small');
      // numéro de série dérivé de l'id de la pièce : stable, et ça signe l'objet
      sn.textContent = 'N° MK-' + serialOf(lo.body.id);
      nameEl.append(b, sn);
    }
  }
  renderSlots(lo);
  renderSets(lo);
  renderInventory();
}

// Badges des sets de pièces (affichés dès 2 pièces du set équipées).
let knownActiveSets = null;
function renderSets(lo) {
  const row = document.getElementById('sets-row');
  if (!row) return;
  row.innerHTML = '';
  const sets = activeSets(lo);
  for (const s of sets) {
    if (s.count < 2) continue;
    const chip = document.createElement('div');
    chip.className = 'set-chip' + (s.active ? ' set-active' : '');
    chip.textContent = `${s.name} ${Math.min(s.count, s.need)}/${s.need}`;
    chip.title = s.desc;
    row.appendChild(chip);
  }
  // toast à l'activation d'un set (pas au premier rendu)
  const nowActive = sets.filter(s => s.active).map(s => s.key);
  if (knownActiveSets !== null) {
    for (const s of sets) {
      if (s.active && !knownActiveSets.includes(s.key)) {
        garageToast(`Set ${s.name} activé : ${s.desc} !`);
      }
    }
  }
  knownActiveSets = nowActive;
}

function renderSlots(lo) {
  const row = document.getElementById('slots-row');
  row.innerHTML = '';

  // LE PILOTE D'ABORD, et pas sous la même forme que les pièces : c'est
  // quelqu'un, pas un composant. Un cordon de soudure l'isole du mécanique.
  const cpSlot = document.createElement('div');
  cpSlot.className = 'slot pilot';
  const medal = document.createElement('div');
  medal.className = 'pilot-medal';
  const cpImg = document.createElement('img');
  cpImg.src = copilotThumb(state.copilot);
  cpImg.alt = COPILOTS[state.copilot]?.name || 'Co-pilote';
  medal.appendChild(cpImg);
  cpSlot.appendChild(medal);
  const cpTag = document.createElement('div');
  cpTag.className = 'slot-tag';
  cpTag.textContent = 'Pilote';
  cpSlot.appendChild(cpTag);
  cpSlot.addEventListener('click', () => { sfxClick(); openCopilotSheet(); });
  row.appendChild(cpSlot);
  const weld = document.createElement('i');
  weld.className = 'weld';
  row.appendChild(weld);

  const bDef = lo.body ? partDef(lo.body) : null;
  const defs = [
    { label: 'Corps', kind: 'body', part: lo.body },
    { label: 'Roue', kind: 'wheel', part: lo.wheels[0] },
    { label: 'Roue', kind: 'wheel', part: lo.wheels[1] },
  ];
  const nW = bDef ? bDef.weaponSlots : 1;
  for (let i = 0; i < nW; i++) defs.push({ label: 'Arme', kind: 'weapon', part: lo.weapons[i] });
  const nG = bDef ? bDef.gadgetSlots : 0;
  for (let i = 0; i < nG; i++) defs.push({ label: 'Gadget', kind: 'gadget', part: lo.gadgets[i] });

  for (const d of defs) {
    const el = document.createElement('div');
    el.className = `slot k-${d.kind} ` + (d.part ? 'filled' : 'empty');
    const well = document.createElement('div');
    well.className = 'slot-well';
    if (d.part) {
      // le liseré du logement reprend la couleur du palier : la rareté se lit
      // sur le montage, pas seulement dans l'inventaire
      el.style.setProperty('--rc', `var(--r${Math.min(5, Math.max(1, d.part.stars || 1))})`);
      const img = document.createElement('img');
      img.src = partThumb(d.part);
      img.alt = partDef(d.part).name;
      well.appendChild(img);
      const lv = document.createElement('div');
      lv.className = 'slot-lv';
      lv.textContent = d.part.level;
      el.appendChild(lv);
      el.addEventListener('click', () => { sfxClick(); openSheet(d.part); });
    } else {
      const plus = document.createElement('i');
      plus.className = 'plus';
      well.appendChild(plus);
    }
    el.appendChild(well);
    const tag = document.createElement('div');
    tag.className = 'slot-tag';
    tag.textContent = d.label;
    el.appendChild(tag);
    row.appendChild(el);
  }
}

function renderInventory() {
  const inv = document.getElementById('inventory');
  inv.innerHTML = '';
  // compte par onglet : une icône seule ne dit ni ce qu'elle range, ni combien
  const counts = { body: 0, wheel: 0, weapon: 0, gadget: 0 };
  for (const p of state.inventory) if (counts[p.kind] !== undefined) counts[p.kind]++;
  document.querySelectorAll('.inv-tabs .tab').forEach(t => {
    const u = t.querySelector('u');
    if (u) u.textContent = counts[t.dataset.tab] ?? 0;
  });
  const parts = state.inventory.filter(p => p.kind === currentTab);
  if (!parts.length) {
    const e = document.createElement('div');
    e.className = 'inv-empty';
    e.textContent = 'Aucune pièce — gagne des combats pour en obtenir !';
    inv.appendChild(e);
    return;
  }
  parts.sort((a, b) => (b.stars - a.stars) || (b.level - a.level));
  // pièce équipée de référence pour la comparaison rapide sur carte
  const lo = buildLoadout();
  const eqByKind = { body: lo.body, wheel: lo.wheels[0], weapon: lo.weapons[0], gadget: lo.gadgets[0] };
  for (const p of parts) {
    const el = document.createElement('div');
    // la classe stars-N rend le tri par rareté visible (fond teinté en CSS)
    el.className = `inv-item stars-${p.stars}` + (isEquipped(p.id) ? ' equipped' : '');
    const img = document.createElement('img');
    img.src = partThumb(p);
    el.appendChild(img);
    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.textContent = partDef(p).name;
    el.appendChild(nm);
    // La rareté n'est plus une chaîne d'étoiles : c'est une BANDE GRADUÉE sur le
    // chant de la carte, dans la couleur du palier — la même que la machine
    // porte en 3D. Elle ne coûte pas une ligne de texte, et elle se compare
    // d'un coup d'œil entre deux cartes voisines.
    const rar = document.createElement('div');
    rar.className = 'rar';
    for (let k = 0; k < 5; k++) {
      const n = document.createElement('i');
      if (k < p.stars) n.className = 'on';
      rar.appendChild(n);
    }
    el.appendChild(rar);
    const lv = document.createElement('div');
    lv.className = 'lv';
    lv.textContent = 'Nv ' + p.level;
    el.appendChild(lv);
    const [sk, sv] = partStats(p)[0];
    const ms = document.createElement('div');
    ms.className = 'ms';
    ms.textContent = `${sk} ${sv}`;
    el.appendChild(ms);
    // VERDICT en bandeau pleine largeur : c'est la seule décision que le joueur
    // a à prendre ici. Un petit chevron collé à la stat ne se voyait pas.
    const eq = eqByKind[p.kind];
    const band = document.createElement('div');
    if (isEquipped(p.id)) {
      band.className = 'vband on';
      band.textContent = 'MONTÉ';
    } else if (eq && eq.id !== p.id) {
      const a = parseFloat(sv), b = parseFloat(partStats(eq)[0][1]);
      if (Number.isFinite(a) && Number.isFinite(b) && a !== b) {
        const dec = Number.isInteger(a) && Number.isInteger(b) ? 1 : 10;
        const gap = Math.round(Math.abs(a - b) * dec) / dec;
        band.className = 'vband ' + (a > b ? 'up' : 'dn');
        band.textContent = `${a > b ? '▲' : '▼'} ${gap}`;
      }
    }
    if (band.className) el.appendChild(band);
    el.addEventListener('click', () => { sfxClick(); openSheet(p); });
    inv.appendChild(el);
  }
}

function openSheet(part) {
  sheetPart = part;
  document.getElementById('part-sheet').classList.remove('hidden');
  document.getElementById('part-img').src = partThumb(part);
  document.getElementById('part-name').textContent = `${partDef(part).name}`;
  document.getElementById('part-stars').textContent = '★'.repeat(part.stars) + '☆'.repeat(5 - part.stars);
  document.getElementById('part-level').textContent = `${KIND_LABEL[part.kind]} · Niveau ${part.level}/${maxLevel(part)}`;
  const list = document.getElementById('part-statlist');
  list.innerHTML = '';
  // aperçu du prochain niveau : objet jetable, aucune mutation de la pièce
  const nextStats = part.level < maxLevel(part) ? partStats({ ...part, level: part.level + 1 }) : null;
  partStats(part).forEach(([k, v], i) => {
    const el = document.createElement('div');
    el.className = 'ps';
    const small = document.createElement('small');
    small.textContent = k;
    el.appendChild(small);
    el.appendChild(document.createTextNode(String(v)));
    if (nextStats && String(nextStats[i][1]) !== String(v)) {
      el.appendChild(document.createTextNode(' → '));
      const nx = document.createElement('span');
      nx.className = 'ps-next';
      nx.style.color = 'var(--go)';
      nx.style.fontWeight = '800';
      nx.textContent = String(nextStats[i][1]);
      el.appendChild(nx);
    }
    list.appendChild(el);
  });
  // autocollants (corps uniquement) — la seule cosmétique du jeu
  const stickerRow = document.getElementById('sticker-row');
  stickerRow.innerHTML = '';
  if (part.kind === 'body') {
    stickerRow.classList.remove('hidden');
    for (const st of STICKERS) {
      const owned = stickerOwned(st.id, STICKERS);
      const sw = document.createElement('button');
      sw.className = 'sticker-swatch' + (part.sticker === st.id ? ' selected' : '') + (owned ? '' : ' locked');
      sw.title = st.name;
      sw.setAttribute('aria-label', st.name);
      if (owned) {
        const img = document.createElement('img');
        img.src = stickerTexture(st.id).image.toDataURL('image/png');
        img.alt = st.name;
        sw.appendChild(img);
      } else {
        sw.innerHTML = '<svg class="ic"><use href="#i-lock"/></svg>';
      }
      sw.addEventListener('click', () => {
        sfxClick();
        if (!owned) { garageToast('Débloque cet autocollant à la Boutique !'); return; }
        part.sticker = part.sticker === st.id ? undefined : st.id;
        save();
        openSheet(part);
        renderGarage();
      });
      stickerRow.appendChild(sw);
    }
  } else {
    stickerRow.classList.add('hidden');
  }

  const equipped = isEquipped(part.id);

  // COMPARAISON avec la pièce déjà montée du même type : c'est LA décision de
  // cet écran, et rien ne la posait jusqu'ici.
  const cmp = document.getElementById('part-compare');
  const lo = buildLoadout();
  const mounted = { body: lo.body, wheel: lo.wheels[0], weapon: lo.weapons[0], gadget: lo.gadgets[0] }[part.kind];
  cmp.className = 'part-compare';
  cmp.innerHTML = '';
  if (equipped || !mounted || mounted.id === part.id) {
    cmp.classList.add('hidden');
  } else {
    const [, mine] = partStats(part)[0];
    const [, theirs] = partStats(mounted)[0];
    const a = parseFloat(mine), b = parseFloat(theirs);
    const lab = document.createElement('span');
    lab.className = 'pc-lab';
    lab.textContent = 'Montée';
    const nm = document.createElement('span');
    nm.className = 'pc-nm';
    nm.textContent = `${partDef(mounted).name} Nv ${mounted.level} · ${theirs}`;
    cmp.append(lab, nm);
    if (Number.isFinite(a) && Number.isFinite(b) && a !== b) {
      const vd = document.createElement('span');
      vd.className = 'pc-vd ' + (a > b ? 'up' : 'dn');
      vd.textContent = (a > b ? '▲' : '▼') + Math.round(Math.abs(a - b) * 10) / 10;
      cmp.appendChild(vd);
    }
    // l'énergie est la seule contrainte dure : prévenir AVANT le montage
    const stats = computeCarStats(lo);
    const delta = (partDef(part).energy || 0) - (partDef(mounted).energy || 0);
    if (stats.used + delta > stats.capacity) {
      cmp.classList.add('over');
      const warn = document.createElement('span');
      warn.className = 'pc-vd dn';
      warn.textContent = '⚡!';
      cmp.appendChild(warn);
    }
  }

  const btnEquip = document.getElementById('btn-equip');
  btnEquip.textContent = equipped ? (part.kind === 'body' ? 'Équipé' : 'Retirer') : 'Équiper';
  btnEquip.disabled = equipped && part.kind === 'body';

  const btnUp = document.getElementById('btn-upgrade');
  // HIÉRARCHIE BASCULANTE : sur une pièce à monter, l'action dominante est
  // « équiper » ; sur une pièce déjà montée, c'est « améliorer ». Le bouton
  // dominant n'est jamais celui qui défait ce que le joueur vient de faire.
  const actions = document.querySelector('.sheet-actions');
  const row = document.querySelector('.sheet-actions-row');
  const primary = equipped ? btnUp : btnEquip;
  const second = equipped ? btnEquip : btnUp;
  btnEquip.className = equipped ? 'btn outline' : 'btn primary full';
  btnUp.className = equipped ? 'btn gold full' : 'btn outline';
  actions.insertBefore(primary, row);
  row.insertBefore(second, row.firstChild);
  if (part.level >= maxLevel(part)) {
    btnUp.textContent = 'Niveau MAX';
    btnUp.disabled = true;
  } else {
    const cost = upgradeCost(part);
    btnUp.textContent = `Améliorer · ${cost}`;
    btnUp.disabled = state.coins < cost;
  }
  recycleArmed = false;
  clearTimeout(recycleTimer);
  const btnRec = document.getElementById('btn-recycle');
  btnRec.className = 'btn scrap';
  btnRec.textContent = `Recycler · +${recycleValue(part)}`;
  btnRec.disabled = equipped;
}

function closeSheet() {
  sheetPart = null;
  document.getElementById('part-sheet').classList.add('hidden');
}
