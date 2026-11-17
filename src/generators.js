// Parametric generators. Each writes nodes/members/panels tagged with its generator id,
// so changing a slider regenerates only that part of the design.
import { addNode, addMember, addPanel } from './model.js';
import { terrainHeight } from './terrain.js';

const PLINTH = 0.45;
const P = (key, label, min, max, step, def, unit = '') => ({ key, label, min, max, step, def, unit });
const deg = Math.PI / 180;

function ctxOf(model, gen) {
  const ground = (x, z) => terrainHeight(model.terrain, x, z) + PLINTH;
  const tag = () => {
    const ln = model.nodes.length, lm = model.members.length, lp = model.panels.length;
    return () => {
      for (let i = ln; i < model.nodes.length; i++) model.nodes[i].gen ??= gen.id;
      for (let i = lm; i < model.members.length; i++) model.members[i].gen = gen.id;
      for (let i = lp; i < model.panels.length; i++) model.panels[i].gen = gen.id;
    };
  };
  return { ground, tag, ox: gen.at?.x || 0, oz: gen.at?.z || 0 };
}

export const GENERATORS = {
  archHall: {
    name: 'Bundled arch vault',
    blurb: 'Bent, bundled culms springing from stone plinths — the classic Bali-style vault. Twist it for the impossible.',
    params: [
      P('span', 'Span', 4, 30, 0.5, 14, 'm'),
      P('rise', 'Rise', 2, 14, 0.25, 6.5, 'm'),
      P('length', 'Length', 3, 40, 0.5, 12, 'm'),
      P('arches', 'Arches', 2, 20, 1, 6),
      P('segments', 'Segments / arch', 6, 24, 1, 12),
      P('bundle', 'Culms per bundle', 1, 9, 1, 4),
      P('twist', 'Twist', -60, 60, 1, 0, '°'),
      P('wave', 'Rise wave', -0.6, 0.6, 0.05, 0, '×'),
      P('axis', 'Span direction', 0, 180, 5, 0, '°')
    ],
    options: { species: 'asper', purlin: 'borak', skin: 'thatch' },
    build(model, gen) {
      const p = gen.params, o = gen.options, c = ctxOf(model, gen);
      const done = c.tag();
      const rows = [];
      const n = Math.round(p.arches), segs = Math.round(p.segments);
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0.5 : i / (n - 1);
        const along = (t - 0.5) * p.length;
        const rot = (p.axis + p.twist * (t - 0.5)) * deg;
        const riseHere = p.rise * (1 + p.wave * Math.sin(Math.PI * t * 2 - Math.PI / 2));
        // span axis direction
        const sx = Math.sin(rot), sz = Math.cos(rot);
        // arches are spaced perpendicular to the base span axis
        const bx = Math.cos(p.axis * deg), bz = -Math.sin(p.axis * deg);
        const cx = c.ox + bx * along, cz = c.oz + bz * along;
        const ax = cx - sx * p.span / 2, az = cz - sz * p.span / 2;
        const ex = cx + sx * p.span / 2, ez = cz + sz * p.span / 2;
        const ya = c.ground(ax, az), yb = c.ground(ex, ez);
        const row = [];
        for (let k = 0; k <= segs; k++) {
          const u = k / segs;
          const x = ax + (ex - ax) * u, z = az + (ez - az) * u;
          const y = ya + (yb - ya) * u + 4 * riseHere * u * (1 - u);
          const end = k === 0 || k === segs;
          row.push(addNode(model, x, y, z, { support: end ? 'plinth' : null, joint: end ? 'steel' : 'fishmouth' }));
        }
        for (let k = 0; k < segs; k++) addMember(model, row[k], row[k + 1], { species: o.species, bundle: p.bundle, bent: true, role: 'arch' });
        rows.push(row);
      }
      for (let i = 0; i + 1 < rows.length; i++) {
        const A = rows[i], B = rows[i + 1];
        for (let k = 1; k < segs; k++) addMember(model, A[k], B[k], { species: o.purlin, bundle: 1, role: 'purlin' });
        for (let k = 0; k < segs; k++) addPanel(model, [A[k], A[k + 1], B[k + 1], B[k]], o.skin);
        // diagonal bracing in end bays and every third bay
        if (i === 0 || i === rows.length - 2 || i % 3 === 1) {
          for (let k = 0; k < segs; k += 2) {
            addMember(model, A[k], B[k + 1], { species: o.purlin, role: 'brace' });
            addMember(model, B[k], A[k + 1], { species: o.purlin, role: 'brace' });
          }
        }
      }
      done();
    }
  },

  dome: {
    name: 'Gridshell dome',
    blurb: 'Triangulated bamboo gridshell with an oculus — stiff, light, and very easy to over-imagine.',
    params: [
      P('radius', 'Base radius', 3, 20, 0.5, 8, 'm'),
      P('rise', 'Rise', 2, 16, 0.25, 6, 'm'),
      P('rings', 'Rings', 3, 14, 1, 7),
      P('spokes', 'Ribs', 6, 40, 1, 18),
      P('oculus', 'Oculus', 0, 0.5, 0.02, 0.18, '×'),
      P('bundle', 'Culms per member', 1, 4, 1, 1),
      P('spiral', 'Spiral', -1, 1, 0.05, 0.35, '×')
    ],
    options: { species: 'borak', skin: 'leaves' },
    build(model, gen) {
      const p = gen.params, o = gen.options, c = ctxOf(model, gen);
      const done = c.tag();
      const R = p.radius, H = p.rise;
      const Rs = (R * R + H * H) / (2 * H); // sphere radius
      const nR = Math.round(p.rings), nS = Math.round(p.spokes);
      const baseY = Math.max(...Array.from({ length: nS }, (_, j) => {
        const a = (j / nS) * 2 * Math.PI; return c.ground(c.ox + R * Math.cos(a), c.oz + R * Math.sin(a));
      }));
      const grid = [];
      for (let k = 0; k <= nR; k++) {
        const t = k / nR;
        const r = R * (1 - t * (1 - p.oculus));
        const y = baseY + (Math.sqrt(Rs * Rs - r * r) - (Rs - H));
        const ring = [];
        for (let j = 0; j < nS; j++) {
          const a = ((j + (k % 2) * 0.5) / nS + p.spiral * t * 0.25) * 2 * Math.PI;
          const x = c.ox + r * Math.cos(a), z = c.oz + r * Math.sin(a);
          let yy = y;
          if (k === 0) yy = c.ground(x, z);
          ring.push(addNode(model, x, yy, z, { support: k === 0 ? 'plinth' : null, joint: k === 0 ? 'steel' : 'fishmouth' }));
        }
        grid.push(ring);
      }
      // base: short posts from uneven ground up to the ring level
      for (let k = 0; k <= nR; k++) {
        const ring = grid[k];
        if (k > 0 || true) for (let j = 0; j < nS; j++) if (k > 0) addMember(model, ring[j], ring[(j + 1) % nS], { species: o.species, bundle: p.bundle, bent: true, role: 'ring' });
        if (k < nR) {
          const nx = grid[k + 1];
          for (let j = 0; j < nS; j++) {
            const j2 = k % 2 === 0 ? j : (j + 1) % nS;
            const j1 = k % 2 === 0 ? (j - 1 + nS) % nS : j;
            addMember(model, ring[j], nx[j1], { species: o.species, bundle: p.bundle, bent: true, role: 'rib' });
            addMember(model, ring[j], nx[j2], { species: o.species, bundle: p.bundle, bent: true, role: 'rib' });
            addPanel(model, [ring[j], nx[j2], nx[j1]], o.skin);
          }
        }
      }
      done();
    }
  },

  hypar: {
    name: 'Hypar saddle',
    blurb: 'A doubly-curved roof made only of straight poles. Two corners on the ground, two flying.',
    params: [
      P('size', 'Size', 4, 24, 0.5, 11, 'm'),
      P('low', 'Low corners', 0.5, 6, 0.25, 1.2, 'm'),
      P('high', 'High corners', 2, 16, 0.25, 7.5, 'm'),
      P('grid', 'Rulings', 4, 20, 1, 10),
      P('bundle', 'Edge bundle', 1, 9, 1, 5),
      P('rotate', 'Rotate', 0, 90, 5, 45, '°')
    ],
    options: { species: 'asper', ruling: 'apus', skin: 'thatch' },
    build(model, gen) {
      const p = gen.params, o = gen.options, c = ctxOf(model, gen);
      const done = c.tag();
      const a = p.size / 2, r = p.rotate * deg, n = Math.round(p.grid);
      const loc = (u, v) => [c.ox + (u * Math.cos(r) - v * Math.sin(r)), c.oz + (u * Math.sin(r) + v * Math.cos(r))];
      const g0 = c.ground(c.ox, c.oz);
      const cornerY = [p.low, p.high, p.low, p.high]; // (-a,-a) (a,-a) (a,a) (-a,a)
      const grid = [];
      for (let i = 0; i <= n; i++) {
        const row = [];
        for (let j = 0; j <= n; j++) {
          const s = i / n, t = j / n;
          const [x, z] = loc(-a + 2 * a * s, -a + 2 * a * t);
          const y = g0 + (1 - s) * (1 - t) * cornerY[0] + s * (1 - t) * cornerY[1] + s * t * cornerY[2] + (1 - s) * t * cornerY[3];
          const corner = (i === 0 || i === n) && (j === 0 || j === n);
          const lowCorner = corner && i === j;
          const edge = i === 0 || i === n || j === 0 || j === n;
          row.push(addNode(model, x, lowCorner ? c.ground(x, z) : y, z, { support: lowCorner ? 'plinth' : null, joint: corner ? 'steel' : edge ? 'fishmouth' : 'peg' }));
        }
        grid.push(row);
      }
      for (let i = 0; i <= n; i++) for (let j = 0; j < n; j++) {
        const edge = i === 0 || i === n;
        addMember(model, grid[i][j], grid[i][j + 1], { species: edge ? o.species : o.ruling, bundle: edge ? p.bundle : 1, role: edge ? 'edge' : 'ruling' });
        const edge2 = i === 0 || i === n;
        addMember(model, grid[j][i], grid[j + 1][i], { species: edge2 ? o.species : o.ruling, bundle: edge2 ? p.bundle : 1, role: edge2 ? 'edge' : 'ruling' });
      }
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) addPanel(model, [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]], o.skin);
      // flying corners need a mast each: bundled column to a plinth
      for (const [i, j] of [[n, 0], [0, n]]) {
        const top = model.nodes.find(nn => nn.id === grid[i][j]);
        const [x, z] = [top.x, top.z];
        const base = addNode(model, x, c.ground(x, z), z, { support: 'plinth', joint: 'steel' });
        const mid = addNode(model, x, (top.y + c.ground(x, z)) / 2, z, { joint: 'bundle' });
        addMember(model, base, mid, { species: o.species, bundle: p.bundle, role: 'mast' });
        addMember(model, mid, top.id, { species: o.species, bundle: p.bundle, role: 'mast' });
      }
      done();
    }
  },

  tower: {
    name: 'Hyperboloid tower',
    blurb: 'Straight culms leaning in two directions weave a curved waist — a Shukhov tower in bamboo.',
    params: [
      P('height', 'Height', 4, 40, 0.5, 16, 'm'),
      P('rBase', 'Base radius', 1, 10, 0.25, 4, 'm'),
      P('rTop', 'Top radius', 0.5, 10, 0.25, 2.5, 'm'),
      P('count', 'Culms per family', 6, 40, 1, 16),
      P('twist', 'Twist', 20, 160, 5, 70, '°'),
      P('levels', 'Rings', 2, 20, 1, 8),
      P('bundle', 'Culms per member', 1, 3, 1, 1)
    ],
    options: { species: 'dgiganteus', ring: 'apus', skin: 'mat' },
    build(model, gen) {
      const p = gen.params, o = gen.options, c = ctxOf(model, gen);
      const done = c.tag();
      const nC = Math.round(p.count), nL = Math.round(p.levels);
      const g0 = Math.max(...Array.from({ length: nC }, (_, i) => {
        const a = i / nC * 2 * Math.PI; return c.ground(c.ox + p.rBase * Math.cos(a), c.oz + p.rBase * Math.sin(a));
      }));
      const levels = Array.from({ length: nL + 1 }, () => []);
      for (const fam of [1, -1]) {
        for (let i = 0; i < nC; i++) {
          const a0 = (i / nC) * 2 * Math.PI;
          const a1 = a0 + fam * p.twist * deg;
          const B = [c.ox + p.rBase * Math.cos(a0), g0, c.oz + p.rBase * Math.sin(a0)];
          const T = [c.ox + p.rTop * Math.cos(a1), g0 + p.height, c.oz + p.rTop * Math.sin(a1)];
          let prev = null;
          for (let k = 0; k <= nL; k++) {
            const t = k / nL;
            let x = B[0] + (T[0] - B[0]) * t, y = B[1] + (T[1] - B[1]) * t, z = B[2] + (T[2] - B[2]) * t;
            if (k === 0) y = c.ground(x, z);
            const id = addNode(model, x, y, z, { support: k === 0 ? 'plinth' : null, joint: k === 0 ? 'steel' : 'peg' });
            levels[k].push({ id, ang: Math.atan2(z - c.oz, x - c.ox) });
            if (prev) addMember(model, prev, id, { species: o.species, bundle: p.bundle, role: 'strut' });
            prev = id;
          }
        }
      }
      for (let k = 1; k <= nL; k++) {
        const ring = [...new Map(levels[k].map(e => [e.id, e])).values()].sort((a, b) => a.ang - b.ang);
        for (let i = 0; i < ring.length; i++) addMember(model, ring[i].id, ring[(i + 1) % ring.length].id, { species: o.ring, role: 'ring', bent: true });
        if (k === nL) {
          // top platform: centre node + spokes + deck
          const ny = model.nodes.find(nn => nn.id === ring[0].id).y;
          const cId = addNode(model, c.ox, ny, c.oz, { joint: 'steel' });
          for (let i = 0; i < ring.length; i++) {
            addMember(model, cId, ring[i].id, { species: o.ring, role: 'deck' });
            addPanel(model, [cId, ring[i].id, ring[(i + 1) % ring.length].id], 'deck');
          }
        }
      }
      done();
    }
  },

  cantilever: {
    name: 'Cantilever deck',
    blurb: 'A truss deck anchored into the hillside that reaches out over the jhiri with nothing below.',
    params: [
      P('back', 'Anchored length', 2, 16, 0.5, 6, 'm'),
      P('reach', 'Cantilever reach', 1, 16, 0.5, 6, 'm'),
      P('width', 'Width', 1.5, 8, 0.25, 3, 'm'),
      P('depth', 'Truss depth', 0.6, 4, 0.1, 1.6, 'm'),
      P('bays', 'Bays', 4, 24, 1, 12),
      P('bundle', 'Chord culms', 1, 6, 1, 3)
    ],
    options: { species: 'dgiganteus', web: 'borak', skin: 'deck' },
    build(model, gen) {
      const p = gen.params, o = gen.options, c = ctxOf(model, gen);
      const done = c.tag();
      const nB = Math.round(p.bays), L = p.back + p.reach;
      const z0 = c.oz - p.back; // deck runs toward +z (downhill, toward the stream)
      const yDeck = Math.max(c.ground(c.ox - p.width / 2, z0), c.ground(c.ox + p.width / 2, z0)) + 0.15;
      const sides = [];
      for (const sdx of [-1, 1]) {
        const x = c.ox + sdx * p.width / 2;
        const bot = [], top = [];
        for (let k = 0; k <= nB; k++) {
          const z = z0 + L * k / nB;
          bot.push(addNode(model, x, yDeck, z, { joint: k === 0 ? 'steel' : 'fishmouth', support: k === 0 ? 'plinth' : null }));
          top.push(addNode(model, x, yDeck + p.depth, z, { joint: 'fishmouth' }));
        }
        for (let k = 0; k < nB; k++) {
          addMember(model, bot[k], bot[k + 1], { species: o.species, bundle: p.bundle, role: 'chord' });
          addMember(model, top[k], top[k + 1], { species: o.species, bundle: p.bundle, role: 'chord' });
          addMember(model, k % 2 ? bot[k] : top[k], k % 2 ? top[k + 1] : bot[k + 1], { species: o.web, role: 'web' });
        }
        for (let k = 0; k <= nB; k++) addMember(model, bot[k], top[k], { species: o.web, role: 'post' });
        // posts down into the hillside along the anchored length
        for (let k = 0; k <= nB; k++) {
          const z = z0 + L * k / nB;
          if (z > c.oz + 0.01) break;
          const g = c.ground(x, z);
          if (k === 0 || yDeck - g < 0.3) continue;
          const base = addNode(model, x, g, z, { support: 'plinth', joint: 'steel' });
          addMember(model, base, bot[k], { species: o.species, bundle: 2, role: 'leg' });
          if (k > 0) addMember(model, base, bot[k - 1], { species: o.web, role: 'leg-brace' });
        }
        sides.push({ bot, top });
      }
      const [A, B] = sides;
      for (let k = 0; k <= nB; k++) {
        addMember(model, A.bot[k], B.bot[k], { species: o.web, role: 'joist' });
        addMember(model, A.top[k], B.top[k], { species: o.web, role: 'tie' });
        if (k < nB) {
          addPanel(model, [A.bot[k], A.bot[k + 1], B.bot[k + 1], B.bot[k]], o.skin);
          if (k % 2 === 0) addMember(model, A.bot[k], B.bot[k + 1], { species: o.web, role: 'brace' });
        }
      }
      done();
    }
  }
};

