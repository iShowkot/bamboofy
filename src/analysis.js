// Checks: members (axial + bending + buckling), joints (end force vs capacity),
// supports (reaction vs capacity), and progressive "break it" collapse.
import { solve } from './solver.js';
import { JOINTS, SUPPORTS } from './materials.js';
import { buildLoads, scaleForces, scaleSettle } from './loads.js';
import { clone } from './model.js';

export function effectiveJoint(type, noMetal) {
  if (noMetal && JOINTS[type]?.metal) return 'peg';
  return JOINTS[type] ? type : 'lashing';
}
export function effectiveSupport(type, noMetal) {
  if (noMetal && SUPPORTS[type]?.metal) return 'plinthPeg';
  return type;
}

export function check(model, res, gamma = 2) {
  const items = [];
  const nm = new Map(model.nodes.map(n => [n.id, n]));
  const memberU = new Map(), jointU = new Map(), supportU = new Map();
  if (!res || res.empty) return { items, memberU, jointU, supportU, maxU: 0, critical: null };

  for (const m of model.members) {
    const f = res.forces.get(m.id);
    if (!f) continue;
    const s = f.s;
    const comp = Math.max(0, -f.N), ten = Math.max(0, f.N);
    const uAx = comp > 0 ? comp / (s.A * s.fc / gamma) : ten / (s.A * s.ft / gamma);
    const uM = f.M / (s.W * s.fm / gamma);
    const Pcr = Math.PI ** 2 * s.E * s.I / (f.L * f.L);
    const uB = comp / (Pcr / gamma);
    const u = Math.max(uAx + uM, uB + uM);
    const mode = uB > uAx && comp > 0 ? 'buckling' : uM > uAx ? 'bending' : comp > 0 ? 'crushing' : 'tension';
    memberU.set(m.id, u);
    items.push({ kind: 'member', id: m.id, u, mode, N: f.N, M: f.M });
  }

  // joints: worst member end force at each node vs joint capacity (per culm in bundle)
  const worst = new Map();
  for (const m of model.members) {
    const f = res.forces.get(m.id);
    if (!f) continue;
    for (const end of [m.a, m.b]) {
      const node = nm.get(end);
      if (!node) continue;
      const deg = (worst.get(end)?.deg || 0) + 1;
      const jt = effectiveJoint(node.joint, model.noMetal);
      const cap = JOINTS[jt].cap * 1000 * (m.bundle || 1);
      const u = f.endF / cap;
      const w = worst.get(end);
      if (!w || u > w.u) worst.set(end, { u, member: m.id, deg, jt });
      else w.deg = deg;
    }
  }
  for (const [nid, w] of worst) {
    if (w.deg < 2 && !nm.get(nid).support) continue; // free end, no joint
    if (nm.get(nid).support && w.deg < 2) continue;
    jointU.set(nid, w.u);
    items.push({ kind: 'joint', id: nid, u: w.u, member: w.member, mode: JOINTS[w.jt].name });
  }

  for (const [nid, r] of res.reactions) {
    const node = nm.get(nid);
    const st = effectiveSupport(node.support, model.noMetal);
    const cap = (SUPPORTS[st]?.cap || 20) * 1000;
    const R = Math.hypot(r[0], r[1], r[2]);
    // uplift on a pegged/unanchored plinth is resisted only by friction & peg
    const uplift = r[1] < 0 && st !== 'plinth' ? Math.abs(r[1]) / (cap * 0.3) : 0;
    const u = Math.max(R / cap, uplift);
    supportU.set(nid, u);
    items.push({ kind: 'support', id: nid, u, mode: uplift > R / cap ? 'uplift' : SUPPORTS[st]?.name });
  }

  let critical = null, maxU = 0;
  for (const it of items) if (it.u > maxU) { maxU = it.u; critical = it; }
  return { items, memberU, jointU, supportU, maxU, critical };
}

// Landslide "washout": the ground under one plinth is gone — the structure must bridge over it.
export function withLandslide(model, sc) {
  if (!sc.settle?.on || sc.settle.node == null || sc.settle.mode !== 'washout') return model;
  return { ...model, nodes: model.nodes.map(n => n.id === sc.settle.node ? { ...n, support: null } : n) };
}

export function analyse(model0, scenario, lib) {
  const model = withLandslide(model0, scenario);
  const loads = buildLoads(model, scenario, lib);
  const t0 = performance.now();
  const res = solve(model, { forces: loads.forces, settle: loads.settle, species: lib });
  const chk = check(model, res, scenario.gamma);
  return { loads, res, chk, ms: performance.now() - t0 };
}

// Progressive failure: ramp the load factor, remove whatever fails first, re-solve.
export function breakIt(model, scenario, lib, { maxSteps = 40, maxLambda = 12 } = {}) {
  const mc = clone(withLandslide(model, scenario));
  const loads = buildLoads(mc, scenario, lib);
  const removed = new Set();
  const events = [];
  let lambda = 0;
  for (let step = 0; step < maxSteps; step++) {
    const res = solve(mc, { forces: loads.forces, settle: loads.settle, species: lib, removed });
    if (res.empty) break;
    if (res.mechanism) {
      events.push({ kind: 'collapse', lambda, label: 'Structure becomes a mechanism — collapse' });
      return { events, lambda, collapsed: true, removed };
    }
    const visible = { ...mc, members: mc.members.filter(m => !removed.has(m.id)) };
    const chk = check(visible, res, scenario.gamma);
    if (!chk.critical || chk.maxU <= 1e-9) break;
    const lc = 1 / chk.maxU;
    if (lc > lambda) lambda = lc;
    if (lambda > maxLambda) {
      events.push({ kind: 'survives', lambda: maxLambda, label: `Survives beyond ${maxLambda}× the loads` });
      return { events, lambda: maxLambda, collapsed: false, removed };
    }
    const c = chk.critical;
    const disp = new Map(res.disp);
    if (c.kind === 'member') {
      removed.add(c.id);
      events.push({ kind: 'member', id: c.id, lambda, mode: c.mode, disp, label: `Pole #${c.id} fails by ${c.mode}` });
    } else if (c.kind === 'joint') {
      removed.add(c.member);
      events.push({ kind: 'joint', id: c.id, member: c.member, lambda, mode: c.mode, disp, label: `Joint @${c.id} (${c.mode}) tears out` });
    } else {
      const node = mc.nodes.find(n => n.id === c.id);
      node.support = null;
      events.push({ kind: 'support', id: c.id, lambda, mode: c.mode, disp, label: `Foundation @${c.id} fails (${c.mode})` });
    }
  }
  return { events, lambda, collapsed: false, removed };
}
