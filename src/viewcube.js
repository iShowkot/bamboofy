// View cube (as in Fusion 360, Rhino, Onshape): shows orientation, click a face to look from there.
// Front faces downhill (+z); the back faces uphill.
import * as THREE from 'three';

const FACES = [
  { cls: 'top', label: 'Top', n: [0, 1, 0] },
  { cls: 'bottom', label: 'Under', n: [0, -1, 0] },
  { cls: 'front', label: 'Front', n: [0, 0, 1] },
  { cls: 'back', label: 'Back', n: [0, 0, -1] },
  { cls: 'right', label: 'Right', n: [1, 0, 0] },
  { cls: 'left', label: 'Left', n: [-1, 0, 0] }
];

export class ViewCube {
  constructor(viewer, parent) {
    this.v = viewer;
    const wrap = document.createElement('div');
    wrap.className = 'viewcube';
    wrap.innerHTML = `<div class="vc-cube">${FACES.map(f => `<button class="vc-face vc-${f.cls}" data-n="${f.n.join(',')}" title="Look from the ${f.label.toLowerCase()}${f.cls === 'front' ? ' (downhill side)' : f.cls === 'back' ? ' (uphill side)' : ''}">${f.label}</button>`).join('')}</div>
      <button class="vc-home" title="Fit the whole design">Fit</button>`;
    parent.appendChild(wrap);
    // Blender-style axis compass in the corner
    this.triad = document.createElement('canvas');
    this.triad.className = 'axis-triad'; this.triad.width = this.triad.height = 160;
    this.triad.title = 'X (red) and Y (green) are level, Z (blue) points up';
    parent.appendChild(this.triad);
    this.cube = wrap.querySelector('.vc-cube');
    for (const b of wrap.querySelectorAll('.vc-face')) b.onclick = () => this.lookFrom(new THREE.Vector3(...b.dataset.n.split(',').map(Number)));
    wrap.querySelector('.vc-home').onclick = () => this.fit();
    this.wrap = wrap;
    this.tween = null;
  }

  sync() {
    const e = this.v.camera.matrixWorldInverse.elements;
    const f = [1, -1, 1];
    const m = [];
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      if (i < 3 && j < 3) m[j * 4 + i] = e[j * 4 + i] * f[i] * f[j];
      else m[j * 4 + i] = i === j ? 1 : 0;
    }
    this.cube.style.transform = `translateZ(-70px) matrix3d(${m.map(x => x.toFixed(5)).join(',')})`;
    this.drawTriad();
    this.step();
  }

  drawTriad() {
    const g = this.triad.getContext('2d'), S = 160, c = S / 2, R = 52;
    g.clearRect(0, 0, S, S);
    const q = this.v.camera.quaternion.clone().invert();
    const axes = [
      { v: new THREE.Vector3(1, 0, 0), col: '#d2412f', t: 'X' },
      { v: new THREE.Vector3(0, 0, 1), col: '#3f9b46', t: 'Y' },
      { v: new THREE.Vector3(0, 1, 0), col: '#2f6fd8', t: 'Z' }
    ].map(a => ({ ...a, p: a.v.clone().applyQuaternion(q) }));
    axes.sort((a, b) => a.p.z - b.p.z);
    g.fillStyle = '#fffdf8cc'; g.beginPath(); g.arc(c, c, R + 22, 0, Math.PI * 2); g.fill();
    for (const a of axes) {
      const x = c + a.p.x * R, y = c - a.p.y * R;
      g.strokeStyle = a.col; g.lineWidth = 5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(c, c); g.lineTo(x, y); g.stroke();
      g.fillStyle = a.col; g.beginPath(); g.arc(x, y, 15, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.font = 'bold 18px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(a.t, x, y + 1);
    }
  }

  animateTo(target, position) {
    this.tween = { t: 0, t0: this.v.controls.target.clone(), p0: this.v.camera.position.clone(), t1: target, p1: position };
  }
  step() {
    const tw = this.tween; if (!tw) return;
    tw.t = Math.min(1, tw.t + 0.08);
    const k = tw.t < 0.5 ? 2 * tw.t * tw.t : 1 - Math.pow(-2 * tw.t + 2, 2) / 2;
    this.v.controls.target.lerpVectors(tw.t0, tw.t1, k);
    // swing around the target rather than through it
    const d0 = tw.p0.clone().sub(tw.t0), d1 = tw.p1.clone().sub(tw.t1);
    const len = d0.length() + (d1.length() - d0.length()) * k;
    const dir = d0.normalize().lerp(d1.normalize(), k).normalize();
    this.v.camera.position.copy(this.v.controls.target).addScaledVector(dir, len);
    if (tw.t >= 1) this.tween = null;
  }

  lookFrom(n) {
    const target = this.v.controls.target.clone();
    const dist = this.v.camera.position.distanceTo(target);
    const dir = n.clone();
    if (Math.abs(dir.y) > 0.99) dir.z += 0.002; // avoid a degenerate top view
    this.animateTo(target, target.clone().addScaledVector(dir.normalize(), dist));
  }

  fit() {
    const box = this.v.bounds();
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3()).length();
    const dir = this.v.camera.position.clone().sub(this.v.controls.target).normalize();
    this.animateTo(c, c.clone().addScaledVector(dir, Math.max(14, s * 1.45) / Math.min(1, this.v.camera.aspect * 1.1)));
  }

  centerOn(p) {
    const delta = p.clone().sub(this.v.controls.target);
    this.animateTo(p.clone(), this.v.camera.position.clone().add(delta));
  }
}
