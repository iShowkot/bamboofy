// Bamboofy renderer: drafting-table mode, presence mode, stress overlay, walk-inside view.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { terrainHeight, normalWaterLevel } from './terrain.js';
import { section, SPECIES } from './materials.js';

const PAPER = 0xefe8da, INK = 0x2b2520;
const PALETTES = {
  light: { bg: 0xefe8da, ink: 0x2b2520, terrain: 0xe7dfcd, grid: 0x7a6c55, contour: 0x8a7d66, member: 0xe2d4b4, timber: 0x8b6b4a, node: 0x2b2520, blend: 0xefe8da },
  dark:  { bg: 0x1c1a17, ink: 0xe9dfcc, terrain: 0x26231f, grid: 0xb3a68f, contour: 0x8f846f, member: 0xcdb78c, timber: 0x9a7552, node: 0xe9dfcc, blend: 0x1c1a17 }
};
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

function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

function disposeTree(root, keep) {
  root.traverse(o => {
    if (o.parent?.type === 'ArrowHelper' || o.type === 'ArrowHelper') return;
    if (o.geometry && !keep.has(o.geometry)) o.geometry.dispose();
    if (o.isInstancedMesh) o.dispose();
  });
}

const SKY_TOP = new THREE.Color(0x6f9ccc), SKY_HORIZON = new THREE.Color(0xf2d8b0), HAZE = 0xd9d2bf;

function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: SKY_TOP }, horizon: { value: SKY_HORIZON }, sunDir: { value: new THREE.Vector3(-0.6, 0.35, 0.5).normalize() } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; varying vec3 vDir;
      void main(){ float h = max(vDir.y, 0.0); vec3 c = mix(horizon, top, pow(h, 0.55));
        float s = max(dot(normalize(vDir), sunDir), 0.0); c += vec3(1.0,0.82,0.55) * (pow(s, 600.0) * 2.0 + pow(s, 12.0) * 0.25);
        if (vDir.y < 0.0) c = mix(horizon, vec3(0.62,0.6,0.52), min(1.0, -vDir.y * 4.0));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 16), mat);
  sky.renderOrder = -10;
  return sky;
}

