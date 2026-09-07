export const CANDLE_W = 18;
export const LINE_KINDS = new Set(['line', 'arrow', 'connector']);

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function rotatePoint(x, y, cx, cy, a) {
  if (!a) return { x, y };
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dx = x - cx;
  const dy = y - cy;
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
}

export function normRect(x, y, w, h) {
  return { x: w < 0 ? x + w : x, y: h < 0 ? y + h : y, w: Math.abs(w), h: Math.abs(h) };
}

export function inflate(r, d) {
  return { x: r.x - d, y: r.y - d, w: r.w + d * 2, h: r.h + d * 2 };
}

export function boundsOfPoints(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  if (x0 === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export const isLine = (el) => el.type === 'shape' && LINE_KINDS.has(el.kind);

export function elementBounds(el) {
  switch (el.type) {
    case 'stroke':
      return inflate(boundsOfPoints(el.points), el.size / 2);
    case 'shape':
      return isLine(el) ? inflate(normRect(el.x, el.y, el.w, el.h), el.size / 2) : normRect(el.x, el.y, el.w, el.h);
    case 'text':
    case 'image':
      return { x: el.x, y: el.y, w: el.w, h: el.h };
    case 'candle': {
      const top = Math.min(el.high, el.open, el.close);
      const bot = Math.max(el.low, el.open, el.close);
      return { x: el.x - CANDLE_W / 2, y: top, w: CANDLE_W, h: bot - top };
    }
    default:
      return { x: 0, y: 0, w: 0, h: 0 };
  }
}

export function elementCenter(el) {
  const b = elementBounds(el);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

export function elementCorners(el) {
  const b = elementBounds(el);
  const r = el.rotation || 0;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return [
    [b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h],
  ].map(([x, y]) => rotatePoint(x, y, cx, cy, r));
}

export function bboxOfElements(els) {
  if (!els.length) return null;
  const pts = [];
  for (const el of els) pts.push(...elementCorners(el));
  return boundsOfPoints(pts);
}

export function rectsIntersect(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/* ---------- shape polygons (local, centered at 0,0) ---------- */
export function shapeLocalPolygon(el, w, h) {
  const hw = w / 2;
  const hh = h / 2;
  switch (el.kind) {
    case 'rect':
      return [{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }];
    case 'triangle':
      return [{ x: 0, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }];
    case 'diamond':
      return [{ x: 0, y: -hh }, { x: hw, y: 0 }, { x: 0, y: hh }, { x: -hw, y: 0 }];
    case 'polygon': {
      const n = clamp(Math.round(el.sides || 6), 3, 24);
      const pts = [];
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * hw, y: Math.sin(a) * hh });
      }
      return pts;
    }
    case 'star': {
      const n = clamp(Math.round(el.points || 5), 3, 20);
      const inner = 0.45;
      const pts = [];
      for (let i = 0; i < n * 2; i++) {
        const a = -Math.PI / 2 + (i / (n * 2)) * Math.PI * 2;
        const k = i % 2 === 0 ? 1 : inner;
        pts.push({ x: Math.cos(a) * hw * k, y: Math.sin(a) * hh * k });
      }
      return pts;
    }
    case 'ellipse':
    default: {
      const pts = [];
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * hw, y: Math.sin(a) * hh });
      }
      return pts;
    }
  }
}

export function linePointsLocal(el) {
  // Relative to the element center; start = (x,y), end = (x+w, y+h)
  const s = { x: -el.w / 2, y: -el.h / 2 };
  const e = { x: el.w / 2, y: el.h / 2 };
  if (el.kind === 'connector') {
    const mid = (s.x + e.x) / 2;
    return [s, { x: mid, y: s.y }, { x: mid, y: e.y }, e];
  }
  return [s, e];
}

/* ---------- distances / hit-testing ---------- */
export function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = clamp(t, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distToPolyline(p, pts, closed = false) {
  if (pts.length === 1) return dist(p, pts[0]);
  let min = Infinity;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const d = distToSegment(p, pts[i], pts[(i + 1) % pts.length]);
    if (d < min) min = d;
  }
  return min;
}

export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function hitTest(el, p, tol) {
  const r = el.rotation || 0;
  if (el.type === 'stroke') {
    // coarse bbox reject first
    const b = inflate(elementBounds(el), tol);
    if (p.x < b.x || p.x > b.x + b.w || p.y < b.y || p.y > b.y + b.h) return false;
    return distToPolyline(p, el.points, false) <= el.size / 2 + tol;
  }
  const b = elementBounds(el);
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const lp = rotatePoint(p.x, p.y, c.x, c.y, -r);

  if (el.type === 'shape') {
    if (isLine(el)) {
      const pts = linePointsLocal(el).map((q) => ({ x: q.x + c.x, y: q.y + c.y }));
      return distToPolyline(lp, pts, false) <= el.size / 2 + tol;
    }
    const poly = shapeLocalPolygon(el, b.w, b.h).map((q) => ({ x: q.x + c.x, y: q.y + c.y }));
    if (el.fill && el.fill !== 'transparent' && pointInPolygon(lp, poly)) return true;
    return distToPolyline(lp, poly, true) <= el.size / 2 + tol;
  }
  return lp.x >= b.x - tol && lp.x <= b.x + b.w + tol && lp.y >= b.y - tol && lp.y <= b.y + b.h + tol;
}

