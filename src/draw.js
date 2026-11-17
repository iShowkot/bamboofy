// Pole drawing with SketchUp-style inference.
// Red = along (x), green = across (z), blue = up (y): the colour convention shared by
// SketchUp, Blender and Rhino. Snaps: joints > midpoints > axes / parallel / perpendicular /
// slope > ground or free point (15° azimuth steps, 5 cm lengths).
import * as THREE from 'three';
import { terrainHeight } from './terrain.js';

const PLINTH = 0.45;
export const AXES = {
  x: { d: new THREE.Vector3(1, 0, 0), color: 0xd2412f, name: 'red axis' },
  y: { d: new THREE.Vector3(0, 0, 1), color: 0x3f9b46, name: 'green axis' },
  z: { d: new THREE.Vector3(0, 1, 0), color: 0x2f6fd8, name: 'vertical' }
};
const COL = { par: 0xc23bb3, perp: 0xc23bb3, slope: 0x8a5a2b, free: 0x2b2520, joint: 0x1e5bd8, mid: 0x1e9bb3, ground: 0x6b7d3a };

function closestOnLineToRay(P0, d, ray) {
  // closest point on line P0 + t·d to the ray; returns t
  const w0 = P0.clone().sub(ray.origin);
  const a = d.dot(d), b = d.dot(ray.direction), c = ray.direction.dot(ray.direction);
  const dd = d.dot(w0), e = ray.direction.dot(w0);
  const den = a * c - b * b;
  if (Math.abs(den) < 1e-9) return null;
  return (b * e - c * dd) / den;
}

export class PoleDrawer {
  constructor(viewer, host) {
    this.v = viewer; this.host = host;
    this.group = new THREE.Group(); this.group.renderOrder = 10; viewer.scene.add(this.group);
    this.label = document.createElement('div'); this.label.className = 'draw-label'; this.label.hidden = true;
    viewer.container.parentElement.appendChild(this.label);
    this.start = null; this.lock = null; this.shiftLock = null; this.typed = ''; this.snap = true;
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

  // typed "2.4" or "2.4<45" (Rhino style: length, elevation angle in degrees)
  applyTyped(c) {
    if (!this.typed || !this.start) return c;
    const [ls, as] = this.typed.split('<');
    const L = parseFloat(ls);
    if (!(L > 0)) return c;
    let dir = c?.vec && c.len > 1e-6 ? c.vec.clone().normalize() : new THREE.Vector3(1, 0, 0);
    if (as !== undefined && as !== '') {
      const el = parseFloat(as) * Math.PI / 180;
      const h = new THREE.Vector3(dir.x, 0, dir.z);
      if (h.lengthSq() < 1e-6) h.set(1, 0, 0);
      h.normalize();
      dir = h.multiplyScalar(Math.cos(el)).add(new THREE.Vector3(0, Math.sin(el), 0));
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
      const ax = new THREE.AxesHelper(1.2); ax.position.copy(P0); ax.material.depthTest = false; ax.renderOrder = 12;
      // AxesHelper colours x red, y green, z blue in three's frame; recolour to our convention (y up = blue, z = green)
      ax.setColors(new THREE.Color(AXES.x.color), new THREE.Color(AXES.z.color), new THREE.Color(AXES.y.color));
      g.add(ax);
    }
    // label
    const rect = this.v.renderer.domElement.getBoundingClientRect();
    const s = this.screen(c.p, rect);
    const height = c.p.y - gy;
    let text;
    if (c.kind === 'joint') text = `Joint @${c.node}`;
    else if (c.kind === 'mid') text = `Midpoint of pole #${c.member}`;
    else if (c.kind === 'ground') text = this.start ? (c.axis?.key === 'z' ? 'Straight down to the ground · plinth' : 'Ground · stone plinth') : 'Start here on the ground · stone plinth';
    else if (c.kind === 'axis') text = c.axis.key === 'z' ? (c.vec.y >= 0 ? 'Straight up' : 'Straight down') : `On ${c.axis.name}`;
    else if (c.kind === 'typed') text = 'Typed';
    else text = 'Free · slide onto a coloured line to snap';
    const bits = [text];
    if (this.start && c.len) bits.push(`${c.len.toFixed(2)} m`);
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

  setLock(ax) {
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