function makeHills() {
  const g = new THREE.Group();
  const tones = [0x3f5a33, 0x58705c, 0x7d9294];
  tones.forEach((tone, k) => {
    const R = 150 + k * 80, n = 160, pos = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const h = 10 + k * 12 + 12 * Math.sin(a * 3 + k * 1.7) * Math.sin(a * 5 + k) + 5 * Math.sin(a * 9 + k * 3.1) + 2 * Math.sin(a * 17 + k);
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      pos.push(x, -40, z, x, h, z);
      if (i < n) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: tone, side: THREE.DoubleSide, fog: true }));
    g.add(mesh);
  });
  return g;
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
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1200);
    this.camera.position.set(26, 18, 30);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 3, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.495;

    this.mode = 'drafting';
    this.theme = 'light';
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
    this.sun.shadow.bias = -0.0015;
    this.sun.shadow.normalBias = 0.06;
    Object.assign(this.sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 160 });
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.sky = makeSky(); this.scene.add(this.sky);
    this.hills = makeHills(); this.scene.add(this.hills);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene(); envScene.add(makeSky());
    this.envMap = pmrem.fromScene(envScene, 0.02).texture;

    // Real culms: taper in geometry; node rings, sheen streaks and per-culm variation in the shader.
    this.culmUniforms = { uDraft: { value: 1 }, uRing: { value: 1 } };
    this.memberMat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0, side: THREE.DoubleSide, shadowSide: THREE.BackSide });
    this.memberMat.onBeforeCompile = sh => {
      sh.uniforms.uDraft = this.culmUniforms.uDraft; sh.uniforms.uRing = this.culmUniforms.uRing;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aLen; attribute float aSeed; varying float vAlong; varying float vSeed; varying float vAround;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlong = position.y * aLen; vSeed = aSeed; vAround = uv.x;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uDraft; uniform float uRing; varying float vAlong; varying float vSeed; varying float vAround;')
        .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float sp = 0.30 + 0.12 * fract(vSeed * 7.13);
          float ph = fract((vAlong + vSeed * 0.37) / sp);
          float d = min(ph, 1.0 - ph) * sp;
          float ring = exp(-pow(d / mix(0.011, 0.016, uDraft), 2.0));
          float halo = exp(-pow((ph * sp - 0.03) / 0.02, 2.0));
          float streak = 0.93 + 0.07 * sin(vAround * 6.2831 * 9.0 + vSeed * 31.0) * sin(vAlong * 1.3 + vSeed * 5.0);
          diffuseColor.rgb *= mix(streak, 1.0, uDraft);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * (1.0 - mix(0.5, 0.7, uDraft) * uRing), ring);
          diffuseColor.rgb += (1.0 - uDraft) * 0.07 * halo * uRing;
        }`);
    };
    this.unitCyl = new THREE.CylinderGeometry(0.93, 1, 1, 12, 1, true);
    this.unitCyl.translate(0, 0.5, 0);
    this.nodeMat = new THREE.MeshStandardMaterial({ roughness: 0.6 });
    this.unitSphere = new THREE.SphereGeometry(1, 12, 8);
    this.plinthMat = new THREE.MeshStandardMaterial({ color: 0x8d8a80, roughness: 0.95 });
    this.panelMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, vertexColors: true, transparent: true, roughness: 0.95, depthWrite: false });
    this.thatchUniforms = { uPresence: { value: 0 } };
    this.panelMat.onBeforeCompile = sh => {
      sh.uniforms.uPresence = this.thatchUniforms.uPresence;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vW;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uPresence; varying vec3 vW;')
        .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float rows = fract(vW.y * 7.0 + 0.35 * sin(vW.x * 1.9 + vW.z * 1.3));
          float fiber = 0.86 + 0.14 * sin((vW.x * 0.7 + vW.z * 0.7) * 85.0 + rows * 9.0 + sin(vW.y * 30.0));
          float course = 0.72 + 0.28 * smoothstep(0.0, 0.3, rows);
          diffuseColor.rgb *= mix(1.0, course * fiber, uPresence);
        }`);
    };
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

  get pal() { return PALETTES[this.theme] || PALETTES.light; }
  setTheme(theme) { this.theme = theme; this.inkMat.color.set(this.pal.ink); this.applyMode(); if (this.model) this.update(this.model, this.state); }
  setMode(mode) { this.mode = mode; this.applyMode(); if (this.model) this.update(this.model, this.state); }
  applyMode() {
    const p = this.mode === 'presence';
    this.scene.background = p ? null : new THREE.Color(this.pal.bg);
    this.scene.fog = p ? new THREE.FogExp2(HAZE, 0.0055) : null;
    this.scene.environment = p ? this.envMap : null;
    this.sky.visible = this.hills.visible = p;
    this.hemi.color.set(p ? 0xcfe0f0 : 0xfff5e0); this.hemi.groundColor.set(p ? 0x7a6448 : 0x6b6a50);
    this.hemi.intensity = p ? 1.25 : 2.2;
    this.sun.color.set(p ? 0xffd2a0 : 0xffe7c2);
    this.sun.intensity = p ? 2.8 : 0.9;
    this.sun.castShadow = p;
    this.renderer.toneMapping = p ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    this.renderer.toneMappingExposure = p ? 1.05 : 1;
    this.culmUniforms.uDraft.value = p ? 0 : 1;
    this.culmUniforms.uRing.value = this.overlay ? 0.45 : 1;
    this.thatchUniforms.uPresence.value = p ? 1 : 0;
    if (this.terrainModel) this.buildTerrain(this.terrainModel, true);
  }

  buildTerrain(t, force = false) {
    const key = JSON.stringify(t) + this.mode + this.theme + (this.waterRise || 0) + !!this.raining;
    if (!force && key === this.terrainKey) return;
    this.terrainKey = key; this.terrainModel = t;
    disposeTree(this.terrainGroup, new Set());
    this.terrainGroup.clear();
    const presence = this.mode === 'presence';
    const size = presence ? 260 : 90, res = presence ? 260 : 140;
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
        const grass = [0.2 + 0.05 * n, 0.36 + 0.08 * n, 0.12 + 0.03 * n], soil = [0.42, 0.31, 0.19];
        const k = Math.min(1, steep * 1.2);
        c.setRGB(grass[0] + (soil[0] - grass[0]) * k, grass[1] + (soil[1] - grass[1]) * k, grass[2] + (soil[2] - grass[2]) * k);
      } else {
        c.setHex(this.pal.terrain);
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
    // 1 m grid draped on the ground (bolder every 5 m) so the floor reads as a floor
    {
      const half = 20, step = 0.5, minor = [], major = [];
      for (let i = -half; i <= half; i++) {
        const arr = i % 5 === 0 ? major : minor;
        for (let t = -half; t < half; t += step) {
          arr.push(i, terrainHeight(this.terrainModel, i, t) + 0.02, t, i, terrainHeight(this.terrainModel, i, t + step) + 0.02, t + step);
          arr.push(t, terrainHeight(this.terrainModel, t, i) + 0.02, i, t + step, terrainHeight(this.terrainModel, t + step, i) + 0.02, i);
        }
      }
      for (const [arr, op] of [[minor, presence ? 0.08 : 0.22], [major, presence ? 0.16 : 0.42]]) {
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
        this.terrainGroup.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: presence ? 0x2d3a1e : this.pal.grid, transparent: true, opacity: op })));
      }
    }
    const lines = marchingContours((x, z) => terrainHeight(t, x, z), presence ? 90 : size, 110, 0.5);
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(lines, 3));
    const contour = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: this.mode === 'presence' ? 0x3d4a25 : this.pal.contour, transparent: true, opacity: this.mode === 'presence' ? 0.12 : 0.55 }));
    this.terrainGroup.add(contour);
    if (t.jhiri) {
      const wl = normalWaterLevel(t) + (this.waterRise || 0);
      const water = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ color: this.waterRise ? 0x7a6a48 : (presence ? 0x3f6b70 : 0x5f8a8f), transparent: true, opacity: presence ? 0.88 : 0.35, roughness: presence ? 0.06 : 0.15, metalness: presence ? 0.35 : 0.1 }));
      water.rotation.x = -Math.PI / 2; water.position.y = wl;
      // clip water to the channel using a mask: cheap trick, a thin band around the jhiri
      water.geometry = new THREE.PlaneGeometry(size, (t.jhiriWidth || 3) * 2.2 + (this.waterRise || 0) * 6);
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
    disposeTree(this.group, new Set([this.unitCyl, this.unitSphere]));
    this.group.clear();
    const nm = new Map(model.nodes.map(n => [n.id, n]));
    const disp = state.disp && this.deformScale ? state.disp : null;
    const P = id => {
      const n = nm.get(id) || model.nodes.find(x => x.id === id);
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
    const cyl = this.unitCyl.clone();
    const aLen = new Float32Array(Math.max(1, count)), aSeed = new Float32Array(Math.max(1, count));
    const inst = new THREE.InstancedMesh(cyl, this.memberMat, Math.max(1, count));
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
        const seed = hash(m.id * 13.7 + i * 3.1);
        const rr = r * (0.93 + 0.14 * hash(seed * 91.3));
        // a little natural crookedness: tilt each culm by up to ~0.6°
        const wob = new THREE.Quaternion().setFromAxisAngle(side, (hash(seed * 17.1) - 0.5) * 0.02);
        mtx.compose(a.clone().add(off), wob.multiply(q.clone()), new THREE.Vector3(rr, L, rr));
        inst.setMatrixAt(k, mtx);
        aLen[k] = L; aSeed[k] = (seed + m.id * 0.618) % 1;
        if (this.overlay && memberU) stressColor(memberU.get(m.id), col);
        else if (presence) {
          if (species.kind === 'timber') col.setHSL(0.07, 0.42, 0.28 + 0.06 * hash(seed * 5.1));
          else col.setHSL(0.095 + 0.025 * hash(seed * 3.3) + (hash(seed * 7.7) > 0.85 ? 0.04 : 0), 0.55 + 0.15 * hash(seed * 2.2), 0.56 + 0.1 * hash(seed * 4.4));
        }
        else col.setHex(species.kind === 'timber' ? this.pal.timber : this.pal.member);
        if (this.highlight?.kind === 'member' && this.highlight.id === m.id) col.setHex(0x1e5bd8);
        if (state.failed?.has(m.id)) col.setHex(0xc0392b);
        inst.setColorAt(k, col);
        this.instanceToMember[k] = m.id;
        k++;
      }
      ink.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    inst.count = k;
    cyl.setAttribute('aLen', new THREE.InstancedBufferAttribute(aLen, 1));
    cyl.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1));
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
      else col.setHex(presence ? 0x5b4630 : this.pal.node);
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
      if (!presence) col.lerp(new THREE.Color(this.pal.blend), 0.25);
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
    this.fitSun();
    // landslide marker
    if (state.settleNode && nm.has(state.settleNode)) {
      const p = P(state.settleNode);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.06, 8, 32), new THREE.MeshBasicMaterial({ color: 0xb5532f }));
      ring.rotation.x = Math.PI / 2; ring.position.copy(p).add(new THREE.Vector3(0, -0.4, 0));
      this.group.add(ring);
    }
  }

  fitSun() {
    const b = this.bounds();
    const c = b.getCenter(new THREE.Vector3()), r = Math.max(12, b.getSize(new THREE.Vector3()).length() * 0.65);
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).add(new THREE.Vector3(-0.62, 0.42, 0.52).multiplyScalar(80));
    Object.assign(this.sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 200 });
    this.sun.shadow.camera.updateProjectionMatrix();
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
    for (const f of this.tickers || []) f(dt);
    this.renderer.render(this.scene, this.camera);
  }

  screenshot() { return this.renderer.domElement.toDataURL('image/png'); }
}
