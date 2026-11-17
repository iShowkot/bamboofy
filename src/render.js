// Banshala renderer: drafting-table mode, presence mode, stress overlay, walk-inside view.
import * as THREE from '../vendor/three.module.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { terrainHeight, normalWaterLevel } from './terrain.js';
import { section, SPECIES } from './materials.js';

const PAPER = 0xefe8da, INK = 0x2b2520;
const SKIN_COLORS = { thatch: 0xc8a25a, leaves: 0x7b8a3e, mat: 0xd8c08a, clay: 0xb07a4f, deck: 0xa8875a };

export function stressColor(u, out = new THREE.Color()) {
  if (u === undefined || u === null) return out.set(0x999999);
  if (u >= 1) return out.set(0xc0392b);
  const stops = [[0, [0.36, 0.62, 0.36]], [0.5, [0.55, 0.68, 0.3]], [0.75, [0.88, 0.66, 0.18]], [1, [0.8, 0.3, 0.16]]];
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i], [b, cb] = stops[i + 1];
    if (u <= b) { const t = (u - a) / (b - a); return out.setRGB(ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t); }
  }
  return out;
}

function bambooTexture() {
  const c = document.createElement('canvas'); c.width = 16; c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 16, 0);
  grd.addColorStop(0, '#9c7a35'); grd.addColorStop(0.5, '#e2c27a'); grd.addColorStop(1, '#9c7a35');
  g.fillStyle = grd; g.fillRect(0, 0, 16, 256);
  for (let i = 0; i < 4; i++) {
    const y = 20 + i * 64;
    g.fillStyle = 'rgba(70,50,20,0.55)'; g.fillRect(0, y, 16, 3);
    g.fillStyle = 'rgba(255,240,200,0.35)'; g.fillRect(0, y + 3, 16, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function marchingContours(fn, size, res, step) {
  const pts = [];
  const h = size / res;
  const grid = [];
  for (let i = 0; i <= res; i++) { grid.push([]); for (let j = 0; j <= res; j++) grid[i].push(fn(-size / 2 + i * h, -size / 2 + j * h)); }
  let min = Infinity, max = -Infinity;
  for (const r of grid) for (const v of r) { min = Math.min(min, v); max = Math.max(max, v); }
  for (let lv = Math.ceil(min / step) * step; lv <= max; lv += step) {
    for (let i = 0; i < res; i++) for (let j = 0; j < res; j++) {
      const v = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]];
      const p = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      const cross = [];
      for (let e = 0; e < 4; e++) {
        const a = v[e], b = v[(e + 1) % 4];
        if ((a < lv) !== (b < lv)) {
          const t = (lv - a) / (b - a);
          const pa = p[e], pb = p[(e + 1) % 4];
          const x = -size / 2 + (pa[0] + (pb[0] - pa[0]) * t) * h, z = -size / 2 + (pa[1] + (pb[1] - pa[1]) * t) * h;
          cross.push([x, lv + 0.02, z]);
        }
      }
      if (cross.length >= 2) pts.push(...cross[0], ...cross[1]);
      if (cross.length === 4) pts.push(...cross[2], ...cross[3]);
    }
  }
  return new Float32Array(pts);
}

