// Load builder: turns the scenario panel into nodal forces.
import { section, SKINS } from './materials.js';
import { normalWaterLevel } from './terrain.js';

const g = 9.81;

export function defaultScenario() {
  return {
    selfWeight: true,
    people: true,
    monsoon: false,
    wind: { on: false, dir: 90, speed: 38, crest: true },
    seismic: { on: false, coef: 0.12, dir: 0 },
    flood: { on: false, rise: 1.5, velocity: 3, debris: true },
    settle: { on: false, node: null, mode: 'washout', drop: 0.03 },
    gamma: 2.0
  };
}

function polygonArea(pts) {
  // returns {area, normal}
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  const L = Math.hypot(nx, ny, nz) || 1;
  return { area: L / 2, normal: [nx / L, ny / L, nz / L] };
}

export function panelGeometry(panel, nm) {
  const pts = panel.nodes.map(id => nm.get(id)).filter(Boolean);
  return { pts, ...polygonArea(pts) };
}

export function buildLoads(model, sc, lib) {
  const nm = new Map(model.nodes.map(n => [n.id, n]));
  const forces = new Map();
  const totals = { dead: 0, skin: 0, live: 0, wind: 0, seismic: 0, flood: 0, point: 0 };
  const deadAt = new Map();
  const push = (id, f) => {
    let v = forces.get(id);
    if (!v) { v = [0, 0, 0, 0, 0, 0]; forces.set(id, v); }
    for (let i = 0; i < 3; i++) v[i] += f[i];
  };
  const addDead = (id, w) => deadAt.set(id, (deadAt.get(id) || 0) + w);

  const windVec = [Math.sin(sc.wind.dir * Math.PI / 180), 0, Math.cos(sc.wind.dir * Math.PI / 180)];
  const q = 0.5 * 1.25 * sc.wind.speed ** 2 * (sc.wind.crest ? 1.35 : 1);
  const water = normalWaterLevel(model.terrain) + (sc.flood.rise || 0);

  for (const m of model.members) {
    const a = nm.get(m.a), b = nm.get(m.b);
    if (!a || !b) continue;
    const s = section(m, lib);
    const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (sc.selfWeight) {
      const W = s.rho * s.A * L * g * 1.1; // +10% for joints, mortar, lashings
      push(m.a, [0, -W / 2, 0]); push(m.b, [0, -W / 2, 0]);
      addDead(m.a, W / 2); addDead(m.b, W / 2);
      totals.dead += W;
    }
    if (sc.wind.on) {
      const e = [(b.x - a.x) / L, (b.y - a.y) / L, (b.z - a.z) / L];
      const c = e[0] * windVec[0] + e[2] * windVec[2];
      const Lp = L * Math.sqrt(Math.max(0, 1 - c * c));
      const Fw = q * 1.2 * s.bundleRadius * 2 * Lp;
      push(m.a, windVec.map(v => v * Fw / 2)); push(m.b, windVec.map(v => v * Fw / 2));
      totals.wind += Fw;
    }
    if (sc.flood.on) {
      const lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y);
      if (lo < water) {
        const frac = hi - lo < 1e-6 ? 1 : Math.min(1, (water - lo) / (hi - lo));
        const Ff = 0.5 * 1000 * sc.flood.velocity ** 2 * 1.2 * s.bundleRadius * 2 * L * frac * (sc.flood.debris ? 1.6 : 1);
        const low = a.y < b.y ? m.a : m.b, high = low === m.a ? m.b : m.a;
        push(low, [Ff * 0.7, 0, 0]); push(high, [Ff * 0.3, 0, 0]);
        totals.flood += Ff;
      }
    }
  }

  for (const p of model.panels) {
    const sk = SKINS[p.skin] || SKINS.thatch;
    const { area, normal } = panelGeometry(p, nm);
    if (!area || p.nodes.length < 3) continue;
    const k = p.nodes.length;
    let w = sk.w * 1000 * area * (sc.monsoon ? sk.wetFactor : 1);
    totals.skin += w;
    let live = 0;
    if (sc.people && sk.live) { live = sk.live * 1000 * area; totals.live += live; }
    for (const id of p.nodes) { push(id, [0, -(w + live) / k, 0]); addDead(id, w / k); }
    if (sc.wind.on) {
      const lateral = q * 0.8 * area * Math.abs(normal[0] * windVec[0] + normal[2] * windVec[2]);
      const uplift = p.skin === 'deck' ? 0 : q * 0.6 * area * Math.abs(normal[1]);
      for (const id of p.nodes) push(id, [windVec[0] * lateral / k, uplift / k, windVec[2] * lateral / k]);
      totals.wind += lateral + uplift;
    }
  }

  if (sc.seismic.on) {
    const d = [Math.sin(sc.seismic.dir * Math.PI / 180), 0, Math.cos(sc.seismic.dir * Math.PI / 180)];
    for (const [id, W] of deadAt) {
      const F = sc.seismic.coef * W;
      push(id, d.map(v => v * F));
      totals.seismic += F;
    }
  }

  for (const pl of model.pointLoads) {
    if (!nm.has(pl.node)) continue;
    push(pl.node, [0, -pl.kN * 1000, 0]);
    totals.point += pl.kN * 1000;
  }

  const settle = new Map();
  if (sc.settle.on && sc.settle.node != null && sc.settle.mode === 'sink') {
    // the plinth sinks and creeps a little downhill (+z)
    settle.set(sc.settle.node, [0, -sc.settle.drop, sc.settle.drop * 0.3]);
  }
  return { forces, settle, totals, water };
}

export function scaleForces(forces, k) {
  const out = new Map();
  for (const [id, f] of forces) out.set(id, f.map(v => v * k));
  return out;
}
export function scaleSettle(settle, k) {
  const out = new Map();
  for (const [id, f] of settle) out.set(id, f.map(v => v * k));
  return out;
}
