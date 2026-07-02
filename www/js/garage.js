// Écran garage : aperçu 3D du véhicule, emplacements, inventaire, fiche pièce.
import * as THREE from 'three';
import { KIND_LABEL, partDef, partStats, maxLevel, upgradeCost, recycleValue } from './data.js';
import { state, save, isEquipped, buildLoadout, computeCarStats, equip, unequip, removePart, WINS_PER_STAGE } from './state.js';
import { buildCarSpec } from './car.js';
import { createRenderer, createStudioScene } from './render3d.js';
import { createCarModel, poseCarStatic } from './models3d.js';
import { partThumb } from './thumbs.js';
import { sfxClick } from './sfx.js';

let currentTab = 'body';
let sheetPart = null;

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
    else equip(sheetPart);
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
  document.getElementById('btn-recycle').addEventListener('click', () => {
    if (!sheetPart) return;
    sfxClick();
    state.coins += recycleValue(sheetPart);
    removePart(sheetPart);
    closeSheet();
    renderGarage();
  });
}

export function renderGarage() {
  document.getElementById('coins').textContent = state.coins;
  document.getElementById('stage-label').textContent =
    `Étape ${state.stage} · ${state.stageWins}/${WINS_PER_STAGE}`;
  document.getElementById('stage-fill').style.width = (state.stageWins / WINS_PER_STAGE * 100) + '%';

  const lo = buildLoadout();
  const stats = computeCarStats(lo);
  document.getElementById('stat-hp').textContent = stats.hp;
  document.getElementById('stat-atk').textContent = stats.atk;
  document.getElementById('stat-energy').textContent = `${stats.used}/${stats.capacity}`;
  const fill = document.getElementById('energy-fill');
  fill.style.width = Math.min(100, stats.used / Math.max(1, stats.capacity) * 100) + '%';
  const over = stats.used > stats.capacity;
  fill.classList.toggle('over', over);
  document.getElementById('energy-warning').classList.toggle('hidden', !over);
  document.getElementById('btn-fight').disabled = over || !lo.body || lo.weapons.length === 0;
  document.getElementById('btn-quick').disabled = over || !lo.body || lo.weapons.length === 0;

  refreshPreviewModel(lo);
  startPreview();
  renderSlots(lo);
  renderInventory();
}

function renderSlots(lo) {
  const row = document.getElementById('slots-row');
  row.innerHTML = '';
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
  const btnRec = document.getElementById('btn-recycle');
  btnRec.textContent = `Recycler · +${recycleValue(part)}`;
  btnRec.disabled = equipped;
}

function closeSheet() {
  sheetPart = null;
  document.getElementById('part-sheet').classList.add('hidden');
}
