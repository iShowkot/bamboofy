// Bamboofy 3D frame solver.
// Linear-elastic space frame (6 DOF per node, Euler–Bernoulli members), banded Cholesky
// with reverse Cuthill–McKee ordering so a few thousand poles solve in milliseconds.
// Intuition-grade by design: joints are stiff, member loads are lumped to nodes.

import { section } from './materials.js';

function rcm(count, adj) {
  const order = [];
  const seen = new Uint8Array(count);
  const deg = adj.map(a => a.length);
  const byDeg = [...Array(count).keys()].sort((a, b) => deg[a] - deg[b]);
  for (const start of byDeg) {
    if (seen[start]) continue;
    const queue = [start]; seen[start] = 1;
    while (queue.length) {
      const v = queue.shift();
      order.push(v);
      const nb = adj[v].filter(w => !seen[w]).sort((a, b) => deg[a] - deg[b]);
      for (const w of nb) { seen[w] = 1; queue.push(w); }
    }
  }
  order.reverse();
  const perm = new Int32Array(count);
  order.forEach((v, i) => { perm[v] = i; });
  return perm;
}

function frameLocalK(E, G, A, Iy, Iz, J, L) {
  const k = Array.from({ length: 12 }, () => new Float64Array(12));
  const ea = E * A / L, gj = G * J / L;
  const z12 = 12 * E * Iz / L ** 3, z6 = 6 * E * Iz / L ** 2, z4 = 4 * E * Iz / L, z2 = 2 * E * Iz / L;
  const y12 = 12 * E * Iy / L ** 3, y6 = 6 * E * Iy / L ** 2, y4 = 4 * E * Iy / L, y2 = 2 * E * Iy / L;
  const s = (i, j, v) => { k[i][j] = v; k[j][i] = v; };
  s(0, 0, ea); s(6, 6, ea); s(0, 6, -ea);
  s(3, 3, gj); s(9, 9, gj); s(3, 9, -gj);
  s(1, 1, z12); s(7, 7, z12); s(1, 7, -z12);
  s(1, 5, z6); s(1, 11, z6); s(5, 7, -z6); s(7, 11, -z6);
  s(5, 5, z4); s(11, 11, z4); s(5, 11, z2);
  s(2, 2, y12); s(8, 8, y12); s(2, 8, -y12);
  s(2, 4, -y6); s(2, 10, -y6); s(4, 8, y6); s(8, 10, y6);
  s(4, 4, y4); s(10, 10, y4); s(4, 10, y2);
  return k;
}

