// Bamboofy design model — plain JSON so it can be saved as .bamboo.json and
// opened unchanged by any future version (site mode, sketch mode, etc.).
// Coordinates: metres, y is up.

export const FORMAT = 'bamboofy/1';

export function emptyModel(name = 'Untitled structure') {
  return {
    format: FORMAT,
    name,
    created: new Date().toISOString(),
    // Every structure carries its own placement on a site, so multi-building site mode can come later.
    site: { name: 'Bandarban hill site', x: 0, z: 0, rotation: 0 },
    terrain: { slope: 14, jhiri: true, jhiriZ: 0, jhiriWidth: 3.5, jhiriDepth: 2.2, size: 60 },
    nodes: [],
    members: [],
    panels: [],
    pointLoads: [],
    nextId: 1,
    noMetal: false,
    generators: []
  };
}

export function newId(model) { return model.nextId++; }

export function addNode(model, x, y, z, opts = {}) {
  // merge with an existing node if within tolerance
  const tol = opts.tol ?? 0.05;
  for (const n of model.nodes) {
    if (Math.abs(n.x - x) < tol && Math.abs(n.y - y) < tol && Math.abs(n.z - z) < tol) {
      if (opts.support && !n.support) n.support = opts.support;
      if (opts.joint && n.joint === 'lashing') n.joint = opts.joint;
      return n.id;
    }
  }
  const id = newId(model);
  model.nodes.push({ id, x, y, z, joint: opts.joint || 'lashing', support: opts.support || null });
  return id;
}

export function addMember(model, a, b, opts = {}) {
  if (a === b) return null;
  const dup = model.members.find(m => (m.a === a && m.b === b) || (m.a === b && m.b === a));
  if (dup) return dup.id;
  const id = newId(model);
  model.members.push({
    id, a, b,
    species: opts.species || 'borak',
    bundle: opts.bundle || 1,
    bent: !!opts.bent,
    role: opts.role || 'frame',
    ...(opts.D ? { D: opts.D } : {}),
    ...(opts.t ? { t: opts.t } : {})
  });
  return id;
}

export function addPanel(model, nodeIds, skin = 'thatch') {
  const id = newId(model);
  model.panels.push({ id, nodes: nodeIds, skin });
  return id;
}

export function nodeMap(model) {
  const m = new Map();
  for (const n of model.nodes) m.set(n.id, n);
  return m;
}

export function removeMember(model, id) {
  model.members = model.members.filter(m => m.id !== id);
  pruneOrphans(model);
}

export function removeNode(model, id) {
  model.members = model.members.filter(m => m.a !== id && m.b !== id);
  model.panels = model.panels.filter(p => !p.nodes.includes(id));
  model.pointLoads = model.pointLoads.filter(p => p.node !== id);
  model.nodes = model.nodes.filter(n => n.id !== id);
}

export function pruneOrphans(model) {
  const used = new Set();
  for (const m of model.members) { used.add(m.a); used.add(m.b); }
  model.nodes = model.nodes.filter(n => used.has(n.id) || n.support);
  model.panels = model.panels.filter(p => p.nodes.every(id => used.has(id)));
}

export function memberLength(model, m, nm = nodeMap(model)) {
  const a = nm.get(m.a), b = nm.get(m.b);
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

export function clone(model) { return JSON.parse(JSON.stringify(model)); }

export function validate(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Not a Bamboofy design file');
  if (!Array.isArray(obj.nodes) || !Array.isArray(obj.members)) throw new Error('Design file is missing nodes or members');
  const base = emptyModel();
  return { ...base, ...obj, terrain: { ...base.terrain, ...(obj.terrain || {}) }, site: { ...base.site, ...(obj.site || {}) } };
}
