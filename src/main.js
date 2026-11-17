// Bamboofy — app shell: state, tools, panels, analysis loop.
import { Viewer, stressColor } from './render.js';
import { emptyModel, addNode, addMember, removeMember, removeNode, clone, validate, FORMAT } from './model.js';
import { GENERATORS, PRESETS, defaultsFor, runGenerators } from './generators.js';
import { SPECIES, JOINTS, SUPPORTS, SKINS } from './materials.js';
import { analyse, breakIt, effectiveJoint, effectiveSupport } from './analysis.js';
import { defaultScenario } from './loads.js';
import { cutList, billOfMaterials, bomCSV, toCSV, download, kitHTML } from './exports.js';
import { terrainHeight } from './terrain.js';
import { PoleDrawer } from './draw.js';
import { ViewCube } from './viewcube.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { Object3D as THREE_Object } from 'three';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const STORE = 'bamboofy.design.v1', STORE_SC = 'bamboofy.scenario.v1';

const app = {
  model: null,
  scenario: defaultScenario(),
  tool: 'select',
  sel: null,
  poleStart: null,
  result: null,
  history: [], future: [],
  breakRun: null,
  replayTimer: null
};

const lib = () => ({ ...structuredClone(SPECIES), ...(app.model?.library || {}) });

// ---------- persistence & history ----------
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(app.model)); localStorage.setItem(STORE_SC, JSON.stringify(app.scenario)); } catch {}
}
function snapshot() {
  app.history.push(JSON.stringify(app.model));
  if (app.history.length > 80) app.history.shift();
  app.future = [];
}
function commit({ regen = false, frame = false } = {}) {
  if (regen) runGenerators(app.model);
  clearBreak();
  save();
  analyseSoon();
  if (frame) setTimeout(() => viewer.frame(), 0);
}
function undo() {
  if (!app.history.length) return toast('Nothing to undo');
  app.future.push(JSON.stringify(app.model));
  app.model = JSON.parse(app.history.pop());
  afterLoad();
}
function redo() {
  if (!app.future.length) return;
  app.history.push(JSON.stringify(app.model));
  app.model = JSON.parse(app.future.pop());
  afterLoad();
}

// ---------- analysis loop ----------
let pending = false;
function analyseSoon() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    app.result = analyse(app.model, app.scenario, lib());
    render();
  });
}

function render() {
  const r = app.result;
  if (viewer.deformScale && r?.res?.maxDisp && !app.breakRun) viewer.deformScale = autoDeform(r.res.maxDisp);
  viewer.update(app.model, {
    lib: lib(),
    util: r?.chk,
    disp: r?.res?.disp,
    failed: app.breakRun?.failedShown,
    settleNode: app.scenario.settle.on ? app.scenario.settle.node : null
  });
  renderVerdict();
  renderInspector();
  renderStatus();
}

function autoDeform(maxDisp) {
  const b = viewer.bounds(); const size = b.getSize(new b.min.constructor()).length() || 10;
  return Math.max(1, Math.min(400, (size * 0.04) / Math.max(maxDisp, 1e-5)));
}

// ---------- verdict ----------
function verdictOf(u, mech) {
  if (mech) return { word: 'Collapses', color: 'var(--red)', sub: 'It cannot stand as drawn — it moves like a mechanism. Add bracing or supports.' };
  if (u === 0) return { word: 'Empty lot', color: 'var(--ink-3)', sub: 'Add a generator or draw your first pole.' };
  if (u < 0.5) return { word: 'Stands, calmly', color: '#5c9e5c', sub: 'Lots of reserve. You could push this form much further.' };
  if (u < 0.85) return { word: 'Stands', color: '#8fa04f', sub: 'Working, with healthy reserve.' };
  if (u <= 1) return { word: 'On the edge', color: 'var(--amber)', sub: 'Standing, but close to its limit under these forces.' };
  return { word: 'Fails', color: 'var(--red)', sub: 'Something gives under these forces. Find it below, then fix it.' };
}

function describe(it) {
  if (!it) return '';
  if (it.kind === 'member') {
    const m = app.model.members.find(x => x.id === it.id);
    return `Pole #${it.id} (${m?.role || 'frame'}, ${lib()[m?.species]?.name || ''}${m?.bundle > 1 ? ` ×${m.bundle}` : ''}) — ${it.mode}`;
  }
  if (it.kind === 'joint') return `Joint @${it.id} — ${it.mode}`;
  return `Plinth @${it.id} — ${it.mode}`;
}

function renderVerdict() {
  const r = app.result; const el = $('#verdict');
  if (!r) return;
  const u = r.chk.maxU || 0;
  const v = verdictOf(u, r.res.mechanism);
  updateEdgeVerdict(u, v.color);
  const totals = r.loads.totals;
  const kN = x => (x / 1000).toFixed(x > 100000 ? 0 : 1);
  const span = (() => { const b = viewer.bounds(); const s = b.getSize(b.min.clone()); return Math.max(s.x, s.z); })();
  const defl = r.res.maxDisp || 0;
  el.innerHTML = `
    <div class="big"><span class="dot" style="background:${v.color}"></span><span class="word">${v.word}</span></div>
    <div class="sub">${v.sub}</div>
    <div class="meter" title="Highest utilisation in the structure"><i style="left:${Math.min(100, u / 1.2 * 100)}%"></i></div>
    <div class="meter-scale"><span>0</span><span>working</span><span>limit</span></div>
    <dl class="kv">
      <dt>Hardest-working part</dt><dd>${u > 9.99 ? '>999' : (u * 100).toFixed(0)}% of capacity</dd>
      <dt>Reserve to first failure</dt><dd>${u > 0 ? (1 / u).toFixed(2) + '×' : '—'}</dd>
      <dt>Largest movement</dt><dd>${(defl * 1000).toFixed(defl < 0.01 ? 1 : 0)} mm${span > 0 && defl > 5e-4 && span / defl < 20000 ? ` (span/${Math.round(span / defl)})` : ''}</dd>
      <dt>Self-weight + skins</dt><dd>${kN(totals.dead + totals.skin)} kN</dd>
      ${totals.live ? `<dt>People</dt><dd>${kN(totals.live)} kN</dd>` : ''}
      ${totals.wind ? `<dt>Wind</dt><dd>${kN(totals.wind)} kN</dd>` : ''}
      ${totals.seismic ? `<dt>Earthquake push</dt><dd>${kN(totals.seismic)} kN</dd>` : ''}
      ${totals.flood ? `<dt>Flood drag</dt><dd>${kN(totals.flood)} kN</dd>` : ''}
      ${totals.point ? `<dt>Hung loads</dt><dd>${kN(totals.point)} kN</dd>` : ''}
    </dl>
    ${r.chk.critical ? `<div class="critical" id="goCritical" title="Select it">Weakest link: ${describe(r.chk.critical)} · ${r.chk.critical.u > 9.99 ? '>999' : (r.chk.critical.u * 100).toFixed(0)}%</div>` : ''}
  `;
  const gc = $('#goCritical');
  if (gc) gc.onclick = () => { const c = r.chk.critical; select(c.kind === 'member' ? { kind: 'member', id: c.id } : { kind: 'node', id: c.id }); };
}