/* ---------- transforms ---------- */
const outlineCache = new WeakMap();

export function invalidate(el) {
  outlineCache.delete(el);
}

export function translateElement(el, dx, dy) {
  switch (el.type) {
    case 'stroke':
      for (const p of el.points) { p.x += dx; p.y += dy; }
      invalidate(el);
      break;
    case 'candle':
      el.x += dx;
      el.open += dy;
      el.close += dy;
      el.high += dy;
      el.low += dy;
      break;
    default:
      el.x += dx;
      el.y += dy;
  }
}

export function scaleElement(el, anchor, sx, sy, opts = {}) {
  switch (el.type) {
    case 'stroke':
      for (const p of el.points) {
        p.x = anchor.x + (p.x - anchor.x) * sx;
        p.y = anchor.y + (p.y - anchor.y) * sy;
      }
      if (opts.scaleStroke) el.size *= (sx + sy) / 2;
      invalidate(el);
      break;
    case 'candle':
      el.x = anchor.x + (el.x - anchor.x) * sx;
      for (const k of ['open', 'close', 'high', 'low']) el[k] = anchor.y + (el[k] - anchor.y) * sy;
      break;
    case 'text':
      el.x = anchor.x + (el.x - anchor.x) * sx;
      el.y = anchor.y + (el.y - anchor.y) * sy;
      el.w = Math.max(24, el.w * sx);
      if (opts.corner) el.fontSize = Math.max(4, el.fontSize * sy);
      el.minH = Math.max(0, (el.minH || 0) * sy);
      break;
    default:
      el.x = anchor.x + (el.x - anchor.x) * sx;
      el.y = anchor.y + (el.y - anchor.y) * sy;
      el.w *= sx;
      el.h *= sy;
  }
}

export function rotateElement(el, cx, cy, da) {
  if (el.type === 'stroke') {
    for (const p of el.points) {
      const q = rotatePoint(p.x, p.y, cx, cy, da);
      p.x = q.x;
      p.y = q.y;
    }
    invalidate(el);
    return;
  }
  const c = elementCenter(el);
  const nc = rotatePoint(c.x, c.y, cx, cy, da);
  translateElement(el, nc.x - c.x, nc.y - c.y);
  if (el.type !== 'candle') el.rotation = ((el.rotation || 0) + da) % (Math.PI * 2);
}

/* ---------- stroke outline (variable width, smooth) ---------- */
function radiusAt(p, size, usePressure) {
  const pr = usePressure ? (p.p ?? 0.5) : 0.5;
  return (size / 2) * (0.2 + 1.6 * pr);
}

export function getOutline(el) {
  const cached = outlineCache.get(el);
  if (cached && cached.n === el.points.length && cached.size === el.size) return cached.poly;
  const poly = strokeOutline(el.points, el.size, {
    pressure: el.tool !== 'highlighter',
    taper: el.tool !== 'highlighter',
  });
  outlineCache.set(el, { n: el.points.length, size: el.size, poly });
  return poly;
}

export function strokeOutline(points, size, { pressure = true, taper = true } = {}) {
  const n = points.length;
  if (n === 0) return [];
  if (n === 1) {
    const r = radiusAt(points[0], size, pressure);
    const out = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      out.push({ x: points[0].x + Math.cos(a) * r, y: points[0].y + Math.sin(a) * r });
    }
    return out;
  }
  const left = [];
  const right = [];
  let d0 = null;
  let dn = null;
  let r0 = 0;
  let rn = 0;
  const taperLen = Math.min(6, Math.floor(n / 3));
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(n - 1, i + 1)];
    let dx = next.x - prev.x;
    let dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    let r = radiusAt(p, size, pressure);
    if (taper && taperLen > 0) {
      const t = Math.min(1, i / taperLen, (n - 1 - i) / taperLen);
      r *= 0.55 + 0.45 * t;
    }
    if (i === 0) { d0 = { x: dx, y: dy }; r0 = r; }
    if (i === n - 1) { dn = { x: dx, y: dy }; rn = r; }
    left.push({ x: p.x - dy * r, y: p.y + dx * r });
    right.push({ x: p.x + dy * r, y: p.y - dx * r });
  }
  const startCap = { x: points[0].x - d0.x * r0, y: points[0].y - d0.y * r0 };
  const endCap = { x: points[n - 1].x + dn.x * rn, y: points[n - 1].y + dn.y * rn };
  return [startCap, ...left, endCap, ...right.reverse()];
}