export function defaultsFor(type) {
  const g = GENERATORS[type];
  const params = {};
  for (const p of g.params) params[p.key] = p.def;
  return { params, options: { ...g.options } };
}

export function runGenerators(model) {
  // drop everything generated, keep manual work, then rebuild in order
  const gens = new Set(model.generators.map(g => g.id));
  model.members = model.members.filter(m => !m.gen || !gens.has(m.gen));
  model.panels = model.panels.filter(p => !p.gen || !gens.has(p.gen));
  const used = new Set();
  for (const m of model.members) { used.add(m.a); used.add(m.b); }
  for (const p of model.panels) p.nodes.forEach(id => used.add(id));
  for (const pl of model.pointLoads) used.add(pl.node);
  model.nodes = model.nodes.filter(n => !n.gen || !gens.has(n.gen) || used.has(n.id));
  for (const n of model.nodes) if (n.gen && gens.has(n.gen)) delete n.gen;
  for (const g of model.generators) GENERATORS[g.type].build(model, g);
  // manual members referencing vanished nodes go too
  const ids = new Set(model.nodes.map(n => n.id));
  model.members = model.members.filter(m => ids.has(m.a) && ids.has(m.b));
  model.pointLoads = model.pointLoads.filter(p => ids.has(p.node));
}