function renderStatus() {
  const r = app.result;
  const m = app.model;
  const culms = m.members.reduce((a, x) => a + (x.bundle || 1), 0);
  $('#status').innerHTML = `<span><b>${m.members.length}</b> poles · <b>${culms}</b> culms</span><span><b>${m.nodes.length}</b> joints</span><span><b>${m.panels.length}</b> skin panels</span>
  <span>solved in <b>${r ? r.ms.toFixed(0) : '–'} ms</b>${r?.res?.dof ? ` · ${r.res.dof} DOF` : ''}</span>
  <span>${m.noMetal ? '<b>no-metal mode</b>' : ''}</span><span style="flex:1"></span><span>indicative physics — final design must be verified by a structural engineer</span>`;
}

// ---------- inspector ----------
function select(sel) {
  app.sel = sel;
  viewer.highlight = sel;
  attachGizmo(sel?.kind === 'node' && app.tool === 'select' ? sel.id : null);
  render();
}

function bar(u) {
  const c = stressColor(u ?? 0);
  return `<div class="bar"><i style="width:${Math.min(100, (u || 0) * 100)}%;background:#${c.getHexString()}"></i></div>`;
}

function renderInspector() {
  const el = $('#inspector');
  const s = app.sel;
  if (!s) { el.innerHTML = ''; return; }
  const L = lib();
  if (s.kind === 'member') {
    const m = app.model.members.find(x => x.id === s.id);
    if (!m) { el.innerHTML = ''; return; }
    const f = app.result?.res?.forces?.get(m.id);
    const u = app.result?.chk?.memberU?.get(m.id);
    const sp = L[m.species];
    const len = f?.L ?? 0;
    el.innerHTML = `<h3>Selected pole</h3>
      <div class="title">Pole #${m.id} · ${m.role || 'frame'}${m.gen ? ' <small style="color:var(--ink-3)">(generated)</small>' : ''}</div>
      ${bar(u)}<div class="note">${u !== undefined ? (u * 100).toFixed(0) + '% of capacity' : ''}${f ? ` · ${f.N < 0 ? 'compression' : 'tension'} ${(Math.abs(f.N) / 1000).toFixed(2)} kN · bending ${(f.M / 1000).toFixed(2)} kN·m · length ${len.toFixed(2)} m` : ''}</div>
      <div class="field"><label>Species</label><select id="iSpecies">${Object.entries(L).map(([k, v]) => `<option value="${k}" ${k === m.species ? 'selected' : ''}>${v.name} — ${v.latin}</option>`).join('')}</select></div>
      <div class="row"><div class="field" style="flex:1"><label>Ø mm</label><input type="number" id="iD" value="${m.D ?? sp.D}"></div>
      <div class="field" style="flex:1"><label>Wall mm</label><input type="number" id="iT" value="${m.t ?? sp.t}"></div>
      <div class="field" style="flex:1"><label>Culms</label><input type="number" id="iB" min="1" max="9" value="${m.bundle || 1}"></div></div>
      <label class="check"><input type="checkbox" id="iBent" ${m.bent ? 'checked' : ''}> Heat-bent culm</label>
      <p class="hint">To move an end, click its joint: coloured arrows appear. Drag one to move along that axis.</p>
      ${m.gen ? '<p class="hint">Edits to generated poles are replaced when its generator changes. Bake the generator to keep them.</p>' : ''}
      <button class="btn" id="iDel">Delete pole</button>`;
    const upd = fn => { snapshot(); fn(); commit(); };
    $('#iSpecies').onchange = e => upd(() => { m.species = e.target.value; delete m.D; delete m.t; });
    $('#iD').onchange = e => upd(() => { m.D = +e.target.value; });
    $('#iT').onchange = e => upd(() => { m.t = +e.target.value; });
    $('#iB').onchange = e => upd(() => { m.bundle = Math.max(1, Math.min(9, +e.target.value)); });
    $('#iBent').onchange = e => upd(() => { m.bent = e.target.checked; });
    $('#iDel').onclick = () => { snapshot(); removeMember(app.model, m.id); app.sel = null; viewer.highlight = null; commit(); };
  } else {
    const n = app.model.nodes.find(x => x.id === s.id);
    if (!n) { el.innerHTML = ''; return; }
    const ju = app.result?.chk?.jointU?.get(n.id), su = app.result?.chk?.supportU?.get(n.id);
    const jt = effectiveJoint(n.joint, app.model.noMetal);
    const st = n.support ? effectiveSupport(n.support, app.model.noMetal) : null;
    const pl = app.model.pointLoads.find(p => p.node === n.id);
    const rx = app.result?.res?.reactions?.get(n.id);
    el.innerHTML = `<h3>Selected joint</h3>
      <div class="title">Node @${n.id}</div>
      <div class="note">x ${n.x.toFixed(2)} · y ${n.y.toFixed(2)} · z ${n.z.toFixed(2)} m</div>
      ${ju !== undefined ? `${bar(ju)}<div class="note">Joint at ${(ju * 100).toFixed(0)}% of capacity</div>` : ''}
      ${su !== undefined ? `${bar(su)}<div class="note">Plinth at ${(su * 100).toFixed(0)}% · reaction ${rx ? (Math.hypot(...rx) / 1000).toFixed(1) : '–'} kN</div>` : ''}
      <div class="field"><label>Joint type</label><select id="iJoint">${Object.entries(JOINTS).map(([k, v]) => `<option value="${k}" ${k === n.joint ? 'selected' : ''} ${app.model.noMetal && v.metal ? 'disabled' : ''}>${v.name} (${v.cap} kN)</option>`).join('')}</select></div>
      <div class="note">${JOINTS[jt].build}</div>
      <div class="field"><label>Foundation</label><select id="iSup"><option value="">None — free joint</option>${Object.entries(SUPPORTS).map(([k, v]) => `<option value="${k}" ${k === n.support ? 'selected' : ''}>${v.name}</option>`).join('')}</select></div>
      ${st ? `<div class="note">${SUPPORTS[st].build}</div>` : ''}
      <div class="field"><label>Hung load (kN) — e.g. a water tank ≈ 10, 20 people ≈ 15</label><input type="number" id="iLoad" step="0.5" value="${pl?.kN ?? 0}"></div>
      <div class="row"><button class="btn" id="iGround">Drop to ground</button><button class="btn" id="iDelN">Delete joint</button></div>`;
    const upd = fn => { snapshot(); fn(); commit(); };
    $('#iJoint').onchange = e => upd(() => { n.joint = e.target.value; });
    $('#iSup').onchange = e => upd(() => { n.support = e.target.value || null; });
    $('#iLoad').onchange = e => upd(() => {
      const v = +e.target.value;
      app.model.pointLoads = app.model.pointLoads.filter(p => p.node !== n.id);
      if (v) app.model.pointLoads.push({ node: n.id, kN: v });
    });
    $('#iGround').onclick = () => upd(() => { n.y = terrainHeight(app.model.terrain, n.x, n.z) + 0.45; n.support ||= 'plinth'; });
    $('#iDelN').onclick = () => { snapshot(); removeNode(app.model, n.id); app.sel = null; viewer.highlight = null; commit(); };
  }
}