export function tracePolySmooth(ctx, pts) {
  const n = pts.length;
  if (n < 3) return;
  let mx = (pts[0].x + pts[1].x) / 2;
  let my = (pts[0].y + pts[1].y) / 2;
  ctx.moveTo(mx, my);
  for (let i = 1; i <= n; i++) {
    const p = pts[i % n];
    const q = pts[(i + 1) % n];
    mx = (p.x + q.x) / 2;
    my = (p.y + q.y) / 2;
    ctx.quadraticCurveTo(p.x, p.y, mx, my);
  }
  ctx.closePath();
}

export function smoothPathData(pts) {
  const n = pts.length;
  if (n < 3) return '';
  let mx = (pts[0].x + pts[1].x) / 2;
  let my = (pts[0].y + pts[1].y) / 2;
  let d = `M${mx.toFixed(2)} ${my.toFixed(2)}`;
  for (let i = 1; i <= n; i++) {
    const p = pts[i % n];
    const q = pts[(i + 1) % n];
    mx = (p.x + q.x) / 2;
    my = (p.y + q.y) / 2;
    d += `Q${p.x.toFixed(2)} ${p.y.toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}`;
  }
  return d + 'Z';
}

/* ---------- simplification & shape recognition ---------- */
export function simplify(points, tol) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(points[i], points[a], points[b]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

const avg = (arr) => arr.reduce((s, v) => s + v, 0) / (arr.length || 1);

export function recognizeShape(points) {
  if (points.length < 8) return null;
  const bb = boundsOfPoints(points);
  const size = Math.max(bb.w, bb.h);
  if (size < 24) return null;

  const first = points[0];
  const last = points[points.length - 1];
  const closed = dist(first, last) < size * 0.3;

  if (!closed) {
    let maxDev = 0;
    for (const p of points) maxDev = Math.max(maxDev, distToSegment(p, first, last));
    if (maxDev < size * 0.09) return { kind: 'line', x: first.x, y: first.y, w: last.x - first.x, h: last.y - first.y };
    return null;
  }

  const simp = simplify(points, size * 0.05);
  const corners = simp.slice();
  if (corners.length > 1 && dist(corners[0], corners[corners.length - 1]) < size * 0.15) corners.pop();
  const n = corners.length;

  const cx = avg(points.map((p) => p.x));
  const cy = avg(points.map((p) => p.y));
  const radii = points.map((p) => Math.hypot(p.x - cx, p.y - cy));
  const mean = avg(radii);
  const sd = Math.sqrt(avg(radii.map((r) => (r - mean) ** 2)));
  const circ = mean ? sd / mean : 1;

  if (n >= 8 && n <= 16 && n % 2 === 0) {
    const cr = corners.map((p) => Math.hypot(p.x - cx, p.y - cy));
    let alternating = true;
    for (let i = 0; i < n; i++) {
      const a = cr[i] - cr[(i + 1) % n];
      const b = cr[(i + 1) % n] - cr[(i + 2) % n];
      if (a * b >= 0) { alternating = false; break; }
    }
    const even = avg(cr.filter((_, i) => i % 2 === 0));
    const odd = avg(cr.filter((_, i) => i % 2 === 1));
    const ratio = Math.max(even, odd) / Math.max(1e-6, Math.min(even, odd));
    if (alternating && ratio > 1.3) return { kind: 'star', points: n / 2, ...bb };
  }

  const nearAny = (p, targets, tol) => targets.some((t) => dist(p, t) < tol);
  if (n === 3 && circ > 0.12) return { kind: 'triangle', ...bb };
  if (n === 4 && circ > 0.08) {
    const bcorners = [
      { x: bb.x, y: bb.y }, { x: bb.x + bb.w, y: bb.y }, { x: bb.x + bb.w, y: bb.y + bb.h }, { x: bb.x, y: bb.y + bb.h },
    ];
    const mids = [
      { x: bb.x + bb.w / 2, y: bb.y }, { x: bb.x + bb.w, y: bb.y + bb.h / 2 }, { x: bb.x + bb.w / 2, y: bb.y + bb.h }, { x: bb.x, y: bb.y + bb.h / 2 },
    ];
    if (corners.every((p) => nearAny(p, bcorners, size * 0.3))) return { kind: 'rect', ...bb };
    if (corners.every((p) => nearAny(p, mids, size * 0.3))) return { kind: 'diamond', ...bb };
    return { kind: 'rect', ...bb };
  }
  if ((n === 5 || n === 6) && circ > 0.045) return { kind: 'polygon', sides: n, ...bb };

  if (Math.abs(bb.w - bb.h) / size < 0.2) {
    const d = (bb.w + bb.h) / 2;
    return { kind: 'ellipse', x: bb.x + (bb.w - d) / 2, y: bb.y + (bb.h - d) / 2, w: d, h: d };
  }
  return { kind: 'ellipse', ...bb };
}
