// Bamboofy material library.
// Values are indicative characteristic properties drawn from published bamboo/timber
// literature ranges. Every value is editable in the app — replace with your own field tests.
// Units: D, t in mm; E in GPa; strengths in MPa; density in kg/m3.

export const SPECIES = {
  borak: {
    name: 'Borak', latin: 'Bambusa balcooa', region: 'Bangladesh', kind: 'bamboo',
    D: 90, t: 12, E: 14, fc: 50, ft: 120, fm: 95, rho: 700, stock: 6,
    note: 'Thick-walled structural workhorse of Bangladesh.'
  },
  muli: {
    name: 'Muli', latin: 'Melocanna baccifera', region: 'Bangladesh (CHT)', kind: 'bamboo',
    D: 50, t: 6, E: 12, fc: 40, ft: 100, fm: 80, rho: 650, stock: 6,
    note: 'Thin, straight, abundant in the hill tracts. Great for weaving, walls, light members.'
  },
  dgiganteus: {
    name: 'Dendrocalamus', latin: 'Dendrocalamus giganteus', region: 'Bangladesh / SE Asia', kind: 'bamboo',
    D: 150, t: 18, E: 14, fc: 45, ft: 110, fm: 90, rho: 700, stock: 8,
    note: 'Giant culm for columns, arches and long spans.'
  },
  asper: {
    name: 'Petung', latin: 'Dendrocalamus asper', region: 'Bali / Indonesia', kind: 'bamboo',
    D: 120, t: 15, E: 15, fc: 50, ft: 130, fm: 100, rho: 700, stock: 8,
    note: 'The giant bamboo behind much of Bali\'s landmark bamboo architecture.'
  },
  apus: {
    name: 'Tali', latin: 'Gigantochloa apus', region: 'Bali / Indonesia', kind: 'bamboo',
    D: 80, t: 10, E: 13, fc: 45, ft: 120, fm: 90, rho: 650, stock: 6,
    note: 'Flexible, good for bending and bundles.'
  },
  sal: {
    name: 'Sal', latin: 'Shorea robusta', region: 'Bangladesh', kind: 'timber',
    D: 150, t: 0, E: 12, fc: 40, ft: 60, fm: 80, rho: 850, stock: 4,
    note: 'Dense hardwood. Posts, sills, ground beams.'
  },
  gamari: {
    name: 'Gamari', latin: 'Gmelina arborea', region: 'Bangladesh', kind: 'timber',
    D: 120, t: 0, E: 8.5, fc: 30, ft: 50, fm: 60, rho: 500, stock: 4,
    note: 'Light, workable timber for frames and decks.'
  }
};

// Joints: capacity is the indicative resultant end force (kN) the connection can transfer.
export const JOINTS = {
  fishmouth: { name: 'Fish-mouth + bolt + mortar', cap: 25, metal: true, fixity: 'rigid',
    build: 'Saddle-cut end to fit the receiving culm. Drill through both, 12 mm threaded rod. Fill the end internode with cement-sand mortar through a 20 mm hole.' },
  peg: { name: 'Dowel / hardwood peg', cap: 6, metal: false, fixity: 'rigid',
    build: 'Drill 20–25 mm through both culms close to a node, drive a hardwood or bamboo peg, wedge both ends.' },
  lashing: { name: 'Lashing (bet / rattan / rope)', cap: 3, metal: false, fixity: 'rigid',
    build: 'Cross-lash 8–12 turns of soaked bet (young bamboo strip) or rattan, frapping turns between members, lock with a clove hitch.' },
  bundle: { name: 'Bundle clamp', cap: 15, metal: false, fixity: 'rigid',
    build: 'Stagger culm ends; tie bundle every 40–60 cm with lashing and a through-peg at each clamp.' },
  steel: { name: 'Steel plate connector', cap: 35, metal: true, fixity: 'rigid',
    build: 'Steel plate or ring with bolted culm ends, mortar-filled. Use only where forces demand it.' }
};

export const SUPPORTS = {
  plinth: { name: 'Stone plinth (anchored)', cap: 40, metal: true, fixed: true,
    build: '450 mm stone/rammed-earth plinth. Steel rod set into plinth, culm sleeved over it, end internode filled with mortar. Bamboo never touches soil.' },
  plinthPeg: { name: 'Stone plinth (pegged)', cap: 15, metal: false, fixed: false,
    build: 'Stone plinth with carved socket; hardwood peg through culm into socket. Bamboo never touches soil.' },
  ground: { name: 'Buried in soil (avoid)', cap: 10, metal: false, fixed: true,
    build: 'Culm buried directly. Rots in 2–3 years in the hills — use only for temporary works.' }
};

export const SKINS = {
  thatch:  { name: 'Thatch (grass / sun-grass)', w: 0.35, wetFactor: 2.5 },
  leaves:  { name: 'Leaf shingles (palm / nipa)', w: 0.20, wetFactor: 2.0 },
  mat:     { name: 'Woven bamboo mat',           w: 0.10, wetFactor: 1.5 },
  clay:    { name: 'Clay / earth plaster',       w: 0.60, wetFactor: 1.3 },
  deck:    { name: 'Bamboo slat deck (+ people)', w: 0.30, wetFactor: 1.0, live: 3.0 }
};

export function memberMaterial(m, lib = SPECIES) {
  const s = lib[m.species] || lib.borak;
  return s;
}

// Section properties in SI (m, m2, m4) for one culm, multiplied by bundle count.
export function section(m, lib = SPECIES) {
  const s = memberMaterial(m, lib);
  const D = (m.D ?? s.D) / 1000;
  const tRaw = (m.t ?? s.t);
  const t = s.kind === 'timber' || !tRaw ? D / 2 : tRaw / 1000;
  const d = Math.max(0, D - 2 * t);
  const n = Math.max(1, m.bundle || 1);
  const A1 = Math.PI / 4 * (D * D - d * d);
  const I1 = Math.PI / 64 * (D ** 4 - d ** 4);
  // Bundles: we conservatively ignore composite action (I = n·I1) except a modest 1.5x gain from clamping.
  const comp = n > 1 ? 1.5 : 1;
  return {
    D, t, n,
    A: A1 * n,
    I: I1 * n * comp,
    J: 2 * I1 * n,
    W: (I1 * n * comp) / (D / 2),
    E: s.E * 1e9,
    G: s.E * 1e9 / 2.6,
    fc: s.fc * 1e6, ft: s.ft * 1e6, fm: s.fm * 1e6,
    rho: s.rho,
    bundleRadius: n > 1 ? D * 0.6 * Math.sqrt(n) : D / 2
  };
}