export function rotation(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const L = Math.hypot(dx, dy, dz);
  const ex = [dx / L, dy / L, dz / L];
  const ref = Math.abs(ex[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  let ez = [ex[1] * ref[2] - ex[2] * ref[1], ex[2] * ref[0] - ex[0] * ref[2], ex[0] * ref[1] - ex[1] * ref[0]];
  const nz = Math.hypot(...ez); ez = ez.map(v => v / nz);
  const ey = [ez[1] * ex[2] - ez[2] * ex[1], ez[2] * ex[0] - ez[0] * ex[2], ez[0] * ex[1] - ez[1] * ex[0]];
  return { R: [ex, ey, ez], L };
}

/**
 * solve(model, opts)
 * opts.forces: Map nodeId -> [fx,fy,fz,mx,my,mz] (N, N·m)
 * opts.removed: Set of member ids treated as failed
 * opts.settle: Map nodeId -> [dx,dy,dz] prescribed support movement (m)
 * opts.species: material library
 */
export function solve(model, opts = {}) {
  const removed = opts.removed || new Set();
  const members = model.members.filter(m => !removed.has(m.id));
  const nodeById = new Map(model.nodes.map(n => [n.id, n]));
  const active = new Map();
  const touch = id => { if (!active.has(id) && nodeById.has(id)) active.set(id, active.size); };
  for (const m of members) { touch(m.a); touch(m.b); }
  for (const n of model.nodes) if (n.support && active.has(n.id)) touch(n.id);
  const N = active.size;
  if (N === 0 || members.length === 0) return { ok: true, empty: true, disp: new Map(), forces: new Map(), reactions: new Map() };

  const adj = Array.from({ length: N }, () => []);
  for (const m of members) {
    const i = active.get(m.a), j = active.get(m.b);
    if (i === undefined || j === undefined) continue;
    adj[i].push(j); adj[j].push(i);
  }
  const perm = rcm(N, adj);
  // skyline (envelope) storage: row r keeps columns fc[r]..r of the lower triangle
  const minNb = new Int32Array(N);
  for (let i = 0; i < N; i++) minNb[perm[i]] = perm[i];
  for (const m of members) {
    const pa = perm[active.get(m.a)], pb = perm[active.get(m.b)];
    if (pb < minNb[pa]) minNb[pa] = pb;
    if (pa < minNb[pb]) minNb[pb] = pa;
  }
  const n = 6 * N;
  const fc = new Int32Array(n), rs = new Int32Array(n + 1);
  for (let r = 0; r < n; r++) { fc[r] = 6 * minNb[(r / 6) | 0]; rs[r + 1] = rs[r] + (r - fc[r] + 1); }
  const at = (i, j) => rs[i] + (j - fc[i]); // requires j <= i
  const diag = i => rs[i] + (i - fc[i]);
  let b = 0;
  for (let r = 0; r < n; r++) b = Math.max(b, r - fc[r]);
  const K = new Float64Array(rs[n]);
  const elems = [];
  const kg = new Float64Array(144), tmp = new Float64Array(144), Tm = new Float64Array(144);
  const dofs = new Int32Array(12);
  for (const m of members) {
    const a = nodeById.get(m.a), bb = nodeById.get(m.b);
    const { R, L } = rotation(a, bb);
    if (L < 1e-6) continue;
    const s = section(m, opts.species);
    const kl = frameLocalK(s.E, s.G, s.A, s.I, s.I, s.J, L);
    // T (12x12 block-diagonal of R), kg = T^T kl T
    Tm.fill(0);
    for (let blk = 0; blk < 4; blk++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) Tm[(blk * 3 + r) * 12 + blk * 3 + c] = R[r][c];
    // tmp = kl * T  (exploit block sparsity of T)
    for (let i = 0; i < 12; i++) {
      const ki = kl[i];
      for (let j = 0; j < 12; j++) {
        const b0 = j - (j % 3);
        let sum = 0;
        for (let p = b0; p < b0 + 3; p++) sum += ki[p] * Tm[p * 12 + j];
        tmp[i * 12 + j] = sum;
      }
    }
    for (let i = 0; i < 12; i++) {
      const b0 = i - (i % 3);
      for (let j = 0; j < 12; j++) {
        let sum = 0;
        for (let p = b0; p < b0 + 3; p++) sum += Tm[p * 12 + i] * tmp[p * 12 + j];
        kg[i * 12 + j] = sum;
      }
    }
    const pa = perm[active.get(m.a)], pb = perm[active.get(m.b)];
    for (let d = 0; d < 6; d++) { dofs[d] = pa * 6 + d; dofs[d + 6] = pb * 6 + d; }
    for (let r = 0; r < 12; r++) for (let c = r; c < 12; c++) {
      let i = dofs[r], j = dofs[c];
      if (j > i) { const t = i; i = j; j = t; }
      K[at(i, j)] += kg[r * 12 + c];
    }
    elems.push({ m, R, L, kl, dofs: Array.from(dofs), s });
  }

  let maxDiag = 0;
  for (let i = 0; i < n; i++) maxDiag = Math.max(maxDiag, K[diag(i)]);
  const kPen = maxDiag * 1e5;
  const F = new Float64Array(n);
  const settle = opts.settle || new Map();
  const supports = [];
  for (const [id, idx] of active) {
    const node = nodeById.get(id);
    const p = perm[idx];
    if (node.support) {
      const fixed = node.support === 'plinth' || node.support === 'ground';
      const dl = settle.get(id) || [0, 0, 0];
      for (let d = 0; d < 3; d++) { K[diag(p * 6 + d)] += kPen; F[p * 6 + d] += kPen * dl[d]; }
      if (fixed) for (let d = 3; d < 6; d++) K[diag(p * 6 + d)] += kPen;
      supports.push({ id, p, fixed, dl });
    }
    const f = opts.forces?.get(id);
    if (f) for (let d = 0; d < 6; d++) F[p * 6 + d] += f[d] || 0;
  }
  // whisper of stiffness so near-mechanisms show as huge sag rather than NaN
  const eps = maxDiag * 1e-10;
  const orig = new Float64Array(n);
  for (let i = 0; i < n; i++) { K[diag(i)] += eps; orig[i] = K[diag(i)]; }

  // skyline Cholesky, A = L L^T, row-oriented
  let mechanism = false;
  for (let i = 0; i < n; i++) {
    const fi = fc[i], ri = rs[i];
    for (let j = fi; j < i; j++) {
      const fj = fc[j], rj = rs[j];
      const k0 = fi > fj ? fi : fj;
      let sum = K[ri + (j - fi)];
      let pi = ri + (k0 - fi), pj = rj + (k0 - fj);
      for (let k = k0; k < j; k++) sum -= K[pi++] * K[pj++];
      K[ri + (j - fi)] = sum / K[rj + (j - fj)];
    }
    let s = K[ri + (i - fi)];
    for (let p = ri; p < ri + (i - fi); p++) s -= K[p] * K[p];
    if (!(s > orig[i] * 1e-11)) { mechanism = true; s = orig[i] * 1e-11; }
    K[ri + (i - fi)] = Math.sqrt(s);
  }
  const x = new Float64Array(F);
  for (let i = 0; i < n; i++) {
    const fi = fc[i], ri = rs[i];
    let s = x[i];
    for (let k = fi; k < i; k++) s -= K[ri + (k - fi)] * x[k];
    x[i] = s / K[ri + (i - fi)];
  }
  for (let i = n - 1; i >= 0; i--) {
    const fi = fc[i], ri = rs[i];
    x[i] /= K[ri + (i - fi)];
    const xi = x[i];
    for (let k = fi; k < i; k++) x[k] -= K[ri + (k - fi)] * xi;
  }

  const disp = new Map();
  let maxDisp = 0;
  for (const [id, idx] of active) {
    const p = perm[idx];
    const u = Array.from(x.subarray(p * 6, p * 6 + 6));
    disp.set(id, u);
    maxDisp = Math.max(maxDisp, Math.hypot(u[0], u[1], u[2]));
  }
  if (!isFinite(maxDisp) || maxDisp > 5) mechanism = true;

  const forces = new Map();
  for (const e of elems) {
    const ug = e.dofs.map(d => x[d]);
    const ul = new Float64Array(12);
    for (let blk = 0; blk < 4; blk++) for (let r = 0; r < 3; r++) {
      let s = 0;
      for (let c = 0; c < 3; c++) s += e.R[r][c] * ug[blk * 3 + c];
      ul[blk * 3 + r] = s;
    }
    const f = new Float64Array(12);
    for (let r = 0; r < 12; r++) { let s = 0; for (let c = 0; c < 12; c++) s += e.kl[r][c] * ul[c]; f[r] = s; }
    const Nax = f[6];
    const M = Math.max(Math.hypot(f[4], f[5]), Math.hypot(f[10], f[11]));
    const V = Math.hypot(f[1], f[2]);
    const endF = Math.hypot(f[0], f[1], f[2]);
    forces.set(e.m.id, { N: Nax, M, V, T: Math.abs(f[3]), endF, L: e.L, s: e.s });
  }
  const reactions = new Map();
  for (const sp of supports) {
    const u = disp.get(sp.id);
    const r = [0, 1, 2].map(d => -kPen * (u[d] - sp.dl[d]));
    reactions.set(sp.id, r);
  }
  return { ok: !mechanism, mechanism, disp, forces, reactions, maxDisp, dof: n, bandwidth: b };
}
