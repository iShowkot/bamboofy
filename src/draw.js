// Pole drawing with SketchUp-style inference.
// Red = along (x), green = across (z), blue = up (y): the colour convention shared by
// SketchUp, Blender and Rhino. Snaps: joints > midpoints > axes / parallel / perpendicular /
// slope > ground or free point (15° azimuth steps, 5 cm lengths).
import * as THREE from 'three';
import { terrainHeight } from './terrain.js';

const PLINTH = 0.45;
// Named the Blender / SketchUp way: X red, Y green (both level), Z blue (up).
export const AXES = {
  x: { d: new THREE.Vector3(1, 0, 0), color: 0xd2412f, name: 'X', letter: 'X' },
  y: { d: new THREE.Vector3(0, 0, 1), color: 0x3f9b46, name: 'Y', letter: 'Y' },
  z: { d: new THREE.Vector3(0, 1, 0), color: 0x2f6fd8, name: 'Z', letter: 'Z' }
};

function letterSprite(text, color) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#' + new THREE.Color(color).getHexString();
  g.beginPath(); g.arc(32, 32, 28, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 34px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 32, 34);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  spr.renderOrder = 13;
  return spr;
}
const COL = { par: 0xc23bb3, perp: 0xc23bb3, slope: 0x8a5a2b, free: 0x2b2520, joint: 0x1e5bd8, mid: 0x1e9bb3, ground: 0x6b7d3a, angle: 0xb5532f, typed: 0xb5532f };

function closestOnLineToRay(P0, d, ray) {
  // closest point on line P0 + t·d to the ray; returns t
  const w0 = P0.clone().sub(ray.origin);
  const a = d.dot(d), b = d.dot(ray.direction), c = ray.direction.dot(ray.direction);
  const dd = d.dot(w0), e = ray.direction.dot(w0);
  const den = a * c - b * b;
  if (Math.abs(den) < 1e-9) return null;
  return (b * e - c * dd) / den;
}

function textSprite(text, color = '#2b2520') {
  const c = document.createElement('canvas'); c.width = 128; c.height = 56;
  const g = c.getContext('2d');
  g.fillStyle = '#fffdf8ee'; g.strokeStyle = color; g.lineWidth = 3;
  g.beginPath(); g.roundRect(4, 4, 120, 48, 14); g.fill(); g.stroke();
  g.fillStyle = color; g.font = 'bold 28px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 64, 30);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  spr.renderOrder = 14;
  return spr;
}

export function anglesOf(v) {
  const L = v.length() || 1;
  const tilt = Math.acos(Math.max(-1, Math.min(1, v.y / L))) * 180 / Math.PI;
  let heading = Math.atan2(v.z, v.x) * 180 / Math.PI; if (heading < 0) heading += 360;
  return { tilt, heading };
}
const dirFrom = (tiltDeg, headDeg) => {
  const t = tiltDeg * Math.PI / 180, h = headDeg * Math.PI / 180;
  return new THREE.Vector3(Math.sin(t) * Math.cos(h), Math.cos(t), Math.sin(t) * Math.sin(h));
};

export class PoleDrawer {
  constructor(viewer, host) {
    this.v = viewer; this.host = host;
    this.group = new THREE.Group(); this.group.renderOrder = 10; viewer.scene.add(this.group);
    this.label = document.createElement('div'); this.label.className = 'draw-label'; this.label.hidden = true;
    viewer.container.parentElement.appendChild(this.label);
    this.start = null; this.lock = null; this.shiftLock = null; this.typed = ''; this.snap = true;
    this.tiltLock = null; this.headLock = null; // degrees: tilt from vertical, heading from +X toward +Y
    this.cand = null; this.lastEv = null;
    this.ray = new THREE.Raycaster();
    this.lineMat = c => new THREE.LineBasicMaterial({ color: c, depthTest: false, transparent: true, opacity: 0.9 });
  }

  get terrain() { return this.v.model.terrain; }
  ground(x, z) { return terrainHeight(this.terrain, x, z); }

  reset() { this.start = null; this.typed = ''; this.shiftLock = null; this.cand = null; this.clear(); this.label.hidden = true; }
  clear() {
    this.group.traverse(o => { o.geometry?.dispose?.(); });
    this.group.clear();
  }