export const PRESETS = {
  jhiriPavilion: {
    name: 'Jhiri Pavilion',
    sub: 'The v1 ambition — twisted bundled arches leaping a hill stream',
    build(model) {
      Object.assign(model.terrain, { slope: 16, jhiri: true, jhiriZ: 0, jhiriWidth: 3.5, jhiriDepth: 2.4 });
      model.name = 'Jhiri Pavilion';
      const a = defaultsFor('archHall');
      Object.assign(a.params, { span: 18, rise: 7.5, length: 15, arches: 8, segments: 14, bundle: 5, twist: 34, wave: 0.2, axis: 0 });
      model.generators.push({ id: model.nextId++, type: 'archHall', at: { x: 0, z: 0 }, ...a });
      const d = defaultsFor('cantilever');
      Object.assign(d.params, { back: 7, reach: 4.5, width: 3, depth: 1.5, bays: 10, bundle: 3 });
      model.generators.push({ id: model.nextId++, type: 'cantilever', at: { x: 0, z: -4.5 }, ...d });
    }
  },
  calibration: {
    name: 'Calibration arch',
    sub: 'A modest 9 m bundled-arch shelter of the kind that has stood for years',
    build(model) {
      Object.assign(model.terrain, { slope: 0, jhiri: false });
      model.name = 'Calibration — 9 m bundled arch';
      const a = defaultsFor('archHall');
      Object.assign(a.params, { span: 9, rise: 5, length: 9, arches: 5, segments: 10, bundle: 3, twist: 0, wave: 0 });
      model.generators.push({ id: model.nextId++, type: 'archHall', at: { x: 0, z: 0 }, ...a });
    }
  },
  tower: {
    name: 'Bamboo Shukhov tower',
    sub: 'A woven lookout above the canopy',
    build(model) {
      Object.assign(model.terrain, { slope: 10, jhiri: false });
      model.name = 'Hyperboloid lookout';
      const t = defaultsFor('tower');
      model.generators.push({ id: model.nextId++, type: 'tower', at: { x: 0, z: 0 }, ...t });
    }
  },
  hypar: {
    name: 'Hypar gate',
    sub: 'Straight poles, curved sky',
    build(model) {
      Object.assign(model.terrain, { slope: 6, jhiri: false });
      model.name = 'Hypar gate';
      const h = defaultsFor('hypar');
      model.generators.push({ id: model.nextId++, type: 'hypar', at: { x: 0, z: 0 }, ...h });
    }
  },
  dome: {
    name: 'Spiral gridshell',
    sub: 'A woven dome with an oculus to the clouds',
    build(model) {
      Object.assign(model.terrain, { slope: 4, jhiri: false });
      model.name = 'Spiral gridshell';
      const d = defaultsFor('dome');
      model.generators.push({ id: model.nextId++, type: 'dome', at: { x: 0, z: 0 }, ...d });
    }
  },
  blank: {
    name: 'Blank hillside',
    sub: 'Start from a single pole',
    build(model) { model.name = 'Untitled structure'; }
  }
};
