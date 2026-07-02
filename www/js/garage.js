// Écran garage : aperçu du véhicule, emplacements, inventaire, fiche pièce.
import { KIND_LABEL, partDef, partStats, maxLevel, upgradeCost, recycleValue } from './data.js';
import { state, save, getPart, isEquipped, buildLoadout, computeCarStats, equip, unequip, removePart, WINS_PER_STAGE } from './state.js';
import { buildCarSpec, drawCarStatic, drawPartThumb } from './car.js';
import { sfxClick } from './sfx.js';

let currentTab = 'body';
let sheetPart = null;

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
    `Étape ${state.stage} — victoire ${state.stageWins + 1}/${WINS_PER_STAGE}`;
  document.getElementById('stage-fill').style.width = (state.stageWins / WINS_PER_STAGE * 100) + '%';

  const lo = buildLoadout();
  const stats = computeCarStats(lo);
  document.getElementById('stat-hp').textContent = stats.hp;
  document.getElementById('stat-atk').textContent = stats.atk;
  document.getElementById('stat-energy').textContent = `${stats.used}/${stats.capacity}`;
  const over = stats.used > stats.capacity;
  document.getElementById('energy-warning').classList.toggle('hidden', !over);
  document.getElementById('btn-fight').disabled = over || !lo.body || lo.weapons.length === 0;
  document.getElementById('btn-quick').disabled = over || !lo.body || lo.weapons.length === 0;

  renderPreview(lo);
  renderSlots(lo, stats);
  renderInventory();
}

function renderPreview(lo) {
  const canvas = document.getElementById('preview-canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // sol
  ctx.fillStyle = 'rgba(0,0,20,.35)';
  ctx.fillRect(0, canvas.height * 0.82, canvas.width, canvas.height * 0.18);
  if (lo.body) {
    const spec = buildCarSpec(lo);
    drawCarStatic(ctx, spec, canvas.width / 2, canvas.height * 0.82, Math.min(canvas.width / 420, canvas.height / 260) * 1.15);
  } else {
    ctx.fillStyle = '#9a9ac4';
    ctx.font = `700 ${14 * dpr}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('Équipe un corps !', canvas.width / 2, canvas.height / 2);
  }
}

function renderSlots(lo, stats) {
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
      const cv = document.createElement('canvas');
      cv.width = 104; cv.height = 80;
      el.appendChild(cv);
      drawPartThumb(cv, d.part);
      el.addEventListener('click', () => { sfxClick(); openSheet(d.part); });
    } else {
      el.textContent = '+';
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
    const cv = document.createElement('canvas');
    cv.width = 120; cv.height = 72;
    el.appendChild(cv);
    drawPartThumb(cv, p);
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
  drawPartThumb(document.getElementById('part-canvas'), part);
  document.getElementById('part-name').textContent = `${partDef(part).name} (${KIND_LABEL[part.kind]})`;
  document.getElementById('part-stars').textContent = '★'.repeat(part.stars) + '☆'.repeat(5 - part.stars);
  document.getElementById('part-level').textContent = `Niveau ${part.level} / ${maxLevel(part)}`;
  const list = document.getElementById('part-statlist');
  list.innerHTML = '';
  for (const [k, v] of partStats(part)) {
    const el = document.createElement('div');
    el.className = 'ps';
    el.innerHTML = `<small></small>`;
    el.querySelector('small').textContent = k;
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
    btnUp.textContent = `Améliorer 🪙${cost}`;
    btnUp.disabled = state.coins < cost;
  }
  const btnRec = document.getElementById('btn-recycle');
  btnRec.textContent = `Recycler +🪙${recycleValue(part)}`;
  btnRec.disabled = equipped;
}

function closeSheet() {
  sheetPart = null;
  document.getElementById('part-sheet').classList.add('hidden');
}
