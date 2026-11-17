// Hill terrain: a valley with a jhiri (stream) running along x.
export function terrainHeight(t, x, z) {
  const tanS = Math.tan((t.slope || 0) * Math.PI / 180);
  const ripple = 0.25 * Math.sin(x * 0.17) * Math.cos(z * 0.11) + 0.15 * Math.sin(x * 0.05 + z * 0.07);
  if (!t.jhiri) return -tanS * z + ripple;
  const dz = z - (t.jhiriZ || 0);
  // steeper near bank (z<0, uphill side), gentler far bank
  const side = dz < 0 ? 1 : 0.55;
  const valley = tanS * side * Math.sqrt(dz * dz + 4) - tanS * 2 * side;
  const w = (t.jhiriWidth || 3) / 2;
  const channel = (t.jhiriDepth || 2) * Math.exp(-(dz * dz) / (w * w));
  // the stream bed is smooth: damp the ripple near the channel so water reads as one surface
  const calm = 1 - 0.9 * Math.exp(-(dz * dz) / (w * w * 3));
  return valley - channel + ripple * calm;
}

export function streamBed(t) {
  return terrainHeight(t, 0, t.jhiriZ || 0);
}

export function normalWaterLevel(t) { return streamBed(t) + (t.jhiriDepth || 2) * 0.55; }