// ---------- generators panel ----------
function renderGenerators() {
  const list = $('#genList');
  list.innerHTML = '';
  const L = lib();
  for (const g of app.model.generators) {
    const def = GENERATORS[g.type];
    const card = document.createElement('div');
    card.className = 'gen' + (g.collapsed ? ' collapsed' : '');
    const optKeys = Object.keys(def.options);
    card.innerHTML = `<header><b>${def.name}</b>
      <button data-a="toggle" title="Collapse">${g.collapsed ? '▸' : '▾'}</button>
      <button data-a="bake" title="Bake into editable poles">Bake</button>
      <button data-a="del" title="Remove">✕</button></header>
      <div class="body"><div class="blurb">${def.blurb}</div>
      ${def.params.map(p => `<div class="field"><label>${p.label} <output>${fmt(g.params[p.key], p)}</output></label><input type="range" data-p="${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" value="${g.params[p.key]}"></div>`).join('')}
      <div class="field"><label>Position x / z <output>${(g.at?.x || 0).toFixed(1)}, ${(g.at?.z || 0).toFixed(1)} m</output></label>
        <div class="row"><input type="range" data-at="x" min="-25" max="25" step="0.5" value="${g.at?.x || 0}"><input type="range" data-at="z" min="-25" max="25" step="0.5" value="${g.at?.z || 0}"></div></div>
      <div class="opts">${optKeys.map(k => `<div><label>${k}</label><select data-o="${k}">${k === 'skin'
        ? Object.entries(SKINS).map(([sk, sv]) => `<option value="${sk}" ${sk === g.options[k] ? 'selected' : ''}>${sv.name}</option>`).join('')
        : Object.entries(L).map(([sk, sv]) => `<option value="${sk}" ${sk === g.options[k] ? 'selected' : ''}>${sv.name}</option>`).join('')}</select></div>`).join('')}</div></div>`;
    card.querySelector('[data-a=toggle]').onclick = () => { g.collapsed = !g.collapsed; renderGenerators(); save(); };
    card.querySelector('[data-a=del]').onclick = () => { snapshot(); app.model.generators = app.model.generators.filter(x => x !== g); runGenerators(app.model); renderGenerators(); commit(); };
    card.querySelector('[data-a=bake]').onclick = () => {
      snapshot();
      for (const arr of [app.model.nodes, app.model.members, app.model.panels]) for (const it of arr) if (it.gen === g.id) delete it.gen;
      app.model.generators = app.model.generators.filter(x => x !== g);
      renderGenerators(); commit(); toast(`${def.name} baked — every pole is now yours to edit`);
    };
    let dragging = false;
    for (const inp of card.querySelectorAll('input[type=range]')) {
      inp.addEventListener('pointerdown', () => { if (!dragging) { snapshot(); dragging = true; } });
      inp.addEventListener('change', () => { dragging = false; save(); });
      inp.addEventListener('input', () => {
        if (inp.dataset.p) {
          const p = def.params.find(x => x.key === inp.dataset.p);
          g.params[p.key] = +inp.value;
          inp.parentElement.querySelector('output').textContent = fmt(+inp.value, p);
        } else {
          g.at = { ...(g.at || {}), [inp.dataset.at]: +inp.value };
          inp.closest('.field').querySelector('output').textContent = `${(g.at.x || 0).toFixed(1)}, ${(g.at.z || 0).toFixed(1)} m`;
        }
        runGenerators(app.model);
        clearBreak();
        analyseSoon();
      });
    }
    for (const sel of card.querySelectorAll('select[data-o]')) sel.onchange = () => { snapshot(); g.options[sel.dataset.o] = sel.value; commit({ regen: true }); };
    list.appendChild(card);
  }
  if (!app.model.generators.length) list.innerHTML = '<p class="hint">No generators yet. Add one above, or draw poles by hand with the Pole tool.</p>';
}
const fmt = (v, p) => `${(+v).toFixed(p.step < 1 ? (p.step < 0.1 ? 2 : 1) : 0)}${p.unit ? ' ' + p.unit : ''}`;

// ---------- site & library panels ----------
function renderSite() {
  const t = app.model.terrain;
  $('#tSlope').value = t.slope; $('#slopeOut').textContent = t.slope + '°';
  $('#tJhiri').checked = !!t.jhiri;
  $('#tJw').value = t.jhiriWidth; $('#jwOut').textContent = t.jhiriWidth + ' m';
  $('#tJd').value = t.jhiriDepth; $('#jdOut').textContent = t.jhiriDepth + ' m';
  $('#siteName').value = app.model.site?.name || '';
}
function bindSite() {
  const live = (id, key, out, unit) => {
    $(id).addEventListener('pointerdown', snapshot);
    $(id).addEventListener('input', e => { app.model.terrain[key] = +e.target.value; $(out).textContent = e.target.value + unit; runGenerators(app.model); clearBreak(); analyseSoon(); });
    $(id).addEventListener('change', save);
  };
  live('#tSlope', 'slope', '#slopeOut', '°');
  live('#tJw', 'jhiriWidth', '#jwOut', ' m');
  live('#tJd', 'jhiriDepth', '#jdOut', ' m');
  $('#tJhiri').onchange = e => { snapshot(); app.model.terrain.jhiri = e.target.checked; commit({ regen: true }); };
  $('#siteName').onchange = e => { app.model.site.name = e.target.value; save(); };
}

function renderLibrary() {
  const L = lib();
  const cols = [['D', 'Ø mm'], ['t', 'wall'], ['E', 'E GPa'], ['fc', 'fc'], ['fm', 'fm'], ['rho', 'ρ'], ['stock', 'stock m']];
  $('#libTable').innerHTML = `<table class="lib"><tr><th>Species</th>${cols.map(c => `<th>${c[1]}</th>`).join('')}</tr>
  ${Object.entries(L).map(([k, s]) => `<tr><td class="sp" title="${s.note}"><b>${s.name}</b><i>${s.latin}</i></td>${cols.map(([ck]) => `<td><input type="number" step="any" data-sp="${k}" data-k="${ck}" value="${s[ck]}"></td>`).join('')}</tr>`).join('')}</table>
  <p class="hint">fc = crushing strength, fm = bending strength (MPa), ρ = density (kg/m³), stock = typical culm length sold.</p>`;
  for (const inp of $$('#libTable input')) inp.onchange = () => {
    snapshot();
    app.model.library ??= {};
    app.model.library[inp.dataset.sp] = { ...lib()[inp.dataset.sp], [inp.dataset.k]: +inp.value };
    commit();
  };
}

