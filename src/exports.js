// Fabrication outputs: site cut list, bill of materials, bamboo-skewer scale-model kit.
import { JOINTS, SUPPORTS, SKINS } from './materials.js';
import { effectiveJoint, effectiveSupport } from './analysis.js';
import { panelGeometry } from './loads.js';

const csvCell = v => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
export const toCSV = rows => rows.map(r => r.map(csvCell).join(',')).join('\n');

export function download(name, content, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function lengths(model) {
  const nm = new Map(model.nodes.map(n => [n.id, n]));
  return model.members.map(m => {
    const a = nm.get(m.a), b = nm.get(m.b);
    return { m, L: Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), a, b };
  });
}

export function cutList(model, lib) {
  const rows = [['Pole', 'Role', 'Species', 'Latin', 'Ø mm', 'Wall mm', 'Culms', 'Length m', 'Total culm m', 'Bent', 'Joint end A', 'Joint end B']];
  for (const { m, L, a, b } of lengths(model)) {
    const s = lib[m.species];
    const jt = n => n.support ? SUPPORTS[effectiveSupport(n.support, model.noMetal)]?.name : JOINTS[effectiveJoint(n.joint, model.noMetal)]?.name;
    rows.push([m.id, m.role || 'frame', s?.name, s?.latin, m.D ?? s?.D, s?.kind === 'timber' ? 'solid' : (m.t ?? s?.t), m.bundle || 1, L.toFixed(3), (L * (m.bundle || 1)).toFixed(2), m.bent ? 'heat-bent' : '', jt(a), jt(b)]);
  }
  return rows;
}

// First-fit-decreasing into stock culm lengths, with splices for pieces longer than stock.
function stockCount(pieces, stock) {
  const bins = [];
  let splices = 0;
  const cut = [];
  for (const p of pieces) {
    if (p > stock) { const k = Math.ceil(p / (stock - 0.3)); splices += k - 1; for (let i = 0; i < k; i++) cut.push(p / k + 0.3); }
    else cut.push(p + 0.05);
  }
  cut.sort((a, b) => b - a);
  for (const c of cut) {
    const bin = bins.find(b => b + c <= stock);
    if (bin !== undefined) bins[bins.indexOf(bin)] += c; else bins.push(c);
  }
  return { culms: bins.length, splices, waste: bins.reduce((a, b) => a + (stock - b), 0) };
}

export function billOfMaterials(model, lib) {
  const bySpecies = {};
  for (const { m, L } of lengths(model)) {
    const k = m.species;
    bySpecies[k] ??= { pieces: [], linear: 0 };
    for (let i = 0; i < (m.bundle || 1); i++) bySpecies[k].pieces.push(L);
    bySpecies[k].linear += L * (m.bundle || 1);
  }
  const bamboo = Object.entries(bySpecies).map(([k, v]) => {
    const s = lib[k];
    const st = stockCount(v.pieces, s.stock || 6);
    return { species: s.name, latin: s.latin, kind: s.kind, pieces: v.pieces.length, linear: v.linear, stock: s.stock || 6, ...st };
  });

  const deg = new Map(), bundleAt = new Map();
  for (const m of model.members) for (const e of [m.a, m.b]) { deg.set(e, (deg.get(e) || 0) + 1); bundleAt.set(e, (bundleAt.get(e) || 0) + (m.bundle || 1)); }
  const joints = {};
  let bolts = 0, mortarL = 0, betM = 0, pegs = 0, rods = 0;
  for (const n of model.nodes) {
    const ends = bundleAt.get(n.id) || 0;
    if (n.support) {
      const st = effectiveSupport(n.support, model.noMetal);
      joints[SUPPORTS[st].name] = (joints[SUPPORTS[st].name] || 0) + 1;
      if (st === 'plinth') { rods += ends; mortarL += ends * 0.9; }
      if (st === 'plinthPeg') pegs += ends;
      continue;
    }
    if ((deg.get(n.id) || 0) < 2) continue;
    const jt = effectiveJoint(n.joint, model.noMetal);
    joints[JOINTS[jt].name] = (joints[JOINTS[jt].name] || 0) + 1;
    if (jt === 'fishmouth') { bolts += ends; mortarL += ends * 0.6; }
    if (jt === 'steel') { bolts += ends * 2; mortarL += ends * 0.8; }
    if (jt === 'peg') pegs += ends;
    if (jt === 'lashing') betM += ends * 4;
    if (jt === 'bundle') { betM += ends * 2; pegs += 1; }
  }
  // bundles are clamped every ~50 cm along their length
  for (const { m, L } of lengths(model)) if ((m.bundle || 1) > 1) { const clamps = Math.ceil(L / 0.5); betM += clamps * (m.bundle || 1) * 0.8; pegs += clamps; }

  const nm = new Map(model.nodes.map(n => [n.id, n]));
  const skins = {};
  for (const p of model.panels) {
    const { area } = panelGeometry(p, nm);
    const name = SKINS[p.skin]?.name || p.skin;
    skins[name] = (skins[name] || 0) + area;
  }
  return { bamboo, joints, hardware: { bolts, rods, mortarL, betM, pegs }, skins, plinths: model.nodes.filter(n => n.support).length };
}

