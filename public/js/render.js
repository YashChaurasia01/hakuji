import {
  CANDLE_W, elementBounds, elementCorners, bboxOfElements, getOutline, tracePolySmooth,
  shapeLocalPolygon, linePointsLocal, isLine, rotatePoint,
} from './geometry.js';

const measureCtx = document.createElement('canvas').getContext('2d');

export const ACCENT = '#4f8cff';
export const LOCK_COLOR = '#f0b429';

/* ---------- background ---------- */
export function drawBackground(ctx, board, camera, W, H) {
  ctx.fillStyle = board.bg;
  ctx.fillRect(0, 0, W, H);
  if (board.pattern === 'none') return;

  let worldSp = board.spacing;
  while (worldSp * camera.z < 14) worldSp *= 2;
  while (worldSp * camera.z > 260) worldSp /= 2;
  const sp = worldSp * camera.z;

  const startX = (Math.floor(camera.x / worldSp) * worldSp - camera.x) * camera.z;
  const startY = (Math.floor(camera.y / worldSp) * worldSp - camera.y) * camera.z;

  ctx.strokeStyle = board.patternColor;
  ctx.fillStyle = board.patternColor;
  ctx.lineWidth = 1;

  if (board.pattern === 'dots') {
    const r = Math.max(1, Math.min(2, sp / 18));
    ctx.beginPath();
    for (let x = startX; x < W; x += sp) {
      for (let y = startY; y < H; y += sp) {
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
    }
    ctx.fill();
    return;
  }

  ctx.beginPath();
  for (let y = startY; y < H; y += sp) {
    const yy = Math.round(y) + 0.5;
    ctx.moveTo(0, yy);
    ctx.lineTo(W, yy);
  }
  if (board.pattern === 'grid') {
    for (let x = startX; x < W; x += sp) {
      const xx = Math.round(x) + 0.5;
      ctx.moveTo(xx, 0);
      ctx.lineTo(xx, H);
    }
  }
  ctx.stroke();
}

// World-space pattern for exports
export function drawBackgroundWorld(ctx, board, rect) {
  ctx.fillStyle = board.bg;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  if (board.pattern === 'none') return;
  const sp = board.spacing;
  ctx.strokeStyle = board.patternColor;
  ctx.fillStyle = board.patternColor;
  ctx.lineWidth = 1;
  const x0 = Math.floor(rect.x / sp) * sp;
  const y0 = Math.floor(rect.y / sp) * sp;
  ctx.beginPath();
  if (board.pattern === 'dots') {
    for (let x = x0; x < rect.x + rect.w; x += sp) {
      for (let y = y0; y < rect.y + rect.h; y += sp) {
        ctx.moveTo(x + 1.5, y);
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      }
    }
    ctx.fill();
    return;
  }
  for (let y = y0; y < rect.y + rect.h; y += sp) { ctx.moveTo(rect.x, y); ctx.lineTo(rect.x + rect.w, y); }
  if (board.pattern === 'grid') {
    for (let x = x0; x < rect.x + rect.w; x += sp) { ctx.moveTo(x, rect.y); ctx.lineTo(x, rect.y + rect.h); }
  }
  ctx.stroke();
}

/* ---------- text layout ---------- */
export function fontString(el) {
  return `${el.italic ? 'italic ' : ''}${el.bold ? '700' : '400'} ${el.fontSize}px ${el.fontFamily}`;
}

export function layoutText(el) {
  measureCtx.font = fontString(el);
  if ('letterSpacing' in measureCtx) measureCtx.letterSpacing = `${el.letterSpacing || 0}px`;
  const maxW = Math.max(1, el.w - el.padding * 2);
  const lines = [];
  for (const para of (el.text || '').split('\n')) {
    const words = para.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (measureCtx.measureText(test).width <= maxW || !line) {
        if (measureCtx.measureText(test).width > maxW && !line) {
          // break a single long word
          let chunk = '';
          for (const ch of word) {
            if (measureCtx.measureText(chunk + ch).width > maxW && chunk) {
              lines.push(chunk);
              chunk = ch;
            } else chunk += ch;
          }
          line = chunk;
        } else line = test;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function textContentHeight(el, lines) {
  return lines.length * el.fontSize * el.lineHeight + el.padding * 2;
}

export function refitText(el) {
  const lines = layoutText(el);
  el.h = Math.max(el.minH || 0, textContentHeight(el, lines));
  return lines;
}

/* ---------- elements ---------- */
export function drawElement(ctx, el, assets, opts = {}) {
  ctx.save();
  ctx.globalAlpha = el.opacity ?? 1;
  switch (el.type) {
    case 'stroke': drawStroke(ctx, el); break;
    case 'shape': drawShape(ctx, el); break;
    case 'text': drawText(ctx, el, opts); break;
    case 'image': drawImage(ctx, el, assets); break;
    case 'candle': drawCandle(ctx, el); break;
    default: break;
  }
  ctx.restore();
}

function drawStroke(ctx, el) {
  ctx.fillStyle = el.color;
  const poly = getOutline(el);
  ctx.beginPath();
  if (poly.length < 3) return;
  tracePolySmooth(ctx, poly);
  ctx.fill();
}

function pathRoundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  if (rr <= 0) { ctx.rect(x, y, w, h); return; }
  ctx.roundRect(x, y, w, h, rr);
}

function arrowHead(ctx, from, to, size) {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(a - Math.PI / 6), to.y - size * Math.sin(a - Math.PI / 6));
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(a + Math.PI / 6), to.y - size * Math.sin(a + Math.PI / 6));
  ctx.stroke();
}

function drawShape(ctx, el) {
  const b = elementBounds(el);
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  ctx.translate(cx, cy);
  ctx.rotate(el.rotation || 0);
  ctx.lineWidth = el.size;
  ctx.strokeStyle = el.color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (isLine(el)) {
    const pts = linePointsLocal(el);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    if (el.kind !== 'line') {
      const size = Math.max(10, el.size * 3.2);
      arrowHead(ctx, pts[pts.length - 2], pts[pts.length - 1], size);
    }
    return;
  }

  const w = b.w;
  const h = b.h;
  ctx.beginPath();
  if (el.kind === 'ellipse') {
    ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else if (el.kind === 'rect') {
    pathRoundRect(ctx, -w / 2, -h / 2, w, h, el.radius || 0);
  } else {
    const poly = shapeLocalPolygon(el, w, h);
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
    ctx.closePath();
  }
  if (el.fill && el.fill !== 'transparent') {
    ctx.fillStyle = el.fill;
    ctx.fill();
  }
  if (el.size > 0) ctx.stroke();
}

function drawText(ctx, el, opts) {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  ctx.translate(cx, cy);
  ctx.rotate(el.rotation || 0);
  const x = -el.w / 2;
  const y = -el.h / 2;

  if (el.bg && el.bg !== 'transparent') {
    ctx.fillStyle = el.bg;
    ctx.beginPath();
    pathRoundRect(ctx, x, y, el.w, el.h, el.radius || 0);
    ctx.fill();
  }
  if (el.borderWidth > 0 && el.borderColor && el.borderColor !== 'transparent') {
    ctx.strokeStyle = el.borderColor;
    ctx.lineWidth = el.borderWidth;
    ctx.beginPath();
    pathRoundRect(ctx, x + el.borderWidth / 2, y + el.borderWidth / 2, el.w - el.borderWidth, el.h - el.borderWidth, Math.max(0, (el.radius || 0) - el.borderWidth / 2));
    ctx.stroke();
  }
  if (opts.hideText) return;

  const lines = layoutText(el);
  ctx.font = fontString(el);
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${el.letterSpacing || 0}px`;
  ctx.fillStyle = el.color;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = el.align || 'left';

  const markAt = (index) => {
    const preview = el.previewMark;
    if (preview && index >= preview.start && index < preview.end) return { ...el, ...preview };
    const mark = (el.marks || []).find((m) => index >= m.start && index < m.end);
    return mark ? { ...el, ...mark } : el;
  };
  const lineH = el.fontSize * el.lineHeight;
  const contentH = lines.length * lineH;
  let top = y + el.padding;
  if (el.valign === 'middle') top = y + (el.h - contentH) / 2;
  else if (el.valign === 'bottom') top = y + el.h - el.padding - contentH;

  const tx = el.align === 'center' ? 0 : el.align === 'right' ? el.w / 2 - el.padding : x + el.padding;

  let sourceOffset = 0;
  lines.forEach((line, i) => {
    const baseline = top + i * lineH + (lineH - el.fontSize) / 2 + el.fontSize * 0.8;
    const runs = [];
    let run = '';
    let runStyle = null;
    for (let index = 0; index < line.length; index += 1) {
      const style = markAt(sourceOffset + index);
      const key = `${style.color}|${style.fontFamily}|${style.fontSize}`;
      if (run && key !== `${runStyle.color}|${runStyle.fontFamily}|${runStyle.fontSize}`) {
        runs.push({ text: run, style: runStyle });
        run = '';
      }
      runStyle = style;
      run += line[index];
    }
    if (run) runs.push({ text: run, style: runStyle || el });
    const totalWidth = runs.reduce((sum, item) => {
      ctx.font = fontString(item.style);
      return sum + ctx.measureText(item.text).width;
    }, 0);
    let cursor = el.align === 'center' ? -totalWidth / 2 : el.align === 'right' ? tx - totalWidth : tx;
    for (const item of runs) {
      ctx.font = fontString(item.style);
      ctx.fillStyle = item.style.color;
      ctx.fillText(item.text, cursor, baseline);
      if (item.style.underline && item.text) {
        const width = ctx.measureText(item.text).width;
        ctx.fillRect(cursor, baseline + item.style.fontSize * 0.08, width, Math.max(1, item.style.fontSize / 16));
      }
      cursor += ctx.measureText(item.text).width;
    }
    sourceOffset += line.length;
    if (sourceOffset < (el.text || '').length && (el.text || '')[sourceOffset] === '\n') sourceOffset += 1;
  });
}

function drawImage(ctx, el, assets) {
  const asset = assets[el.assetId];
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  ctx.translate(cx, cy);
  ctx.rotate(el.rotation || 0);
  if (el.radius > 0) {
    ctx.beginPath();
    pathRoundRect(ctx, -el.w / 2, -el.h / 2, el.w, el.h, el.radius);
    ctx.clip();
  }
  if (asset?.img?.complete && asset.img.naturalWidth) {
    ctx.drawImage(asset.img, -el.w / 2, -el.h / 2, el.w, el.h);
  } else {
    ctx.fillStyle = '#1c1c20';
    ctx.fillRect(-el.w / 2, -el.h / 2, el.w, el.h);
  }
}

export function candleIsBull(el) {
  return el.close <= el.open;
}

function drawCandle(ctx, el) {
  const bull = candleIsBull(el);
  const color = bull ? el.bullColor : el.bearColor;
  const top = Math.min(el.open, el.close);
  const bot = Math.max(el.open, el.close);
  const bodyH = bot - top;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = el.wickWidth || 2;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(el.x, el.high);
  ctx.lineTo(el.x, top);
  ctx.moveTo(el.x, bot);
  ctx.lineTo(el.x, el.low);
  ctx.stroke();
  if (bodyH < 1.5) {
    ctx.fillRect(el.x - CANDLE_W / 2, (top + bot) / 2 - 0.75, CANDLE_W, 1.5);
  } else {
    ctx.beginPath();
    pathRoundRect(ctx, el.x - CANDLE_W / 2, top, CANDLE_W, bodyH, 1.5);
    ctx.fill();
  }
}

/* ---------- overlay (screen space) ---------- */
export const HANDLE_NAMES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function selectionFrame(sel) {
  if (!sel.length) return null;
  if (sel.length === 1 && sel[0].type !== 'stroke' && sel[0].type !== 'candle') {
    const el = sel[0];
    const b = elementBounds(el);
    return { ...b, rotation: el.rotation || 0, single: el };
  }
  const b = bboxOfElements(sel);
  return { ...b, rotation: 0, single: sel.length === 1 ? sel[0] : null };
}

export function frameHandles(frame, camera) {
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  const local = {
    nw: [frame.x, frame.y], n: [cx, frame.y], ne: [frame.x + frame.w, frame.y], e: [frame.x + frame.w, cy],
    se: [frame.x + frame.w, frame.y + frame.h], s: [cx, frame.y + frame.h], sw: [frame.x, frame.y + frame.h], w: [frame.x, cy],
  };
  const out = {};
  for (const k of HANDLE_NAMES) {
    const p = rotatePoint(local[k][0], local[k][1], cx, cy, frame.rotation);
    out[k] = camera.toScreen(p.x, p.y);
  }
  const n = out.n;
  const c = camera.toScreen(cx, cy);
  const ux = n.x - c.x;
  const uy = n.y - c.y;
  const len = Math.hypot(ux, uy) || 1;
  out.rotate = { x: n.x + (ux / len) * 26, y: n.y + (uy / len) * 26 };
  return out;
}

export function candleHandles(el, camera) {
  const top = Math.min(el.open, el.close);
  const bot = Math.max(el.open, el.close);
  return {
    high: camera.toScreen(el.x, el.high),
    low: camera.toScreen(el.x, el.low),
    open: camera.toScreen(el.x - CANDLE_W / 2, el.open),
    close: camera.toScreen(el.x + CANDLE_W / 2, el.close),
    _top: camera.toScreen(el.x, top),
    _bot: camera.toScreen(el.x, bot),
  };
}

function drawLockBadge(ctx, p) {
  const w = 20;
  const hgt = 18;
  const x = p.x - 2;
  const y = p.y - hgt - 6;
  ctx.beginPath();
  ctx.moveTo(x + 5, y);
  ctx.arcTo(x + w, y, x + w, y + hgt, 5);
  ctx.arcTo(x + w, y + hgt, x, y + hgt, 5);
  ctx.arcTo(x, y + hgt, x, y, 5);
  ctx.arcTo(x, y, x + w, y, 5);
  ctx.closePath();
  ctx.fillStyle = LOCK_COLOR;
  ctx.fill();
  const cx = x + w / 2;
  const cy = y + hgt / 2 + 1;
  ctx.strokeStyle = '#1a1300';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(cx, cy - 3, 3, Math.PI, 0);
  ctx.stroke();
  ctx.fillStyle = '#1a1300';
  ctx.fillRect(cx - 4, cy - 1, 8, 6);
}

export function drawOverlay(ctx, app) {
  const { state, camera } = app;
  const sel = state.elements.filter((e) => state.selection.has(e.id));

  // hover
  if (state.hoverId && !state.selection.has(state.hoverId) && state.tool === 'select') {
    const el = state.elements.find((e) => e.id === state.hoverId);
    if (el) {
      const corners = elementCorners(el).map((p) => camera.toScreen(p.x, p.y));
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // locked hover — tells the user *why* nothing selected
  if (state.hoverLockedId && state.tool === 'select') {
    const el = state.elements.find((e) => e.id === state.hoverLockedId);
    if (el) {
      const corners = elementCorners(el).map((p) => camera.toScreen(p.x, p.y));
      ctx.save();
      ctx.strokeStyle = LOCK_COLOR;
      ctx.lineWidth = 1.25;
      ctx.setLineDash([5, 4]);
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
      drawLockBadge(ctx, corners[0]);
    }
  }

  if (sel.length && state.tool === 'select') {
    if (sel.length === 1 && sel[0].type === 'candle') {
      drawCandleOverlay(ctx, sel[0], camera);
    } else {
      const frame = selectionFrame(sel);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.25;
      if (sel.length > 1) {
        for (const el of sel) {
          const corners = elementCorners(el).map((p) => camera.toScreen(p.x, p.y));
          ctx.globalAlpha = 0.45;
          ctx.beginPath();
          corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
          ctx.closePath();
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
      const cx = frame.x + frame.w / 2;
      const cy = frame.y + frame.h / 2;
      const corners = [
        [frame.x, frame.y], [frame.x + frame.w, frame.y], [frame.x + frame.w, frame.y + frame.h], [frame.x, frame.y + frame.h],
      ].map(([x, y]) => camera.toScreen(...Object.values(rotatePoint(x, y, cx, cy, frame.rotation))));
      ctx.beginPath();
      corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();

      const handles = frameHandles(frame, camera);
      if (!state.editingId) {
        ctx.beginPath();
        ctx.moveTo(handles.n.x, handles.n.y);
        ctx.lineTo(handles.rotate.x, handles.rotate.y);
        ctx.stroke();
        for (const k of HANDLE_NAMES) {
          const h = handles[k];
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.rect(h.x - 4, h.y - 4, 8, 8);
          ctx.fill();
          ctx.stroke();
        }
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(handles.rotate.x, handles.rotate.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  if (state.marquee) {
    const m = state.marquee;
    ctx.fillStyle = 'rgba(79,140,255,0.12)';
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    ctx.fillRect(m.x, m.y, m.w, m.h);
    ctx.strokeRect(m.x + 0.5, m.y + 0.5, m.w, m.h);
  }

  if (state.tool === 'eraser' && app.pointer) {
    const r = state.style.eraserSize / 2 * camera.z;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(app.pointer.x, app.pointer.y, Math.max(3, r), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  if (state.tool === 'candle') {
    if (state.draft && state.draft.type === 'candle') {
      drawCandleLabels(ctx, state.draft, camera);
    } else if (state.activeCandleId) {
      const active = state.elements.find((e) => e.id === state.activeCandleId);
      if (active) drawCandleOverlay(ctx, active, camera);
    }
  }
}

function drawCandleOverlay(ctx, el, camera) {
  const h = candleHandles(el, camera);
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1.25;
  const corners = elementCorners(el).map((p) => camera.toScreen(p.x, p.y));
  ctx.beginPath();
  corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.globalAlpha = 0.5;
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.fillStyle = '#ffffff';
  for (const k of ['high', 'low']) {
    ctx.beginPath();
    ctx.arc(h[k].x, h[k].y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  for (const k of ['open', 'close']) {
    ctx.beginPath();
    ctx.rect(h[k].x - 4.5, h[k].y - 4.5, 9, 9);
    ctx.fill();
    ctx.stroke();
  }
  drawCandleLabels(ctx, el, camera);
}

function drawCandleLabels(ctx, el, camera) {
  const h = candleHandles(el, camera);
  ctx.font = '600 10px Inter, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(236,236,239,0.9)';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText('H', h.high.x + 10, h.high.y);
  ctx.fillText('L', h.low.x + 10, h.low.y);
  ctx.textAlign = 'right';
  ctx.fillText('O', h.open.x - 10, h.open.y);
  ctx.textAlign = 'left';
  ctx.fillText('C', h.close.x + 10, h.close.y);
}