// ---------- scenario panel ----------
function bindScenario() {
  const sc = app.scenario;
  const chk = (id, get, set) => { $(id).checked = get(); $(id).onchange = e => { set(e.target.checked); afterScenario(); }; };
  const rng = (id, out, get, set, f) => { $(id).value = get(); $(out).textContent = f(get()); $(id).oninput = e => { set(+e.target.value); $(out).textContent = f(+e.target.value); afterScenario(); }; };
  chk('#lPeople', () => sc.people, v => sc.people = v);
  chk('#lMonsoon', () => sc.monsoon, v => sc.monsoon = v);
  chk('#lWind', () => sc.wind.on, v => sc.wind.on = v);
  chk('#lCrest', () => sc.wind.crest, v => sc.wind.crest = v);
  chk('#lQuake', () => sc.seismic.on, v => sc.seismic.on = v);
  chk('#lFlood', () => sc.flood.on, v => sc.flood.on = v);
  chk('#lDebris', () => sc.flood.debris, v => sc.flood.debris = v);
  chk('#lSettle', () => sc.settle.on, v => { sc.settle.on = v; if (v && sc.settle.node == null) { setTool('settle'); } });
  chk('#lNoMetal', () => !!app.model.noMetal, v => { app.model.noMetal = v; save(); });
  rng('#lWs', '#wsOut', () => sc.wind.speed, v => sc.wind.speed = v, v => `${v} m/s · ${Math.round(v * 3.6)} km/h`);
  rng('#lEq', '#eqOut', () => sc.seismic.coef, v => sc.seismic.coef = v, v => `${v.toFixed(2)} g`);
  rng('#lFr', '#frOut', () => sc.flood.rise, v => sc.flood.rise = v, v => `${v.toFixed(1)} m`);
  rng('#lFv', '#fvOut', () => sc.flood.velocity, v => sc.flood.velocity = v, v => `${v.toFixed(1)} m/s`);
  rng('#lSd', '#sdOut', () => sc.settle.drop, v => sc.settle.drop = v, v => `${(v * 100).toFixed(1)} cm`);
  $('#lSm').value = sc.settle.mode || 'washout';
  $('#lSm').onchange = e => { sc.settle.mode = e.target.value; afterScenario(); };
  rng('#lGamma', '#gOut', () => sc.gamma, v => sc.gamma = v, v => `${v.toFixed(1)}×`);
  // compass
  const comp = $('#compass');
  const setNeedle = () => { $('#needle').style.transform = `rotate(${sc.wind.dir + 180}deg)`; };
  setNeedle();
  let drag = false;
  const fromEv = e => { const r = comp.getBoundingClientRect(); const a = Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))); sc.wind.dir = Math.round(((a * 180 / Math.PI) + 360) % 360 / 5) * 5; setNeedle(); afterScenario(); };
  comp.onpointerdown = e => { drag = true; comp.setPointerCapture(e.pointerId); fromEv(e); };
  comp.onpointermove = e => { if (drag) fromEv(e); };
  comp.onpointerup = () => { drag = false; };
  syncGroups();
}
function syncGroups() {
  const sc = app.scenario;
  $('#lWind').closest('.lgroup').classList.toggle('open', sc.wind.on);
  $('#lQuake').closest('.lgroup').classList.toggle('open', sc.seismic.on);
  $('#lFlood').closest('.lgroup').classList.toggle('open', sc.flood.on);
  $('#lSettle').closest('.lgroup').classList.toggle('open', sc.settle.on);
  $('#sinkField').style.display = sc.settle.on && sc.settle.mode === 'sink' ? '' : 'none';
  $('#settleHint').textContent = sc.settle.node != null ? `Landslide under plinth @${sc.settle.node}. Pick another with the Landslide tool.` : 'Pick the plinth with the Landslide tool.';
}
function afterScenario() {
  syncGroups();
  viewer.setRain(app.scenario.monsoon && viewer.mode === 'presence');
  viewer.waterRise = app.scenario.flood.on ? app.scenario.flood.rise : 0;
  clearBreak();
  save();
  analyseSoon();
}