  screen(p, rect) {
    const v = p.clone().project(this.v.camera);
    return { x: (v.x + 1) / 2 * rect.width, y: (1 - v.y) / 2 * rect.height, behind: v.z > 1 };
  }

  solve(ev) {
    const el = this.v.renderer.domElement, rect = el.getBoundingClientRect();
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    this.ray.setFromCamera(new THREE.Vector2(mx / rect.width * 2 - 1, -(my / rect.height) * 2 + 1), this.v.camera);
    const ray = this.ray.ray;
    const snapping = this.snap && !ev.altKey;
    const model = this.v.model;
    const nodePos = id => this.v.nodePos(id);
    const lock = this.shiftLock || this.lock;
    const dist2 = p => { const s = this.screen(p, rect); return s.behind ? 1e9 : Math.hypot(s.x - mx, s.y - my); };

    // 1. existing joints
    if (snapping && !lock) {
      let best = null, bd = 14;
      for (const n of model.nodes) {
        if (this.start?.node === n.id) continue;
        const p = nodePos(n.id); const d = dist2(p);
        if (d < bd) { bd = d; best = { p, node: n.id, kind: 'joint' }; }
      }
      if (best) return this.finish(best);
    }

    const tHit = this.v.terrainMesh ? this.ray.intersectObject(this.v.terrainMesh)[0] : null;
    if (!this.start) {
      if (tHit) return this.finish({ p: tHit.point.clone().setY(this.ground(tHit.point.x, tHit.point.z) + PLINTH), kind: 'ground', ground: true });
      return null;
    }
    const P0 = this.start.p;

    // 2. midpoints of poles
    if (snapping && !lock) {
      let best = null, bd = 11;
      for (const m of model.members) {
        if (m.a === this.start.node || m.b === this.start.node) continue;
        const p = nodePos(m.a).add(nodePos(m.b)).multiplyScalar(0.5);
        const d = dist2(p);
        if (d < bd) { bd = d; best = { p, kind: 'mid', member: m.id }; }
      }
      if (best) return this.finish(best);
    }

    // 3a. angle locks: tilt (cone around vertical) and/or heading
    if (this.tiltLock != null || this.headLock != null) {
      const step = snapping ? 15 : 0;
      const q = x => step ? Math.round(x / step) * step : x;
      let head = this.headLock;
      if (head == null) {
        const hp = ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -P0.y), new THREE.Vector3());
        const v = hp ? hp.sub(P0) : ray.direction.clone();
        head = (Math.atan2(v.z, v.x) * 180 / Math.PI + 360) % 360;
        head = q(head) % 360;
      }
      let tilt = this.tiltLock;
      if (tilt == null) {
        const hd = dirFrom(90, head);
        const vp = ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(-hd.z, 0, hd.x), P0), new THREE.Vector3());
        const v = vp ? vp.sub(P0) : new THREE.Vector3(0, 1, 0);
        tilt = Math.atan2(Math.max(0, v.dot(hd)), v.y) * 180 / Math.PI;
        tilt = Math.max(0, Math.min(180, q(tilt)));
      }
      const d = dirFrom(tilt, head);
      let t = closestOnLineToRay(P0, d, ray);
      if (t == null || t < 0.05) t = 0.05;
      if (snapping) t = Math.max(0.05, Math.round(t / 0.05) * 0.05);
      let p = P0.clone().addScaledVector(d, t);
      const gy = this.ground(p.x, p.z) + PLINTH;
      if (d.y < 0 && p.y <= gy) {
        const k = (P0.y - gy) / -d.y; p = P0.clone().addScaledVector(d, k); p.y = this.ground(p.x, p.z) + PLINTH;
        return this.finish({ p, kind: 'ground', ground: true, angled: true });
      }
      return this.finish({ p, kind: 'angle' });
    }

    // 3. directions: axes, parallel / perpendicular to the poles at the start joint, slope
    const dirs = Object.entries(AXES).map(([k, a]) => ({ key: k, d: a.d.clone(), color: a.color, name: a.name }));
    if (this.start.node != null) {
      for (const m of model.members) {
        if (m.a !== this.start.node && m.b !== this.start.node) continue;
        const ref = nodePos(m.b).sub(nodePos(m.a)).normalize();
        dirs.push({ key: 'par', d: ref, color: COL.par, name: `parallel to pole #${m.id}` });
        const perp = new THREE.Vector3().crossVectors(ref, AXES.z.d);
        if (perp.lengthSq() > 1e-6) dirs.push({ key: 'perp', d: perp.normalize(), color: COL.perp, name: `square to pole #${m.id}` });
      }
    }
    if (this.start.ground) {
      const e = 0.5, gx = this.ground(P0.x + e, P0.z) - this.ground(P0.x - e, P0.z), gz = this.ground(P0.x, P0.z + e) - this.ground(P0.x, P0.z - e);
      const h = new THREE.Vector3(gx, 0, gz);
      if (h.lengthSq() > 1e-6) { h.normalize(); const slope = Math.hypot(gx, gz) / (2 * e); dirs.push({ key: 'slope', d: new THREE.Vector3(-h.x, -slope, -h.z).normalize(), color: COL.slope, name: 'along the slope' }); }
    }
    const usable = lock ? dirs.filter(d => d.key === lock) : (snapping ? dirs : []);
    let bestDir = null, bestD = lock ? Infinity : 24, bestT = 0;
    for (const dr of usable) {
      for (const sgn of [1]) {
        const t = closestOnLineToRay(P0, dr.d, ray);
        if (t === null) continue;
        const p = P0.clone().addScaledVector(dr.d, t * sgn);
        const dd = dist2(p);
        if (dd < bestD) { bestD = dd; bestDir = dr; bestT = t; }
      }
    }
    if (bestDir) {
      let t = bestT;
      if (snapping) t = Math.round(t / 0.05) * 0.05;
      if (Math.abs(t) < 0.05) t = 0.05 * Math.sign(t || 1);
      const p = P0.clone().addScaledVector(bestDir.d, t);
      const gy = this.ground(p.x, p.z) + PLINTH;
      if (p.y <= gy + 0.02 && bestDir.d.y * Math.sign(t) < 0) {
        // going down: stop on the ground and stand on a plinth
        const k = (P0.y - gy) / Math.max(1e-6, -bestDir.d.y * Math.sign(t));
        const q = P0.clone().addScaledVector(bestDir.d, Math.sign(t) * k);
        q.y = this.ground(q.x, q.z) + PLINTH;
        return this.finish({ p: q, kind: 'ground', ground: true, axis: bestDir });
      }
      return this.finish({ p, kind: 'axis', axis: bestDir });
    }

    // 4. free point: whatever is nearer under the cursor, the ground or an upright
    //    plane through the start that faces you. Move the mouse up and the pole rises.
    const fwd = new THREE.Vector3(); this.v.camera.getWorldDirection(fwd); fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(fwd, P0);
    const pHit = ray.intersectPlane(plane, new THREE.Vector3());
    const dPlane = pHit ? pHit.distanceTo(ray.origin) : Infinity, dGround = tHit ? tHit.distance : Infinity;
    const planeUnder = pHit && pHit.y < this.ground(pHit.x, pHit.z) + PLINTH;
    if (tHit && (dGround <= dPlane || planeUnder)) {
      const g = tHit.point.clone(); g.y = this.ground(g.x, g.z) + PLINTH;
      return this.finish({ p: g, kind: 'ground', ground: true });
    }
    if (!pHit) return null;
    const v = pHit.clone().sub(P0);
    if (snapping && v.length() > 1e-3) {
      // 15° steps of tilt within the plane, 5 cm lengths
      const side = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const L = Math.round(v.length() / 0.05) * 0.05;
      const ang = Math.round(Math.atan2(v.y, v.dot(side)) / (Math.PI / 12)) * (Math.PI / 12);
      v.copy(side.multiplyScalar(Math.cos(ang) * L)).add(new THREE.Vector3(0, Math.sin(ang) * L, 0));
    }
    return this.finish({ p: P0.clone().add(v), kind: 'free' });
  }

  finish(c) {
    if (this.start) {
      c.vec = c.p.clone().sub(this.start.p);
      c.len = c.vec.length();
    }
    return c;
  }

  // typed "2.4" or "2.4<30" (Rhino style: length, then tilt from vertical in degrees)
  applyTyped(c) {
    if (!this.typed || !this.start) return c;
    const [ls, as] = this.typed.split('<');
    const L = parseFloat(ls);
    if (!(L > 0)) return c;
    let dir = c?.vec && c.len > 1e-6 ? c.vec.clone().normalize() : new THREE.Vector3(1, 0, 0);
    if (as !== undefined && as !== '') {
      // Rhino-style "length<angle": angle is the tilt from vertical, heading follows the cursor
      const { heading } = anglesOf(dir);
      dir = dirFrom(parseFloat(as), this.headLock ?? heading);
    }
    const p = this.start.p.clone().addScaledVector(dir, L);
    return this.finish({ ...c, p, kind: c?.kind === 'axis' ? 'axis' : 'typed', node: undefined, ground: false });
  }

  move(ev) {
    this.lastEv = ev;
    let c = this.solve(ev);
    c = this.applyTyped(c);
    this.cand = c;
    this.draw(c, ev);
  }

  draw(c) {
    this.clear();
    if (!c) { this.label.hidden = true; return; }
    const g = this.group;
    const add = (pts, color, dashed = false) => {
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = dashed ? new THREE.LineDashedMaterial({ color, dashSize: 0.25, gapSize: 0.15, depthTest: false, transparent: true, opacity: 0.85 }) : this.lineMat(color);
      const line = new THREE.Line(geo, mat); if (dashed) line.computeLineDistances(); line.renderOrder = 10; g.add(line);
    };
    const color = c.kind === 'axis' ? c.axis.color : COL[c.kind] ?? COL.free;
    // cursor dot
    const dot = new THREE.Mesh(new THREE.SphereGeometry(c.kind === 'joint' || c.kind === 'mid' ? 0.16 : 0.11, 14, 10), new THREE.MeshBasicMaterial({ color, depthTest: false }));
    dot.position.copy(c.p); dot.renderOrder = 11; g.add(dot);
    // drop line to the ground + footprint ring
    const gy = this.ground(c.p.x, c.p.z);
    if (c.p.y - gy > 0.3) {
      add([c.p, new THREE.Vector3(c.p.x, gy, c.p.z)], 0x6b5f50, true);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.2, 24), new THREE.MeshBasicMaterial({ color: 0x6b5f50, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.8 }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(c.p.x, gy + 0.03, c.p.z); g.add(ring);
    }
    if (this.start) {
      const P0 = this.start.p;
      // the pole itself, as a thin culm
      const len = c.len || 0;
      if (len > 1e-3) {
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, len, 10), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75 }));
        cyl.position.copy(P0).add(c.p).multiplyScalar(0.5);
        cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.vec.clone().normalize());
        g.add(cyl);
      }
      // the three axes through the start are always shown faintly; the snapped one is bold
      for (const [k, a] of Object.entries(AXES)) {
        const on = (c.kind === 'axis' || c.kind === 'ground') && c.axis?.key === k;
        const geo = new THREE.BufferGeometry().setFromPoints([P0.clone().addScaledVector(a.d, -30), P0.clone().addScaledVector(a.d, 30)]);
        const mat = new THREE.LineDashedMaterial({ color: a.color, dashSize: on ? 0.3 : 0.15, gapSize: on ? 0.12 : 0.2, depthTest: false, transparent: true, opacity: on ? 0.95 : 0.35 });
        const line = new THREE.Line(geo, mat); line.computeLineDistances(); line.renderOrder = 10; g.add(line);
      }
      if (c.kind === 'axis' && !AXES[c.axis.key]) {
        const d = c.axis.d;
        add([P0.clone().addScaledVector(d, -30), P0.clone().addScaledVector(d, 30)], c.axis.color, true);
      }
      // local metre grid on the level plane through the start
      const grid = new THREE.GridHelper(10, 10, 0x8a7d6a, 0xb8ac93);
      grid.position.copy(P0); grid.material.transparent = true; grid.material.opacity = 0.35; grid.material.depthTest = false;
      g.add(grid);
      this.axisArrows(P0, c);
      if (len > 0.2) this.protractor(P0, c);
    }
    if (!this.start && c.kind === 'ground') this.ghostPlinth(c.p);
    if (this.start?.ground) this.ghostPlinth(this.start.p);
    // label
    const rect = this.v.renderer.domElement.getBoundingClientRect();
    const s = this.screen(c.p, rect);
    const height = c.p.y - gy;
    let text;
    if (c.kind === 'joint') text = `Joint @${c.node}`;
    else if (c.kind === 'mid') text = `Midpoint of pole #${c.member}`;
    else if (c.kind === 'ground') text = this.start ? (c.axis?.key === 'z' ? 'Down Z to the ground · plinth' : 'On the ground · stone plinth') : 'Click to plant a pole here (stone plinth)';
    else if (c.kind === 'axis') {
      const k = c.axis.key, pos = c.vec.dot(c.axis.d) >= 0;
      text = k === 'z' ? (pos ? 'Up Z ↑' : 'Down Z ↓') : AXES[k] ? `Along ${pos ? '+' : '−'}${AXES[k].letter}` : `${c.axis.name[0].toUpperCase()}${c.axis.name.slice(1)}`;
    }
    else if (c.kind === 'typed') text = 'Typed';
    else if (c.kind === 'angle') text = this.tiltLock != null && this.headLock != null ? 'Angle locked' : this.tiltLock != null ? `Tilt locked at ${this.tiltLock}° · move to swing` : `Heading locked at ${this.headLock}°`;
    else text = 'Free';
    const bits = [text];
    if (this.start && c.len > 1e-3) {
      const { tilt, heading } = anglesOf(c.vec);
      if (!(c.kind === 'axis' && AXES[c.axis.key])) bits.push(tilt > 1 && tilt < 179 ? `tilt ${Math.round(tilt)}° · heading ${Math.round(heading) % 360}°` : `tilt ${Math.round(tilt)}°`);
      bits.push(`${c.len.toFixed(2)} m`);
      this.host.onAngles?.(tilt, heading);
    }
    if (height > 0.3 && c.kind !== 'ground') bits.push(`+${height.toFixed(2)} m high`);
    let warn = '';
    const stock = this.host.stockLength?.();
    if (this.start && stock && c.len > stock) warn = `longer than a ${stock} m culm, needs a splice`;
    this.label.innerHTML = `<span class="sw" style="background:#${new THREE.Color(color).getHexString()}"></span>${bits.join(' · ')}${warn ? `<em>${warn}</em>` : ''}${this.typed ? `<b>⌨ ${this.typed}▌</b>` : ''}`;
    this.label.classList.toggle('warn', !!warn);
    this.label.hidden = s.behind;
    const lw = this.label.offsetWidth || 220;
    this.label.style.left = Math.max(8, Math.min(rect.width - lw - 8, s.x + 16)) + 'px';
    this.label.style.top = Math.max(8, s.y - 34) + 'px';
    this.host.onLength?.(this.start ? c.len : null);
  }

  // labelled X / Y / Z arrows at the start point, scaled to stay readable at any zoom
  axisArrows(P0, c) {
    const dist = this.v.camera.position.distanceTo(P0);
    const L = Math.max(1, dist * 0.09);
    for (const [k, a] of Object.entries(AXES)) {
      const on = c.axis?.key === k;
      const arrow = new THREE.ArrowHelper(a.d, P0, L, a.color, L * 0.22, L * 0.12);
      arrow.traverse(o => { if (o.material) { o.material.depthTest = false; o.material.transparent = true; o.material.opacity = on ? 1 : 0.75; } o.renderOrder = 12; });
      this.group.add(arrow);
      const spr = letterSprite(a.letter + (k === 'z' ? '↑' : ''), a.color);
      spr.position.copy(P0).addScaledVector(a.d, L * 1.18);
      const sz = L * (on ? 0.32 : 0.24); spr.scale.set(sz, sz, 1);
      this.group.add(spr);
    }
  }

  // SketchUp-style protractor: arc from vertical (Z) down to the pole, ticks every 15°
  protractor(P0, c) {
    const { tilt } = anglesOf(c.vec);
    if (tilt < 2 || tilt > 178) return;
    const up = new THREE.Vector3(0, 1, 0);
    const h = new THREE.Vector3(c.vec.x, 0, c.vec.z).normalize();
    const r = Math.min(c.len * 0.6, Math.max(0.8, this.v.camera.position.distanceTo(P0) * 0.08));
    const pt = a => P0.clone().addScaledVector(up, Math.cos(a) * r).addScaledVector(h, Math.sin(a) * r);
    const arc = [];
    for (let a = 0; a <= tilt; a += 1.5) arc.push(pt(a * Math.PI / 180));
    arc.push(pt(tilt * Math.PI / 180));
    const mat = new THREE.LineBasicMaterial({ color: 0xb5532f, depthTest: false, transparent: true });
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(arc), mat); l.renderOrder = 12; this.group.add(l);
    const ticks = [];
    for (let a = 0; a <= 180; a += 15) {
      const ar = a * Math.PI / 180, inner = P0.clone().addScaledVector(up, Math.cos(ar) * r * 0.9).addScaledVector(h, Math.sin(ar) * r * 0.9);
      ticks.push(inner, pt(ar));
    }
    const tk = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ticks), new THREE.LineBasicMaterial({ color: 0xb5532f, depthTest: false, transparent: true, opacity: 0.45 }));
    tk.renderOrder = 12; this.group.add(tk);
    const spr = textSprite(`${Math.round(tilt)}°`, '#b5532f');
    spr.position.copy(pt(tilt * Math.PI / 360)).addScaledVector(h, r * 0.15).addScaledVector(up, r * 0.15);
    const s = Math.max(r * 0.7, this.v.camera.position.distanceTo(P0) * 0.06); spr.scale.set(s, s * 0.44, 1);
    this.group.add(spr);
  }

  ghostPlinth(p) {
    const gy = this.ground(p.x, p.z);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 0.5, 7), new THREE.MeshBasicMaterial({ color: 0x6b7d3a, transparent: true, opacity: 0.45 }));
    m.position.set(p.x, gy + 0.2, p.z);
    this.group.add(m);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 32), new THREE.MeshBasicMaterial({ color: 0x6b7d3a, side: THREE.DoubleSide, transparent: true, opacity: 0.6, depthTest: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, gy + 0.03, p.z);
    this.group.add(ring);
  }

  click(ev) {
    const c = this.cand || this.solve(ev);
    if (!c) return;
    if (!this.start) {
      const node = c.kind === 'joint' ? c.node : null;
      this.start = { p: c.p.clone(), node, ground: c.kind === 'ground' };
      this.move(ev);
      return;
    }
    if (c.len < 0.05) return;
    const endNode = this.host.commit(this.start, c);
    if (endNode == null) return;
    const en = this.v.model.nodes.find(n => n.id === endNode);
    this.start = { p: new THREE.Vector3(en.x, en.y, en.z), node: endNode, ground: false };
    this.typed = '';
    this.shiftLock = null;
    if (this.lastEv) this.move(this.lastEv); else this.clear();
  }

  // returns true when the key was used
  key(e) {
    const k = e.key;
    if (e.type === 'keyup') {
      if (k === 'Shift') { this.shiftLock = null; if (this.lastEv) this.move(this.lastEv); return true; }
      return false;
    }
    if (k === 'Shift' && this.cand?.kind === 'axis') { this.shiftLock = this.cand.axis.key; return true; }
    if (!this.start) return false;
    if (/^[0-9.<]$/.test(k)) { this.typed += k; this.move(this.lastEv || { clientX: 0, clientY: 0 }); return true; }
    if (k === 'Backspace' && this.typed) { this.typed = this.typed.slice(0, -1); this.move(this.lastEv); return true; }
    if (k === 'Enter' && this.typed) { this.click(this.lastEv); return true; }
    const axisKeys = { ArrowRight: 'x', ArrowLeft: 'y', ArrowUp: 'z', x: 'x', X: 'x', y: 'y', Y: 'y', z: 'z', Z: 'z' };
    if (axisKeys[k] && !e.ctrlKey && !e.metaKey) {
      const ax = axisKeys[k];
      this.setLock(this.lock === ax ? null : ax);
      return true;
    }
    if (k === 'Escape') {
      if (this.typed) { this.typed = ''; this.move(this.lastEv); return true; }
      this.start = null; this.lock = null; this.host.onLock?.(null); this.clear(); this.label.hidden = true; this.host.onLength?.(null);
      return true;
    }
    return false;
  }

  setAngles(tilt, heading) {
    this.tiltLock = tilt; this.headLock = heading;
    if (tilt != null || heading != null) { this.lock = null; this.host.onLock?.(null); }
    if (this.lastEv) this.move(this.lastEv);
  }

  setLock(ax) {
    if (ax) { this.tiltLock = null; this.headLock = null; this.host.onAngleLocks?.(); }
    this.lock = ax;
    this.host.onLock?.(ax);
    if (this.lastEv) this.move(this.lastEv);
  }

  commitLength(text) {
    if (!this.start) return false;
    this.typed = String(text).trim();
    this.move(this.lastEv || { clientX: 0, clientY: 0 });
    this.click(this.lastEv);
    return true;
  }
}