export function bomCSV(b) {
  const rows = [['Section', 'Item', 'Quantity', 'Unit', 'Note']];
  for (const s of b.bamboo) {
    rows.push(['Bamboo & timber', `${s.species} (${s.latin})`, s.culms, `culms of ${s.stock} m`, `${s.pieces} pieces, ${s.linear.toFixed(1)} m total, ${s.splices} splices, ~${s.waste.toFixed(1)} m offcuts`]);
  }
  for (const [k, v] of Object.entries(b.joints)) rows.push(['Joints', k, v, 'nodes', '']);
  rows.push(['Hardware', '12 mm threaded rod (bolts)', b.hardware.bolts, 'pcs', 'fish-mouth / plate joints']);
  rows.push(['Hardware', 'Plinth anchor rods', b.hardware.rods, 'pcs', 'set in stone plinths']);
  rows.push(['Hardware', 'Mortar fill (cement-sand)', Math.ceil(b.hardware.mortarL), 'litres', 'internode fill']);
  rows.push(['Natural fixings', 'Bet / rattan lashing', Math.ceil(b.hardware.betM), 'm', 'soaked before tying']);
  rows.push(['Natural fixings', 'Hardwood pegs', b.hardware.pegs, 'pcs', '20–25 mm']);
  rows.push(['Foundations', 'Stone plinths', b.plinths, 'pcs', '450 mm, bamboo never touches soil']);
  for (const [k, v] of Object.entries(b.skins)) rows.push(['Skin', k, v.toFixed(1), 'm²', '']);
  return rows;
}