// ---------- break it ----------
function clearBreak() {
  if (app.replayTimer) { clearInterval(app.replayTimer); app.replayTimer = null; }
  if (app.breakRun) {
    app.breakRun = null;
    viewer.hidden = new Set(); viewer.failedNodes = new Set(); viewer.onFrame = null;
    viewer.deformScale = $('#tDeform').classList.contains('on') && app.result?.res?.maxDisp ? autoDeform(app.result.res.maxDisp) : 0;
    $('#breakOut').innerHTML = '';
    $('#hud').textContent = '';
  }
}
function runBreak() {
  clearBreak();
  const t0 = performance.now();
  const run = breakIt(app.model, app.scenario, lib());
  run.ms = performance.now() - t0;
  app.breakRun = run;
  const first = run.events.find(e => e.kind !== 'survives' && e.kind !== 'collapse');
  const end = run.events[run.events.length - 1];
  const lam = first?.lambda;
  let headline;
  if (!first && end?.kind === 'survives') headline = `Unbreakable at ${end.lambda}× these forces. Make it bolder.`;
  else if (!first && end?.kind === 'collapse') headline = 'It collapses straight away — it is a mechanism.';
  else headline = lam < 1 ? `Fails at ${(lam * 100).toFixed(0)}% of today's forces.` : `First thing gives at ${lam.toFixed(2)}× today's forces.`;
  $('#breakOut').innerHTML = `<div class="breakline">${headline}</div>
    <ol class="events">${run.events.map((e, i) => `<li data-i="${i}"><span>${e.label}</span><b>${e.lambda.toFixed(2)}×</b></li>`).join('')}</ol>
    <div class="row" style="margin-top:8px"><button class="btn" id="bReplay">Replay failure</button><button class="btn" id="bClearBreak">Restore</button></div>`;
  $('#bReplay').onclick = replayBreak;
  $('#bClearBreak').onclick = () => { clearBreak(); render(); };
  for (const li of $$('#breakOut li')) li.onclick = () => showBreakStep(+li.dataset.i);
  replayBreak();
}
function showBreakStep(i) {
  const run = app.breakRun; if (!run) return;
  const hidden = new Set(), fn = new Set();
  for (let k = 0; k <= i; k++) {
    const e = run.events[k];
    if (e.kind === 'member') hidden.add(e.id);
    if (e.kind === 'joint') { hidden.add(e.member); fn.add(e.id); }
    if (e.kind === 'support') fn.add(e.id);
  }
  const e = run.events[i];
  viewer.hidden = hidden; viewer.failedNodes = fn;
  $$('#breakOut li').forEach(li => li.classList.toggle('now', +li.dataset.i === i));
  $('#hud').textContent = `${e.lambda.toFixed(2)}× · ${e.label}`;
  if (e.kind === 'collapse') { startCollapse(); return; }
  viewer.onFrame = null;
  let mx = 0;
  for (const d of e.disp.values()) mx = Math.max(mx, Math.hypot(d[0], d[1], d[2]));
  viewer.deformScale = mx ? Math.min(autoDeform(mx), 60) : 0;
  viewer.update(app.model, { lib: lib(), util: app.result?.chk, disp: e.disp, settleNode: null });
}
function startCollapse() {
  let t = 0;
  const nodes = app.model.nodes;
  const drift = new Map(nodes.map(n => [n.id, [(Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6]]));
  viewer.deformScale = 1;
  viewer.onFrame = dt => {
    t += dt * (app.film ? 0.5 : 1);
    if (t > 2.2) { viewer.onFrame = null; return; }
    const disp = new Map();
    for (const n of nodes) {
      if (n.support && !viewer.failedNodes.has(n.id) && n.id !== app.scenario.settle.node) { disp.set(n.id, [0, 0, 0]); continue; }
      const g = terrainHeight(app.model.terrain, n.x, n.z);
      const fall = Math.min(n.y - g, 4.9 * t * t * (0.6 + 0.4 * Math.sin(n.id)));
      const d = drift.get(n.id);
      disp.set(n.id, [d[0] * t, -fall, d[2] * t]);
    }
    viewer.update(app.model, { lib: lib(), disp });
  };
}
function replayBreak() {
  if (!app.breakRun) return;
  if (app.replayTimer) clearInterval(app.replayTimer);
  let i = 0;
  const n = app.breakRun.events.length;
  showBreakStep(0);
  app.replayTimer = setInterval(() => {
    i++;
    if (i >= n || i > 14) { clearInterval(app.replayTimer); app.replayTimer = null; return; }
    showBreakStep(i);
  }, app.film ? 1700 : 900);
}

// ---------- tools ----------
function setTool(t) {
  app.tool = t;
  drawer.reset();
  $$('.tools button').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  $('#polebar').hidden = t !== 'pole';
  if (t !== 'select') attachGizmo(null);
  else if (app.sel?.kind === 'node') attachGizmo(app.sel.id);
  const hints = {
    select: '', pole: 'Click the ground or a joint to start. Follow the coloured guides · type a length + Enter · arrows lock a direction · Esc to finish.',
    support: 'Click a joint to add or remove a stone plinth.', load: 'Click a joint to hang 5 kN on it (edit in the inspector).',
    settle: 'Click the plinth the hillside slips away from.', delete: 'Click a pole or joint to delete it.'
  };
  $('#hud').textContent = hints[t];
}

// ---------- pole drawing ----------
const poleOpts = { species: 'borak', bundle: 1, joint: 'fishmouth' };
function splitMemberAt(memberId, p) {
  const m = app.model.members.find(x => x.id === memberId);
  if (!m) return null;
  const n = addNode(app.model, round(p.x), round(p.y), round(p.z), { joint: poleOpts.joint });
  const { a, b, id, ...props } = m;
  app.model.members = app.model.members.filter(x => x.id !== memberId);
  addMember(app.model, a, n, props); addMember(app.model, n, b, props);
  return n;
}
function poleCommit(start, c) {
  snapshot();
  const make = (spec, ground) => addNode(app.model, round(spec.x), round(spec.y), round(spec.z), { joint: poleOpts.joint, support: ground ? 'plinth' : null });
  const a = start.node ?? make(start.p, start.ground);
  let b;
  if (c.kind === 'joint') b = c.node;
  else if (c.kind === 'mid') b = splitMemberAt(c.member, c.p);
  else b = make(c.p, c.kind === 'ground');
  const id = addMember(app.model, a, b, { species: poleOpts.species, bundle: poleOpts.bundle });
  commit();
  if (id) { app.sel = { kind: 'member', id }; viewer.highlight = app.sel; }
  return b;
}

// ---------- move arrows for a selected joint ----------
let gizmo, gizmoProxy, gizmoNode = null, gizmoDragging = false;
function setupGizmo() {
  gizmo = new TransformControls(viewer.camera, viewer.renderer.domElement);
  gizmo.setTranslationSnap(0.05);
  gizmo.setSize(0.85);
  gizmoProxy = new THREE_Object();
  viewer.scene.add(gizmoProxy);
  const helper = gizmo.getHelper();
  viewer.scene.add(helper);
  // match Bamboofy's convention: blue = up, green = across (three's Y is up)
  const seen = new Set();
  helper.traverse(o => {
    const m = o.material; if (!m || seen.has(m) || !m.color) return; seen.add(m);
    const hex = m.color.getHex();
    if (hex === 0x00ff00) m.color.setHex(0x2f6fd8); else if (hex === 0x0000ff) m.color.setHex(0x3f9b46); else if (hex === 0xff0000) m.color.setHex(0xd2412f);
  });
  gizmo.addEventListener('dragging-changed', e => {
    viewer.controls.enabled = !e.value;
    gizmoDragging = e.value;
    if (e.value) snapshot();
    else { save(); clearBreak(); analyseSoon(); }
  });
  gizmo.addEventListener('objectChange', () => {
    const n = app.model.nodes.find(x => x.id === gizmoNode);
    if (!n) return;
    n.x = round(gizmoProxy.position.x); n.y = round(gizmoProxy.position.y); n.z = round(gizmoProxy.position.z);
    analyseSoon();
  });
}
function attachGizmo(nodeId) {
  if (!gizmo) return;
  const n = nodeId != null && app.model.nodes.find(x => x.id === nodeId);
  gizmoNode = n ? nodeId : null;
  if (n) { gizmoProxy.position.set(n.x, n.y, n.z); gizmo.attach(gizmoProxy); }
  else gizmo.detach();
}

function pointFromPick(hit) {
  if (!hit) return null;
  if (hit.kind === 'node') return { node: hit.id, p: hit.point };
  return { p: hit.point };
}

function bindViewport() {
  const el = viewer.renderer.domElement;
  let down = null;
  el.addEventListener('pointerdown', e => { down = gizmo?.axis ? null : { x: e.clientX, y: e.clientY }; });
  el.addEventListener('pointermove', e => {
    if (viewer.walk) return;
    if (app.tool === 'pole' && !(e.buttons & 1)) drawer.move(e);
  });
  el.addEventListener('pointerleave', () => { if (app.tool === 'pole') { drawer.clear(); drawer.label.hidden = true; } });
  el.addEventListener('dblclick', e => {
    if (viewer.walk) return;
    if (app.tool === 'pole') { drawer.key({ key: 'Escape', type: 'keydown' }); return; }
    const hit = viewer.pick(e, ['node', 'member', 'ground']);
    if (hit?.point) viewcube.centerOn(hit.point.clone ? hit.point.clone() : hit.point);
  });
  el.addEventListener('pointerup', e => {
    if (!down || viewer.walk) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5;
    down = null;
    if (moved) return;
    const t = app.tool;
    if (t === 'select') {
      const hit = viewer.pick(e, ['node', 'member']);
      select(hit ? { kind: hit.kind, id: hit.id } : null);
    } else if (t === 'pole') {
      drawer.click(e);
    } else if (t === 'support' || t === 'load' || t === 'settle') {
      const hit = viewer.pick(e, ['node']);
      if (!hit) return;
      const n = app.model.nodes.find(x => x.id === hit.id);
      if (t === 'support') { snapshot(); n.support = n.support ? null : 'plinth'; commit(); }
      if (t === 'load') {
        snapshot();
        const pl = app.model.pointLoads.find(p => p.node === n.id);
        if (pl) pl.kN += 5; else app.model.pointLoads.push({ node: n.id, kN: 5 });
        select({ kind: 'node', id: n.id }); commit();
      }
      if (t === 'settle') {
        if (!n.support) return toast('Pick a joint that sits on a plinth');
        app.scenario.settle.node = n.id; app.scenario.settle.on = true; $('#lSettle').checked = true;
        afterScenario(); setTool('select');
      }
    } else if (t === 'delete') {
      const hit = viewer.pick(e, ['node', 'member']);
      if (!hit) return;
      snapshot();
      if (hit.kind === 'member') removeMember(app.model, hit.id); else removeNode(app.model, hit.id);
      app.sel = null; viewer.highlight = null;
      commit();
    }
  });
}
const round = v => Math.round(v * 100) / 100;

// ---------- walk ----------
function toggleWalk(on = !viewer.walk) {
  if (on) {
    viewer.startWalk();
    $('#walkpad').hidden = false;
    $('#hud').textContent = 'W A S D or arrows to walk · drag to look · Esc to exit';
    $('#bWalk').classList.add('primary');
  } else {
    viewer.stopWalk();
    $('#walkpad').hidden = true;
    $('#hud').textContent = '';
    $('#bWalk').classList.remove('primary');
  }
}

// ---------- presets gallery ----------
function presetIcon(key) {
  const icons = {
    jhiriPavilion: '<path d="M10 95 Q 60 10 110 95 M30 95 Q 75 20 130 95 M50 95 Q 95 30 150 95" stroke="#2b2520" fill="none" stroke-width="2.4"/><path d="M0 100 Q 80 80 200 108" stroke="#5f8a8f" stroke-width="5" fill="none"/>',
    calibration: '<path d="M50 100 Q 100 25 150 100 M60 100 Q 110 30 160 100 M40 100 Q 90 20 140 100" stroke="#2b2520" fill="none" stroke-width="2.4"/><path d="M10 102 H190" stroke="#8a7d6a"/>',
    tower: '<path d="M70 105 L130 20 M90 105 L150 20 M110 105 L170 20 M130 105 L70 20 M150 105 L90 20 M110 105 L50 20" stroke="#2b2520" stroke-width="1.6"/><path d="M60 20 H160" stroke="#2b2520" stroke-width="2.4"/>',
    hypar: '<path d="M30 90 L100 20 L170 90 L100 60 Z" stroke="#2b2520" fill="#c8a25a55" stroke-width="2"/><path d="M50 82 L100 30 M70 74 L100 40 M100 50 L150 82" stroke="#2b2520" stroke-width="1"/>',
    dome: '<path d="M30 100 Q 100 0 170 100" stroke="#2b2520" fill="none" stroke-width="2.4"/><path d="M55 100 Q 80 40 115 25 M145 100 Q 120 40 85 25 M100 100 V 23" stroke="#2b2520" fill="none" stroke-width="1.2"/>',
    blank: '<path d="M60 100 L140 30" stroke="#2b2520" stroke-width="3" stroke-linecap="round"/><circle cx="60" cy="100" r="4"/><circle cx="140" cy="30" r="4"/>'
  };
  return `<svg viewBox="0 0 200 120">${icons[key] || ''}</svg>`;
}
function openGallery() {
  $('#presetCards').innerHTML = Object.entries(PRESETS).map(([k, p]) => `<button class="card" data-p="${k}">${presetIcon(k)}<div><b>${p.name}</b><small>${p.sub}</small></div></button>`).join('');
  for (const b of $$('#presetCards .card')) b.onclick = () => { loadPreset(b.dataset.p); $('#gallery').hidden = true; maybeTour(); };
  $('#gallery').hidden = false;
}
function loadPreset(key) {
  if (app.model) snapshot();
  const m = emptyModel();
  PRESETS[key].build(m);
  runGenerators(m);
  app.model = m;
  app.sel = null;
  afterLoad(true);
}
function afterLoad(frame = false) {
  viewer.highlight = null;
  const st = app.scenario.settle;
  if (st.node != null && !app.model.nodes.some(n => n.id === st.node && n.support)) { st.node = null; st.on = false; $('#lSettle').checked = false; syncGroups(); }
  $('#designName').value = app.model.name;
  $('#lNoMetal').checked = !!app.model.noMetal;
  renderGenerators(); renderSite(); renderLibrary();
  clearBreak();
  save();
  analyseSoon();
  if (frame) setTimeout(() => viewer.frame(), 30);
}

// ---------- io ----------
function exportAction(x) {
  const m = app.model, L = lib();
  const base = (m.name || 'bamboofy').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'bamboofy';
  if (x === 'json') download(`${base}.bamboo.json`, JSON.stringify(m, null, 1), 'application/json');
  if (x === 'cut') download(`${base}-cut-list.csv`, toCSV(cutList(m, L)), 'text/csv');
  if (x === 'bom') download(`${base}-materials.csv`, toCSV(bomCSV(billOfMaterials(m, L))), 'text/csv');
  if (x === 'png') { const a = viewer.screenshot(); fetch(a).then(r => r.blob()).then(b => download(`${base}.png`, b)); }
  if (x === 'kit') $('#kitModal').hidden = false;
}
function openKit() {
  const scale = +$('#kitScale').value;
  const html = kitHTML(app.model, lib(), scale);
  const w = window.open('', '_blank');
  if (w) { w.document.open(); w.document.write(html); w.document.close(); }
  else download(`${(app.model.name || 'bamboofy').replace(/\s+/g, '-')}-kit-1-${scale}.html`, html, 'text/html');
  $('#kitModal').hidden = true;
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------- collapsible panels ----------
function setPanel(side, collapsed) {
  document.body.classList.toggle('collapse-' + side, collapsed);
  try { localStorage.setItem('bamboofy.panels', JSON.stringify({ left: document.body.classList.contains('collapse-left'), right: document.body.classList.contains('collapse-right') })); } catch {}
}
function togglePanel(side) {
  if (innerWidth <= 900) { document.body.classList.toggle('show-' + side); document.body.classList.remove('show-' + (side === 'left' ? 'right' : 'left')); return; }
  setPanel(side, !document.body.classList.contains('collapse-' + side));
}
function updateEdgeVerdict(u, color) {
  $('#eDot').style.background = color;
  $('#eVerdict').textContent = u ? `Test · ${u > 9.99 ? '>999' : Math.round(u * 100)}%` : 'Test';
}

// ---------- film mode ----------
function setFilm(on = !app.film) {
  if (on && viewer.walk) toggleWalk(false);
  app.film = on;
  document.body.classList.toggle('film', on);
  document.body.classList.remove('show-left', 'show-right');
  viewer.controls.autoRotate = on && $('#fOrbit').classList.contains('on');
  viewer.controls.autoRotateSpeed = 0.45;
  $('#filmName').textContent = app.model.name;
  if (on) { app.sel = null; viewer.highlight = null; setTool('select'); render(); toast('Film mode: H or Esc to exit · B to break it · O to orbit'); }
  setTimeout(() => viewer.resize(), 30);
}

// ---------- guided tour ----------
const TOUR = [
  { sel: '#viewport', title: 'Welcome to Bamboofy', text: 'This is the Jhiri Pavilion: bundled bamboo arches leaping a hill stream. Drag to orbit, scroll to zoom. Every pole is a real culm, with its nodes.' },
  { sel: '#genList', side: 'left', title: 'Shape it', text: 'Generators are parametric forms. Drag any slider (span, twist, culms per bundle) and the physics re-solves instantly.' },
  { sel: '#verdict', side: 'right', title: 'Read it', text: 'How hard is it working? Green is calm, amber is working hard, red is failing. Click the weakest link to find it in 3D.' },
  { sel: '#lMonsoon', up: '.panel section', side: 'right', title: 'Throw the hills at it', text: 'Turn on a waterlogged monsoon roof, wind, an earthquake, a flash flood, or a landslide under one plinth.' },
  { sel: '#bBreak', side: 'right', title: 'Break it', text: 'Ramp every force until something gives, then watch the failure unfold, step by step, until collapse.' },
  { sel: '#bExport', title: 'Make it', text: 'Print a bamboo-stick scale-model kit with drawings, a site cut list and a bill of materials. Then build it for real.' },
  { sel: '.seg', title: 'See it', text: 'Switch to Presence for light, mist and real bamboo. Walk in at eye height, or press Film to record a clean fly-around.' }
];
let tourI = -1;
function tourTarget(st) { let el = $(st.sel); if (el && st.up) el = el.closest(st.up) || el; return el; }
function showTour(i) {
  $$('.tour-target').forEach(e => e.classList.remove('tour-target'));
  tourI = i;
  if (i < 0 || i >= TOUR.length) {
    $('#tour').hidden = true; document.body.classList.remove('show-left', 'show-right');
    try { localStorage.setItem('bamboofy.toured', '1'); } catch {}
    return;
  }
  const st = TOUR[i];
  const small = innerWidth <= 900;
  if (!small && st.side) setPanel(st.side, false);
  document.body.classList.toggle('show-left', small && st.side === 'left');
  document.body.classList.toggle('show-right', small && st.side === 'right');
  const el = tourTarget(st);
  el?.scrollIntoView?.({ block: 'nearest' });
  el?.classList.add('tour-target');
  $('#tourStep').textContent = `${i + 1} of ${TOUR.length}`;
  $('#tourTitle').textContent = st.title;
  $('#tourText').textContent = st.text;
  $('#tourBack').disabled = i === 0;
  $('#tourNext').textContent = i === TOUR.length - 1 ? 'Start designing' : 'Next';
  const box = $('#tour'); box.hidden = false;
  requestAnimationFrame(() => {
    const r = el ? el.getBoundingClientRect() : { left: innerWidth / 2, right: innerWidth / 2, top: innerHeight / 2, bottom: innerHeight / 2, width: 0, height: 0 };
    const w = box.offsetWidth, h = box.offsetHeight, pad = 12;
    let x, y;
    if (el?.id === 'viewport') { x = r.left + r.width / 2 - w / 2; y = r.top + r.height * 0.62; }
    else if (r.left > innerWidth / 2) { x = r.left - w - pad; y = r.top; }
    else if (r.right < innerWidth / 2) { x = r.right + pad; y = r.top; }
    else { x = r.left + r.width / 2 - w / 2; y = r.bottom + pad; }
    if (small) { x = (innerWidth - w) / 2; y = innerHeight - h - 70; }
    box.style.left = Math.max(8, Math.min(innerWidth - w - 8, x)) + 'px';
    box.style.top = Math.max(60, Math.min(innerHeight - h - 8, y)) + 'px';
  });
}
function startTour() { if (app.film) setFilm(false); $('#gallery').hidden = true; showTour(0); }
function maybeTour() { let seen = false; try { seen = !!localStorage.getItem('bamboofy.toured'); } catch {} if (!seen) setTimeout(startTour, 500); }

// ---------- boot ----------
const viewer = new Viewer($('#viewport'));
const drawer = new PoleDrawer(viewer, {
  commit: poleCommit,
  stockLength: () => lib()[poleOpts.species]?.stock,
  onLength: len => { const el = $('#pbLen'); if (document.activeElement !== el) el.placeholder = len ? len.toFixed(2) : '—'; },
  onLock: ax => $$('#pbAxis button').forEach(b => b.classList.toggle('on', (b.dataset.ax || null) === ax))
});
const viewcube = new ViewCube(viewer, $('#stage'));
viewer.tickers = [() => viewcube.sync(), () => { if (gizmoNode != null && !gizmoDragging) { const n = app.model?.nodes.find(x => x.id === gizmoNode); if (n) gizmoProxy.position.set(n.x, n.y, n.z); else attachGizmo(null); } }];
window.bamboofy = { app, viewer };

function boot() {
  // selects
  $('#genType').innerHTML = Object.entries(GENERATORS).map(([k, g]) => `<option value="${k}">${g.name}</option>`).join('');
  const fillSpecies = () => { $('#pbSpecies').innerHTML = Object.entries(lib()).map(([k, s]) => `<option value="${k}">${s.name}</option>`).join(''); };
  $('#pbJoint').innerHTML = Object.entries(JOINTS).map(([k, j]) => `<option value="${k}">${j.name}</option>`).join('');
  $('#pbJoint').value = 'fishmouth';
  $('#pbSpecies').onchange = e => { poleOpts.species = e.target.value; };
  $('#pbJoint').onchange = e => { poleOpts.joint = e.target.value; };
  for (const b of $$('#pbCulms button')) b.onclick = () => { poleOpts.bundle = +b.dataset.c; $$('#pbCulms button').forEach(x => x.classList.toggle('on', x === b)); };
  for (const b of $$('#pbAxis button')) b.onclick = () => drawer.setLock(b.dataset.ax || null);
  $('#pbSnap').onclick = () => { drawer.snap = !drawer.snap; $('#pbSnap').classList.toggle('on', drawer.snap); };
  $('#pbLen').addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { if (!drawer.commitLength(e.target.value)) toast('Click a start point first'); e.target.value = ''; e.target.blur(); }
    if (e.key === 'Escape') { e.target.value = ''; e.target.blur(); }
  });
  setupGizmo();

  try {
    const s = localStorage.getItem(STORE);
    if (s) app.model = validate(JSON.parse(s));
    const sc = localStorage.getItem(STORE_SC);
    if (sc) app.scenario = { ...defaultScenario(), ...JSON.parse(sc) };
  } catch { app.model = null; }
  const first = !app.model;
  if (first) { app.model = emptyModel(); PRESETS.jhiriPavilion.build(app.model); runGenerators(app.model); }
  fillSpecies();
  $('#pbSpecies').value = 'borak';
  bindScenario(); bindSite(); bindViewport();
  afterLoad(true);
  viewer.waterRise = app.scenario.flood.on ? app.scenario.flood.rise : 0;
  if (first) setTimeout(openGallery, 400);

  // header
  $$('.seg button').forEach(b => b.onclick = () => {
    $$('.seg button').forEach(x => x.classList.toggle('on', x === b));
    viewer.setMode(b.dataset.mode);
    viewer.setRain(app.scenario.monsoon && b.dataset.mode === 'presence');
    render();
  });
  const chip = (id, fn) => $(id).onclick = () => { $(id).classList.toggle('on'); fn($(id).classList.contains('on')); render(); };
  chip('#tStress', on => { viewer.overlay = on; viewer.applyMode(); $('#legend').hidden = !on; });
  chip('#tDeform', on => { viewer.deformScale = on && app.result?.res?.maxDisp ? autoDeform(app.result.res.maxDisp) : 0; toast(on ? `Movement exaggerated ×${viewer.deformScale.toFixed(0)}` : 'True shape'); });
  chip('#tSkins', on => { viewer.hideSkins = !on; });
  $('#bWalk').onclick = () => toggleWalk();
  $('#bWalkExit').onclick = () => toggleWalk(false);
  for (const b of $$('#walkpad [data-w]')) {
    const v = { f: [1, 0], b: [-1, 0], l: [0, -1], r: [0, 1] }[b.dataset.w];
    b.onpointerdown = () => viewer.walkMove(...v);
    b.onpointerup = b.onpointerleave = () => viewer.walkMove(0, 0);
  }
  $('#bUndo').onclick = undo; $('#bRedo').onclick = redo;
  $('#bNew').onclick = openGallery;
  $('#bOpen').onclick = () => $('#fileIn').click();
  $('#fileIn').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { snapshot(); app.model = validate(JSON.parse(await f.text())); afterLoad(true); toast(`Opened ${app.model.name}`); }
    catch (err) { toast('Could not open: ' + err.message); }
    e.target.value = '';
  };
  $('#bSave').onclick = () => exportAction('json');
  $('#bExport').onclick = e => { e.stopPropagation(); $('#exportMenu').hidden = !$('#exportMenu').hidden; };
  document.addEventListener('click', () => { $('#exportMenu').hidden = true; });
  for (const b of $$('#exportMenu button')) b.onclick = () => exportAction(b.dataset.x);
  $('#bKitGo').onclick = openKit;
  for (const b of $$('[data-close]')) b.onclick = () => { const m = b.closest('.modal'); m.hidden = true; if (m.id === 'gallery') maybeTour(); };
  try { const ps = JSON.parse(localStorage.getItem('bamboofy.panels') || '{}'); if (ps.left) setPanel('left', true); if (ps.right) setPanel('right', true); } catch {}
  $('#cLeft').onclick = () => setPanel('left', true);
  $('#cRight').onclick = () => setPanel('right', true);
  $('#eLeft').onclick = () => setPanel('left', false);
  $('#eRight').onclick = () => setPanel('right', false);
  $('#bLeft').onclick = () => togglePanel('left');
  $('#bRight').onclick = () => togglePanel('right');
  $('#bFilm').onclick = () => setFilm(true);
  $('#fExit').onclick = () => setFilm(false);
  $('#fOrbit').onclick = () => { $('#fOrbit').classList.toggle('on'); viewer.controls.autoRotate = $('#fOrbit').classList.contains('on'); };
  $('#fBreak').onclick = runBreak;
  $('#bTour').onclick = startTour;
  $('#tourNext').onclick = () => showTour(tourI + 1);
  $('#tourBack').onclick = () => showTour(tourI - 1);
  $('#tourSkip').onclick = () => showTour(-1);
  window.addEventListener('resize', () => { if (tourI >= 0 && !$('#tour').hidden) showTour(tourI); });
  $('#designName').onchange = e => { app.model.name = e.target.value; save(); };
  $('#bAddGen').onclick = () => {
    snapshot();
    const type = $('#genType').value;
    const g = { id: app.model.nextId++, type, at: { x: 0, z: 0 }, ...defaultsFor(type) };
    // drop new generators beside existing work
    if (app.model.nodes.length) { const b = viewer.bounds(); g.at = { x: Math.round(b.max.x + 8), z: 0 }; }
    for (const x of app.model.generators) x.collapsed = true;
    app.model.generators.push(g);
    renderGenerators(); commit({ regen: true, frame: true });
  };
  $('#bResetLib').onclick = () => { snapshot(); delete app.model.library; renderLibrary(); commit(); };
  $$('.tabs button[data-tab]').forEach(b => b.onclick = () => {
    $$('.tabs button[data-tab]').forEach(x => x.classList.toggle('on', x === b));
    $$('#left [data-pane]').forEach(p => { p.hidden = p.dataset.pane !== b.dataset.tab; });
  });
  $$('.tools button').forEach(b => b.onclick = () => setTool(b.dataset.tool));
  $('#bBreak').onclick = runBreak;

  window.addEventListener('keyup', e => { if (app.tool === 'pole') drawer.key(e); });
  window.addEventListener('keydown', e => {
    if (e.target.matches('input, select, textarea')) return;
    if (app.tool === 'pole' && $('#tour').hidden && !app.film && drawer.key(e)) { e.preventDefault(); return; }
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); exportAction('json'); return; }
    if (!$('#tour').hidden) { if (k === 'escape') showTour(-1); if (k === 'arrowright' || k === 'enter') showTour(tourI + 1); if (k === 'arrowleft') showTour(tourI - 1); return; }
    if (app.film) { if (k === 'escape' || k === 'h') setFilm(false); if (k === 'b') runBreak(); if (k === 'o') $('#fOrbit').click(); if (k === 'r') { clearBreak(); render(); } return; }
    if (k === 'h') { setFilm(true); return; }
    if (e.key === '[') { togglePanel('left'); return; }
    if (e.key === ']') { togglePanel('right'); return; }
    if (viewer.walk) { if (k === 'escape') toggleWalk(false); return; }
    if (k === 'escape') setTool('select');
    const toolKeys = { v: 'select', p: 'pole', f: 'support', l: 'load', g: 'settle', x: 'delete' };
    if (toolKeys[k]) setTool(toolKeys[k]);
    if (k === '1') $('.seg [data-mode=drafting]').click();
    if (k === '2') $('.seg [data-mode=presence]').click();
    if (k === 's') $('#tStress').click();
    if (k === 'd') $('#tDeform').click();
    if (k === 'k') $('#tSkins').click();
    if (k === 'w') toggleWalk(true);
    if (k === 'b') runBreak();
    if ((k === 'delete' || k === 'backspace') && app.sel) {
      snapshot();
      if (app.sel.kind === 'member') removeMember(app.model, app.sel.id); else removeNode(app.model, app.sel.id);
      app.sel = null; viewer.highlight = null; commit();
    }
  });

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
