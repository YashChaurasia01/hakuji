const MIN_ZOOM = 0.04;
const MAX_ZOOM = 40;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Fixed zoom stops (as percentages): 10% increments through 400%, coarser beyond.
const ZOOM_STOPS = [
  5,
  ...Array.from({ length: 40 }, (_, i) => (i + 1) * 10),
  500, 600, 700, 800, 1000, 1200, 1500, 2000, 2500, 3000, 4000,
];

export function nextZoomStop(z, dir) {
  const pct = z * 100;
  const eps = 0.01;
  if (dir > 0) {
    const s = ZOOM_STOPS.find((v) => v > pct + eps);
    return (s ?? ZOOM_STOPS[ZOOM_STOPS.length - 1]) / 100;
  }
  const below = ZOOM_STOPS.filter((v) => v < pct - eps);
  return (below.length ? below[below.length - 1] : ZOOM_STOPS[0]) / 100;
}

export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.z = 1;
    this.tx = 0;
    this.ty = 0;
    this.tz = 1;
  }

  toWorld(sx, sy) {
    return { x: sx / this.z + this.x, y: sy / this.z + this.y };
  }

  toScreen(wx, wy) {
    return { x: (wx - this.x) * this.z, y: (wy - this.y) * this.z };
  }

  panBy(dx, dy) {
    this.x -= dx / this.z;
    this.y -= dy / this.z;
    this.tx = this.x;
    this.ty = this.y;
  }

  zoomAt(sx, sy, factor, animated = true) {
    const nz = clamp(this.tz * factor, MIN_ZOOM, MAX_ZOOM);
    const wx = sx / this.tz + this.tx;
    const wy = sy / this.tz + this.ty;
    this.tz = nz;
    this.tx = wx - sx / nz;
    this.ty = wy - sy / nz;
    if (!animated) this.snap();
  }

  setZoom(z, sx, sy, animated = true) {
    this.zoomAt(sx, sy, z / this.tz, animated);
  }

  stepZoom(dir, sx, sy) {
    this.setZoom(nextZoomStop(this.tz, dir), sx, sy);
  }

  fitTo(bbox, W, H, padding = 80) {
    if (!bbox || bbox.w === 0 && bbox.h === 0) {
      this.tz = 1;
      this.tx = bbox ? bbox.x - W / 2 : -W / 2;
      this.ty = bbox ? bbox.y - H / 2 : -H / 2;
      return;
    }
    const z = clamp(Math.min((W - padding * 2) / bbox.w, (H - padding * 2) / bbox.h), MIN_ZOOM, 4);
    this.tz = z;
    this.tx = bbox.x + bbox.w / 2 - W / (2 * z);
    this.ty = bbox.y + bbox.h / 2 - H / (2 * z);
  }

  snap() {
    this.x = this.tx;
    this.y = this.ty;
    this.z = this.tz;
  }

  step() {
    const dz = this.tz - this.z;
    const dx = this.tx - this.x;
    const dy = this.ty - this.y;
    const settled = Math.abs(dz) < this.z * 0.0005 && Math.abs(dx) * this.z < 0.05 && Math.abs(dy) * this.z < 0.05;
    if (settled) {
      if (dz === 0 && dx === 0 && dy === 0) return false;
      this.snap();
      return true;
    }
    this.z += dz * 0.28;
    this.x += dx * 0.28;
    this.y += dy * 0.28;
    return true;
  }
}