const STICKS = [1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
export function skewerKit(model, lib, scale = 20) {
  const items = [];
  for (const { m, L } of lengths(model)) {
    const s = lib[m.species];
    const d = (m.D ?? s.D) / scale;
    const stick = STICKS.reduce((a, b) => Math.abs(b - d) < Math.abs(a - d) ? b : a);
    items.push({ id: m.id, role: m.role || 'frame', species: s.name, mm: L * 1000 / scale, stick, n: m.bundle || 1, bent: m.bent });
  }
  items.sort((a, b) => b.stick - a.stick || b.mm - a.mm);
  const totals = {};
  for (const it of items) { const k = `${it.stick} mm`; totals[k] ??= { pieces: 0, mm: 0 }; totals[k].pieces += it.n; totals[k].mm += it.mm * it.n; }
  return { scale, items, totals };
}

function svgProjection(model, axis, width, height, pad, label) {
  const nm = new Map(model.nodes.map(n => [n.id, n]));
  const proj = n => axis === 'plan' ? [n.x, n.z] : axis === 'front' ? [n.x, -n.y] : [n.z, -n.y];
  const pts = model.nodes.map(proj);
  if (!pts.length) return '';
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  const k = Math.min((width - 2 * pad) / (maxx - minx || 1), (height - 2 * pad) / (maxy - miny || 1));
  const T = p => [pad + (p[0] - minx) * k, pad + (p[1] - miny) * k];
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%"><rect width="100%" height="100%" fill="#fbf8f1"/>`;
  for (const m of model.members) {
    const a = T(proj(nm.get(m.a))), b = T(proj(nm.get(m.b)));
    s += `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="#2b2520" stroke-width="${0.6 + (m.bundle || 1) * 0.35}" stroke-linecap="round"/>`;
  }
  if (model.members.length <= 220) for (const m of model.members) {
    const a = T(proj(nm.get(m.a))), b = T(proj(nm.get(m.b)));
    s += `<text x="${((a[0] + b[0]) / 2).toFixed(1)}" y="${((a[1] + b[1]) / 2 - 2).toFixed(1)}" font-size="7" fill="#b5532f" text-anchor="middle">${m.id}</text>`;
  }
  // 1 m scale bar
  s += `<line x1="${pad}" y1="${height - 10}" x2="${pad + k}" y2="${height - 10}" stroke="#2b2520" stroke-width="2"/><text x="${pad}" y="${height - 14}" font-size="9">1 m</text>`;
  s += `<text x="${width - pad}" y="14" font-size="11" text-anchor="end" font-family="Georgia,serif">${label}</text></svg>`;
  return s;
}

export function kitHTML(model, lib, scale) {
  const kit = skewerKit(model, lib, scale);
  const b = billOfMaterials(model, lib);
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const rows = kit.items.map(it => `<tr><td>${it.id}</td><td>${esc(it.role)}</td><td>${esc(it.species)}</td><td>${it.stick} mm${it.n > 1 ? ` ×${it.n}` : ''}</td><td><b>${it.mm.toFixed(0)}</b></td><td>${it.bent ? 'soak & bend' : ''}</td></tr>`).join('');
  const tot = Object.entries(kit.totals).map(([k, v]) => `<li>${k} sticks: ${v.pieces} pieces, ${(v.mm / 1000).toFixed(2)} m of stick</li>`).join('');
  const jt = Object.entries(b.joints).map(([k, v]) => `<li>${esc(k)}: ${v}</li>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(model.name)} — 1:${scale} model kit</title>
<style>body{font-family:system-ui,sans-serif;color:#2b2520;max-width:960px;margin:24px auto;padding:0 16px}h1,h2{font-family:Georgia,serif;font-weight:500}
table{border-collapse:collapse;width:100%;font-size:12px}td,th{border-bottom:1px solid #ddd3bf;padding:4px 6px;text-align:left}th{background:#efe8da}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.muted{color:#7a6e5d}@media print{.noprint{display:none}}</style></head><body>
<p class="muted">Banshala · বাঁশালা — scale-model kit</p>
<h1>${esc(model.name)} <span class="muted">at 1:${scale}</span></h1>
<button class="noprint" onclick="print()">Print</button>
<h2>Drawings</h2>
<div>${svgProjection(model, 'plan', 900, 520, 30, 'PLAN')}</div>
<div class="grid"><div>${svgProjection(model, 'front', 440, 300, 20, 'ELEVATION A')}</div><div>${svgProjection(model, 'side', 440, 300, 20, 'ELEVATION B')}</div></div>
<h2>Shopping list</h2><ul>${tot}</ul>
<p class="muted">Bamboo skewers or split bamboo sticks. Members marked “soak & bend” are heat-bent in the real build — soak sticks 30 min, bend over a former. Bundles: tie sticks with thread every ${Math.round(500 / scale)} mm.</p>
<h2>Joints to make</h2><ul>${jt}</ul>
<p class="muted">Use hot glue or thread lashing at joints. For printed nodes, use the STL export (coming in v1.5).</p>
<h2>Cut list (lengths in mm at 1:${scale})</h2>
<table><tr><th>Pole</th><th>Role</th><th>Species</th><th>Stick</th><th>Length mm</th><th></th></tr>${rows}</table>
</body></html>`;
}
