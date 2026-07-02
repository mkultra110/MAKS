// Écran garage : aperçu 3D du véhicule, emplacements, inventaire, fiche pièce.
import * as THREE from 'three';
import { KIND_LABEL, partDef, partStats, maxLevel, upgradeCost, recycleValue, COPILOTS, PAINTS, LEAGUES, leagueIndex } from './data.js';
import { state, save, isEquipped, buildLoadout, computeCarStats, loadoutValid, equip, unequip, removePart, getPart, MEDALS_TO_ADVANCE } from './state.js';
import { buildCarSpec } from './car.js';
import { createRenderer, createStudioScene, disposeModel } from './render3d.js';
import { createCarModel, poseCarStatic } from './models3d.js';
import { partThumb, copilotThumb } from './thumbs.js';
import { sfxClick } from './sfx.js';

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
  const scene = createStudioScene();
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
  if (!lo.body) return;
  const spec = buildCarSpec(lo);
  const model = createCarModel(spec);
  poseCarStatic(model, 1);
  pv.holder.add(model);
  pv.fit = Math.max(spec.body.w * 0.02 * 1.6, 3.0);
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
    if (sheetPart.level >= maxLevel(sheetPart) || state.coins < cost) return;
    sfxClick();
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
      btnRec.textContent = 'Confirmer ?';
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
    const locked = li < cp.unlock;
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
    const desc = document.createElement('div');
    desc.className = 'cp-desc';
    desc.textContent = `${cp.passive} · ${cp.active}`;
    info.appendChild(desc);
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

export function renderGarage() {
  document.getElementById('coins').textContent = state.coins;
  const li = leagueIndex(state.stage);
  const chip = document.getElementById('stage-label');
  chip.textContent = `${LEAGUES[li].name} · Ét. ${state.stage}`;
  chip.parentElement.querySelector('.ic').style.color = LEAGUES[li].color;
  document.getElementById('stage-fill').style.width =
    (state.medals.length / MEDALS_TO_ADVANCE * 100) + '%';

  const lo = buildLoadout();
  const stats = computeCarStats(lo);
  document.getElementById('stat-hp').textContent = stats.hp;
  document.getElementById('stat-atk').textContent = stats.atk;
  document.getElementById('stat-energy').textContent = `${stats.used}/${stats.capacity}`;
  const fill = document.getElementById('energy-fill');
  fill.style.width = Math.min(100, stats.used / Math.max(1, stats.capacity) * 100) + '%';
  const over = stats.used > stats.capacity;
  fill.classList.toggle('over', over);
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

  refreshPreviewModel(lo);
  startPreview();
  renderSlots(lo);
  renderInventory();
}

function renderSlots(lo) {
  const row = document.getElementById('slots-row');
  row.innerHTML = '';

  // emplacement co-pilote en premier
  const cpSlot = document.createElement('div');
  cpSlot.className = 'slot filled';
  const cpImg = document.createElement('img');
  cpImg.src = copilotThumb(state.copilot);
  cpSlot.appendChild(cpImg);
  const cpTag = document.createElement('div');
  cpTag.className = 'slot-tag';
  cpTag.textContent = 'Co-pilote';
  cpSlot.appendChild(cpTag);
  cpSlot.addEventListener('click', () => { sfxClick(); openCopilotSheet(); });
  row.appendChild(cpSlot);

  const bDef = lo.body ? partDef(lo.body) : null;
  const defs = [
    { label: 'Corps', part: lo.body },
    { label: 'Roue', part: lo.wheels[0] },
    { label: 'Roue', part: lo.wheels[1] },
  ];
  const nW = bDef ? bDef.weaponSlots : 1;
  for (let i = 0; i < nW; i++) defs.push({ label: 'Arme', part: lo.weapons[i] });
  const nG = bDef ? bDef.gadgetSlots : 0;
  for (let i = 0; i < nG; i++) defs.push({ label: 'Gadget', part: lo.gadgets[i] });

  for (const d of defs) {
    const el = document.createElement('div');
    el.className = 'slot' + (d.part ? ' filled' : '');
    if (d.part) {
      const img = document.createElement('img');
      img.src = partThumb(d.part);
      el.appendChild(img);
      el.addEventListener('click', () => { sfxClick(); openSheet(d.part); });
    } else {
      el.appendChild(document.createTextNode('+'));
    }
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
  const parts = state.inventory.filter(p => p.kind === currentTab);
  if (!parts.length) {
    const e = document.createElement('div');
    e.className = 'inv-empty';
    e.textContent = 'Aucune pièce — gagne des combats pour en obtenir !';
    inv.appendChild(e);
    return;
  }
  parts.sort((a, b) => (b.stars - a.stars) || (b.level - a.level));
  for (const p of parts) {
    const el = document.createElement('div');
    el.className = 'inv-item' + (isEquipped(p.id) ? ' equipped' : '');
    const img = document.createElement('img');
    img.src = partThumb(p);
    el.appendChild(img);
    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.textContent = partDef(p).name;
    el.appendChild(nm);
    const st = document.createElement('div');
    st.className = 'st';
    st.textContent = '★'.repeat(p.stars);
    el.appendChild(st);
    const lv = document.createElement('div');
    lv.className = 'lv';
    lv.textContent = 'n.' + p.level;
    el.appendChild(lv);
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
  for (const [k, v] of partStats(part)) {
    const el = document.createElement('div');
    el.className = 'ps';
    const small = document.createElement('small');
    small.textContent = k;
    el.appendChild(small);
    el.appendChild(document.createTextNode(String(v)));
    list.appendChild(el);
  }
  // peinture (corps uniquement)
  const paintRow = document.getElementById('paint-row');
  paintRow.innerHTML = '';
  if (part.kind === 'body') {
    paintRow.classList.remove('hidden');
    for (const color of PAINTS) {
      const sw = document.createElement('button');
      sw.className = 'paint-swatch' + ((part.paint || '') === color ? ' selected' : '');
      sw.style.background = `linear-gradient(180deg, ${color}, ${color}cc)`;
      sw.addEventListener('click', () => {
        sfxClick();
        part.paint = part.paint === color ? undefined : color;
        save();
        openSheet(part);
        renderGarage();
      });
      paintRow.appendChild(sw);
    }
  } else {
    paintRow.classList.add('hidden');
  }

  const equipped = isEquipped(part.id);
  const btnEquip = document.getElementById('btn-equip');
  btnEquip.textContent = equipped ? (part.kind === 'body' ? 'Équipé' : 'Retirer') : 'Équiper';
  btnEquip.disabled = equipped && part.kind === 'body';

  const btnUp = document.getElementById('btn-upgrade');
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
  btnRec.textContent = `Recycler · +${recycleValue(part)}`;
  btnRec.disabled = equipped;
}

function closeSheet() {
  sheetPart = null;
  document.getElementById('part-sheet').classList.add('hidden');
}