export class Viewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 600);
    this.camera.position.set(26, 18, 30);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 3, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.495;

    this.mode = 'drafting';
    this.overlay = true;
    this.deformScale = 0;
    this.hidden = new Set();
    this.failedNodes = new Set();
    this.highlight = null;
    this.instanceToMember = [];
    this.nodeIds = [];

    this.hemi = new THREE.HemisphereLight(0xfff5e0, 0x6b6a50, 1.6);
    this.sun = new THREE.DirectionalLight(0xffe7c2, 1.4);
    this.sun.position.set(-30, 45, 20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 140 });
    this.scene.add(this.hemi, this.sun);

    this.bambooTex = bambooTexture();
    this.memberMat = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0 });
    this.unitCyl = new THREE.CylinderGeometry(1, 1, 1, 10, 1, false);
    this.unitCyl.translate(0, 0.5, 0);
    this.nodeMat = new THREE.MeshStandardMaterial({ roughness: 0.6 });
    this.unitSphere = new THREE.SphereGeometry(1, 12, 8);
    this.plinthMat = new THREE.MeshStandardMaterial({ color: 0x8d8a80, roughness: 0.95 });
    this.panelMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, vertexColors: true, transparent: true, roughness: 0.95, depthWrite: false });
    this.inkMat = new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.85 });

    this.group = new THREE.Group(); this.scene.add(this.group);
    this.terrainGroup = new THREE.Group(); this.scene.add(this.terrainGroup);
    this.fxGroup = new THREE.Group(); this.scene.add(this.fxGroup);

    this.workPlane = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ color: 0x6b7d3a, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false }));
    this.workPlane.rotation.x = -Math.PI / 2;
    this.workGrid = new THREE.GridHelper(60, 60, 0x6b7d3a, 0x6b7d3a);
    this.workGrid.material.transparent = true; this.workGrid.material.opacity = 0.25;
    this.workPlane.visible = this.workGrid.visible = false;
    this.scene.add(this.workPlane, this.workGrid);

    this.ghost = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: 0xb5532f, dashSize: 0.3, gapSize: 0.15 }));
    this.ghost.visible = false; this.scene.add(this.ghost);
    this.cursor = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshBasicMaterial({ color: 0xb5532f }));
    this.cursor.visible = false; this.scene.add(this.cursor);

    this.raycaster = new THREE.Raycaster();
    this.walk = null;
    this.clock = new THREE.Clock();
    this.rain = null;
    this.onFrame = null;

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.applyMode();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px'; this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  setMode(mode) { this.mode = mode; this.applyMode(); if (this.model) this.update(this.model, this.state); }
  applyMode() {
    const p = this.mode === 'presence';
    this.scene.background = new THREE.Color(p ? 0xcfd8d6 : PAPER);
    this.scene.fog = p ? new THREE.FogExp2(0xcfd8d6, 0.012) : null;
    this.hemi.intensity = p ? 1.1 : 2.2;
    this.sun.intensity = p ? 2.2 : 0.9;
    this.sun.castShadow = p;
    this.renderer.toneMapping = p ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    this.memberMat.map = p && !this.overlay ? this.bambooTex : null;
    this.memberMat.needsUpdate = true;
    if (this.terrainModel) this.buildTerrain(this.terrainModel, true);
  }

  buildTerrain(t, force = false) {
    const key = JSON.stringify(t) + this.mode + (this.waterRise || 0) + !!this.raining;
    if (!force && key === this.terrainKey) return;
    this.terrainKey = key; this.terrainModel = t;
    this.terrainGroup.clear();
    const size = 90, res = 140;
    const geo = new THREE.PlaneGeometry(size, size, res, res);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = terrainHeight(t, x, z);
      pos.setY(i, y);
      if (this.mode === 'presence') {
        const yN = terrainHeight(t, x, z + 0.5), yE = terrainHeight(t, x + 0.5, z);
        const steep = Math.min(1, Math.hypot(yN - y, yE - y) * 2.2);
        const n = 0.5 + 0.5 * Math.sin(x * 1.3 + z * 0.7) * Math.cos(z * 1.1);
        c.setRGB(0.27 + 0.2 * steep + 0.05 * n, 0.36 + 0.06 * n - 0.08 * steep, 0.18 + 0.05 * steep);
      } else {
        c.setHex(0xe7dfcd);
      }
      col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, transparent: this.mode !== 'presence', opacity: this.mode === 'presence' ? 1 : 0.92 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    this.terrainMesh = mesh;
    this.terrainGroup.add(mesh);
    const lines = marchingContours((x, z) => terrainHeight(t, x, z), size, 110, 0.5);
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(lines, 3));
    const contour = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: this.mode === 'presence' ? 0x3d4a25 : 0x8a7d66, transparent: true, opacity: this.mode === 'presence' ? 0.12 : 0.55 }));
    this.terrainGroup.add(contour);
    if (t.jhiri) {
      const wl = normalWaterLevel(t) + (this.waterRise || 0);
      const water = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ color: this.waterRise ? 0x7a6a48 : 0x5f8a8f, transparent: true, opacity: this.mode === 'presence' ? 0.78 : 0.35, roughness: 0.15, metalness: 0.1 }));
      water.rotation.x = -Math.PI / 2; water.position.y = wl;
      // clip water to the channel using a mask: cheap trick, a thin band around the jhiri
      water.geometry = new THREE.PlaneGeometry(size, (t.jhiriWidth || 3) * 1.6 + (this.waterRise || 0) * 6);
      water.position.z = t.jhiriZ || 0;
      this.terrainGroup.add(water);
    }
  }

  setRain(on) {
    if (on && !this.rain) {
      const n = 4000, g = new THREE.BufferGeometry(), p = new Float32Array(n * 6);
      for (let i = 0; i < n; i++) {
        const x = (Math.random() - 0.5) * 70, y = Math.random() * 40, z = (Math.random() - 0.5) * 70;
        p.set([x, y, z, x + 0.05, y + 0.7, z], i * 6);
      }
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x8aa0aa, transparent: true, opacity: 0.45 }));
      this.rain.frustumCulled = false;
      this.scene.add(this.rain);
    } else if (!on && this.rain) { this.scene.remove(this.rain); this.rain = null; }
  }

  // state: { util:{memberU,jointU,supportU}, disp:Map, lib, selection }
  update(model, state = {}) {
    this.model = model; this.state = state;
    const lib = state.lib || SPECIES;
    this.buildTerrain(model.terrain);
    this.group.clear();
    const nm = new Map(model.nodes.map(n => [n.id, n]));
    const disp = state.disp && this.deformScale ? state.disp : null;
    const P = id => {
      const n = nm.get(id);
      const v = new THREE.Vector3(n.x, n.y, n.z);
      if (disp) { const d = disp.get(id); if (d) v.add(new THREE.Vector3(d[0], d[1], d[2]).multiplyScalar(this.deformScale)); }
      return v;
    };
    this.nodePos = P;
    const presence = this.mode === 'presence';
    const memberU = state.util?.memberU;

    // members (bundles drawn as clustered culms)
    const members = model.members.filter(m => !this.hidden.has(m.id));
    let count = 0;
    for (const m of members) count += Math.max(1, m.bundle || 1);
    const inst = new THREE.InstancedMesh(this.unitCyl, this.memberMat, Math.max(1, count));
    inst.castShadow = presence; inst.receiveShadow = presence;
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    this.instanceToMember = [];
    let k = 0;
    const ink = [];
    for (const m of members) {
      const a = P(m.a), b = P(m.b);
      const dir = b.clone().sub(a); const L = dir.length(); if (L < 1e-6) continue;
      dir.normalize(); q.setFromUnitVectors(up, dir);
      const s = section(m, lib);
      const r = s.D / 2;
      const n = Math.max(1, m.bundle || 1);
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(q), side2 = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      const ringR = n === 1 ? 0 : n <= 6 ? r / Math.sin(Math.PI / n) : r / Math.sin(Math.PI / (n - 1));
      const species = lib[m.species] || SPECIES.borak;
      for (let i = 0; i < n; i++) {
        const off = new THREE.Vector3();
        const ringN = n <= 6 ? n : n - 1;
        if (n > 1 && !(n > 6 && i === n - 1)) {
          const ang = (i / ringN) * Math.PI * 2;
          off.addScaledVector(side, Math.cos(ang) * ringR).addScaledVector(side2, Math.sin(ang) * ringR);
        }
        mtx.compose(a.clone().add(off), q, new THREE.Vector3(r, L, r));
        inst.setMatrixAt(k, mtx);
        if (this.overlay && memberU) stressColor(memberU.get(m.id), col);
        else if (presence) col.setHex(species.kind === 'timber' ? 0x7a5230 : 0xffffff).offsetHSL(0, 0, ((m.id * 37) % 10 - 5) / 100);
        else col.setHex(species.kind === 'timber' ? 0x8b6b4a : 0xd9c9a8);
        if (this.highlight?.kind === 'member' && this.highlight.id === m.id) col.setHex(0x1e5bd8);
        if (state.failed?.has(m.id)) col.setHex(0xc0392b);
        inst.setColorAt(k, col);
        this.instanceToMember[k] = m.id;
        k++;
      }
      ink.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    inst.count = k;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.name = 'members';
    this.memberMesh = inst;
    this.group.add(inst);
    if (!presence) {
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(ink, 3));
      this.group.add(new THREE.LineSegments(lg, this.inkMat));
    }

    // joints
    const deg = new Map();
    for (const m of model.members) { deg.set(m.a, (deg.get(m.a) || 0) + 1); deg.set(m.b, (deg.get(m.b) || 0) + 1); }
    const nodes = model.nodes;
    const ninst = new THREE.InstancedMesh(this.unitSphere, this.nodeMat, Math.max(1, nodes.length));
    this.nodeIds = [];
    let j = 0;
    const jointU = state.util?.jointU;
    const supports = [];
    for (const n of nodes) {
      if (n.support) supports.push(n);
      const p = P(n.id);
      const rad = presence ? 0.07 : ((deg.get(n.id) || 0) >= 2 || n.support ? 0.09 : 0.11);
      mtx.compose(p, new THREE.Quaternion(), new THREE.Vector3(rad, rad, rad));
      ninst.setMatrixAt(j, mtx);
      if (this.failedNodes.has(n.id)) col.setHex(0xc0392b);
      else if (this.highlight?.kind === 'node' && this.highlight.id === n.id) col.setHex(0x1e5bd8);
      else if (this.overlay && jointU?.has(n.id)) stressColor(jointU.get(n.id), col);
      else col.setHex(presence ? 0x5b4630 : INK);
      ninst.setColorAt(j, col);
      this.nodeIds[j] = n.id;
      j++;
    }
    ninst.count = j;
    ninst.instanceMatrix.needsUpdate = true;
    if (ninst.instanceColor) ninst.instanceColor.needsUpdate = true;
    ninst.name = 'nodes';
    this.nodeMesh = ninst;
    this.group.add(ninst);

    // stone plinths
    if (supports.length) {
      const box = new THREE.CylinderGeometry(0.32, 0.42, 0.5, 7);
      const pinst = new THREE.InstancedMesh(box, this.plinthMat, supports.length);
      supports.forEach((n, i) => {
        const p = P(n.id);
        const sU = state.util?.supportU?.get(n.id);
        mtx.compose(new THREE.Vector3(p.x, p.y - 0.25, p.z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
        pinst.setMatrixAt(i, mtx);
        if (this.failedNodes.has(n.id)) col.setHex(0xc0392b);
        else if (this.overlay && sU !== undefined) stressColor(sU, col).lerp(new THREE.Color(0x8d8a80), 0.35);
        else col.setHex(n.support === 'ground' ? 0x6b4d2e : 0x9a968b);
        pinst.setColorAt(i, col);
      });
      pinst.castShadow = presence; pinst.receiveShadow = presence;
      this.group.add(pinst);
    }

    // skins
    const pos = [], pcol = [];
    for (const p of model.panels) {
      if (p.nodes.some(id => !nm.has(id))) continue;
      const pts = p.nodes.map(P);
      col.setHex(SKIN_COLORS[p.skin] || SKIN_COLORS.thatch);
      if (!presence) col.lerp(new THREE.Color(PAPER), 0.25);
      for (let i = 1; i + 1 < pts.length; i++) for (const v of [pts[0], pts[i], pts[i + 1]]) { pos.push(v.x, v.y, v.z); pcol.push(col.r, col.g, col.b); }
    }
    if (pos.length && !this.hideSkins) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(pcol, 3));
      g.computeVertexNormals();
      this.panelMat.opacity = presence ? 0.94 : 0.32;
      this.panelMat.depthWrite = presence;
      const mesh = new THREE.Mesh(g, this.panelMat);
      mesh.castShadow = presence; mesh.receiveShadow = presence;
      mesh.renderOrder = 2;
      this.group.add(mesh);
    }

    // point loads as arrows
    for (const pl of model.pointLoads) {
      if (!nm.has(pl.node)) continue;
      const p = P(pl.node);
      const len = Math.min(3, 0.6 + pl.kN * 0.15);
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), p.clone().add(new THREE.Vector3(0, len, 0)), len, 0xb5532f, 0.35, 0.22);
      this.group.add(arrow);
    }
    // landslide marker
    if (state.settleNode && nm.has(state.settleNode)) {
      const p = P(state.settleNode);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.06, 8, 32), new THREE.MeshBasicMaterial({ color: 0xb5532f }));
      ring.rotation.x = Math.PI / 2; ring.position.copy(p).add(new THREE.Vector3(0, -0.4, 0));
      this.group.add(ring);
    }
  }

  bounds() {
    const box = new THREE.Box3();
    if (this.model?.nodes.length) for (const n of this.model.nodes) box.expandByPoint(new THREE.Vector3(n.x, n.y, n.z));
    else box.set(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 5, 5));
    return box;
  }

  frame() {
    const box = this.bounds();
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3()).length();
    this.controls.target.copy(c);
    const dir = new THREE.Vector3(0.75, 0.5, 0.95).normalize();
    this.camera.position.copy(c).addScaledVector(dir, Math.max(14, s * 1.45) / Math.min(1, this.camera.aspect * 1.1));
  }

  setWorkPlane(on, height) {
    this.workPlane.visible = this.workGrid.visible = on;
    this.workPlane.position.y = height; this.workGrid.position.y = height + 0.001;
  }

  // picking
  pick(ev, kinds = ['node', 'member', 'ground']) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    if (kinds.includes('node') && this.nodeIds.length) {
      // screen-space snap: nearest node within 14px
      let best = null, bestD = 14;
      const v = new THREE.Vector3();
      for (const n of this.model.nodes) {
        v.copy(this.nodePos(n.id)).project(this.camera);
        if (v.z > 1) continue;
        const sx = (v.x + 1) / 2 * rect.width, sy = (1 - v.y) / 2 * rect.height;
        const d = Math.hypot(sx - (ev.clientX - rect.left), sy - (ev.clientY - rect.top));
        if (d < bestD) { bestD = d; best = n; }
      }
      if (best) return { kind: 'node', id: best.id, point: this.nodePos(best.id) };
    }
    if (kinds.includes('member') && this.memberMesh) {
      this.raycaster.params.Line.threshold = 0.1;
      const hit = this.raycaster.intersectObject(this.memberMesh)[0];
      if (hit) return { kind: 'member', id: this.instanceToMember[hit.instanceId], point: hit.point };
    }
    if (kinds.includes('plane') && this.workPlane.visible) {
      const hit = this.raycaster.intersectObject(this.workPlane)[0];
      if (hit) return { kind: 'plane', point: hit.point };
    }
    if (kinds.includes('ground') && this.terrainMesh) {
      const hit = this.raycaster.intersectObject(this.terrainMesh)[0];
      if (hit) return { kind: 'ground', point: hit.point };
    }
    return null;
  }

  setGhost(a, b) {
    if (!a || !b) { this.ghost.visible = false; return; }
    this.ghost.geometry.setFromPoints([a, b]); this.ghost.computeLineDistances(); this.ghost.visible = true;
  }
  setCursor(p) { this.cursor.visible = !!p; if (p) this.cursor.position.copy(p); }

  // walk inside at eye height
  startWalk() {
    const t = this.controls.target;
    this.walk = { yaw: Math.atan2(this.camera.position.x - t.x, this.camera.position.z - t.z), pitch: 0.05, keys: new Set(), x: t.x, z: t.z };
    this.controls.enabled = false;
    const el = this.renderer.domElement;
    this._wk = e => { if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) { this.walk.keys[e.type === 'keydown' ? 'add' : 'delete'](e.code); e.preventDefault(); } };
    this._wd = e => { this.walk.drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture?.(e.pointerId); };
    this._wm = e => { if (!this.walk?.drag) return; this.walk.yaw -= (e.clientX - this.walk.drag.x) * 0.004; this.walk.pitch = Math.max(-1.2, Math.min(1.3, this.walk.pitch - (e.clientY - this.walk.drag.y) * 0.004)); this.walk.drag = { x: e.clientX, y: e.clientY }; };
    this._wu = () => { if (this.walk) this.walk.drag = null; };
    window.addEventListener('keydown', this._wk); window.addEventListener('keyup', this._wk);
    el.addEventListener('pointerdown', this._wd); el.addEventListener('pointermove', this._wm); window.addEventListener('pointerup', this._wu);
    this.camera.fov = 70; this.camera.updateProjectionMatrix();
  }
  walkMove(fwd, strafe) { if (this.walk) { this.walk.move = [fwd, strafe]; } }
  stopWalk() {
    if (!this.walk) return;
    window.removeEventListener('keydown', this._wk); window.removeEventListener('keyup', this._wk);
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this._wd); el.removeEventListener('pointermove', this._wm); window.removeEventListener('pointerup', this._wu);
    this.walk = null; this.controls.enabled = true;
    this.camera.fov = 45; this.camera.updateProjectionMatrix();
    this.frame();
  }

  tick() {
    const dt = Math.min(0.05, this.clock.getDelta());
    if (this.walk) {
      const w = this.walk, sp = 3.2 * dt;
      let f = (w.keys.has('KeyW') || w.keys.has('ArrowUp') ? 1 : 0) - (w.keys.has('KeyS') || w.keys.has('ArrowDown') ? 1 : 0);
      let s = (w.keys.has('KeyD') || w.keys.has('ArrowRight') ? 1 : 0) - (w.keys.has('KeyA') || w.keys.has('ArrowLeft') ? 1 : 0);
      if (w.move) { f += w.move[0]; s += w.move[1]; }
      w.x += (Math.sin(w.yaw) * f + Math.cos(w.yaw) * -s) * sp * -1;
      w.z += (Math.cos(w.yaw) * f - Math.sin(w.yaw) * -s) * sp * -1;
      const ground = terrainHeight(this.model.terrain, w.x, w.z);
      // stand on decks: highest panel surface below eye within 3 m is approximated by nodes
      let floor = ground;
      for (const p of this.model.panels) {
        if (p.skin !== 'deck') continue;
        const pts = p.nodes.map(id => this.model.nodes.find(n => n.id === id)).filter(Boolean);
        const minx = Math.min(...pts.map(q => q.x)), maxx = Math.max(...pts.map(q => q.x));
        const minz = Math.min(...pts.map(q => q.z)), maxz = Math.max(...pts.map(q => q.z));
        if (w.x >= minx && w.x <= maxx && w.z >= minz && w.z <= maxz) floor = Math.max(floor, pts.reduce((a, q) => a + q.y, 0) / pts.length);
      }
      w.y = w.y === undefined ? floor : w.y + (floor - w.y) * Math.min(1, dt * 8);
      this.camera.position.set(w.x, w.y + 1.62, w.z);
      const look = new THREE.Vector3(-Math.sin(w.yaw) * Math.cos(w.pitch), Math.sin(w.pitch), -Math.cos(w.yaw) * Math.cos(w.pitch));
      this.camera.lookAt(this.camera.position.clone().add(look));
    } else {
      this.controls.update();
    }
    if (this.rain) {
      const p = this.rain.geometry.attributes.position;
      const a = p.array;
      for (let i = 0; i < a.length; i += 6) { let y = a[i + 1] - 28 * dt; if (y < -10) y += 50; a[i + 1] = y; a[i + 4] = y + 0.7; }
      p.needsUpdate = true;
    }
    if (this.onFrame) this.onFrame(dt);
    this.renderer.render(this.scene, this.camera);
  }

  screenshot() { return this.renderer.domElement.toDataURL('image/png'); }
}
