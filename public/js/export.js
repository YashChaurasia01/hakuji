import { state } from './store.js';
import {
  bboxOfElements, getOutline, smoothPathData, shapeLocalPolygon, linePointsLocal, isLine, CANDLE_W, elementBounds,
} from './geometry.js';
import { drawElement, drawBackgroundWorld, layoutText, fontString, candleIsBull } from './render.js';

export function exportBounds(elements, padding = 32) {
  const bb = bboxOfElements(elements);
  if (!bb) return null;
  return { x: bb.x - padding, y: bb.y - padding, w: bb.w + padding * 2, h: bb.h + padding * 2 };
}

export function renderToCanvas(elements, { scale = 2, padding = 32, background = false } = {}) {
  const bb = exportBounds(elements, padding);
  if (!bb) return null;
  const canvas = document.createElement('canvas');
  const maxDim = 8192;
  const s = Math.min(scale, maxDim / Math.max(bb.w, bb.h));
  canvas.width = Math.max(1, Math.round(bb.w * s));
  canvas.height = Math.max(1, Math.round(bb.h * s));
  const ctx = canvas.getContext('2d');
  ctx.scale(s, s);
  ctx.translate(-bb.x, -bb.y);
  if (background) drawBackgroundWorld(ctx, state.board, bb);
  for (const el of elements) drawElement(ctx, el, state.assets);
  return canvas;
}

export function canvasToBlob(canvas, type = 'image/png', quality = 0.95) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function copyCanvasToClipboard(canvas) {
  const blob = await canvasToBlob(canvas, 'image/png');
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('Clipboard images unsupported');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

/* ---------- SVG ---------- */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f = (n) => Number(n.toFixed(2));

export function toSVG(elements, { padding = 32, background = false } = {}) {
  const bb = exportBounds(elements, padding);
  if (!bb) return '';
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${f(bb.w)}" height="${f(bb.h)}" viewBox="${f(bb.x)} ${f(bb.y)} ${f(bb.w)} ${f(bb.h)}">`);
  if (background) out.push(`<rect x="${f(bb.x)}" y="${f(bb.y)}" width="${f(bb.w)}" height="${f(bb.h)}" fill="${state.board.bg}"/>`);
  for (const el of elements) out.push(svgElement(el));
  out.push('</svg>');
  return out.join('\n');
}

function transformAttr(el) {
  if (!el.rotation) return '';
  const b = elementBounds(el);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return ` transform="rotate(${f((el.rotation * 180) / Math.PI)} ${f(cx)} ${f(cy)})"`;
}

function svgElement(el) {
  const op = el.opacity != null && el.opacity < 1 ? ` opacity="${el.opacity}"` : '';
  switch (el.type) {
    case 'stroke': {
      const d = smoothPathData(getOutline(el));
      return `<path d="${d}" fill="${el.color}"${op}/>`;
    }
    case 'shape': {
      const b = elementBounds(el);
      const cx = el.x + el.w / 2;
      const cy = el.y + el.h / 2;
      const stroke = `stroke="${el.color}" stroke-width="${el.size}" stroke-linejoin="round" stroke-linecap="round"`;
      const fill = `fill="${el.fill && el.fill !== 'transparent' ? el.fill : 'none'}"`;
      if (isLine(el)) {
        const pts = linePointsLocal(el).map((p) => `${f(p.x + cx)},${f(p.y + cy)}`).join(' ');
        let head = '';
        if (el.kind !== 'line') {
          const lp = linePointsLocal(el);
          const a = lp[lp.length - 2];
          const b2 = lp[lp.length - 1];
          const ang = Math.atan2(b2.y - a.y, b2.x - a.x);
          const size = Math.max(10, el.size * 3.2);
          const p1 = { x: b2.x - size * Math.cos(ang - Math.PI / 6), y: b2.y - size * Math.sin(ang - Math.PI / 6) };
          const p2 = { x: b2.x - size * Math.cos(ang + Math.PI / 6), y: b2.y - size * Math.sin(ang + Math.PI / 6) };
          head = `<polyline points="${f(p1.x + cx)},${f(p1.y + cy)} ${f(b2.x + cx)},${f(b2.y + cy)} ${f(p2.x + cx)},${f(p2.y + cy)}" fill="none" ${stroke}/>`;
        }
        return `<g${op}${transformAttr(el)}><polyline points="${pts}" fill="none" ${stroke}/>${head}</g>`;
      }
      if (el.kind === 'ellipse') {
        return `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(b.w / 2)}" ry="${f(b.h / 2)}" ${fill} ${stroke}${op}${transformAttr(el)}/>`;
      }
      if (el.kind === 'rect') {
        return `<rect x="${f(b.x)}" y="${f(b.y)}" width="${f(b.w)}" height="${f(b.h)}" rx="${f(el.radius || 0)}" ${fill} ${stroke}${op}${transformAttr(el)}/>`;
      }
      const pts = shapeLocalPolygon(el, b.w, b.h).map((p) => `${f(p.x + cx)},${f(p.y + cy)}`).join(' ');
      return `<polygon points="${pts}" ${fill} ${stroke}${op}${transformAttr(el)}/>`;
    }
    case 'text': {
      const lines = layoutText(el);
      const parts = [`<g${op}${transformAttr(el)}>`];
      if (el.bg && el.bg !== 'transparent') parts.push(`<rect x="${f(el.x)}" y="${f(el.y)}" width="${f(el.w)}" height="${f(el.h)}" rx="${f(el.radius || 0)}" fill="${el.bg}"/>`);
      if (el.borderWidth > 0 && el.borderColor !== 'transparent') parts.push(`<rect x="${f(el.x + el.borderWidth / 2)}" y="${f(el.y + el.borderWidth / 2)}" width="${f(el.w - el.borderWidth)}" height="${f(el.h - el.borderWidth)}" rx="${f(el.radius || 0)}" fill="none" stroke="${el.borderColor}" stroke-width="${el.borderWidth}"/>`);
      const lineH = el.fontSize * el.lineHeight;
      const contentH = lines.length * lineH;
      let top = el.y + el.padding;
      if (el.valign === 'middle') top = el.y + (el.h - contentH) / 2;
      else if (el.valign === 'bottom') top = el.y + el.h - el.padding - contentH;
      const anchor = el.align === 'center' ? 'middle' : el.align === 'right' ? 'end' : 'start';
      const tx = el.align === 'center' ? el.x + el.w / 2 : el.align === 'right' ? el.x + el.w - el.padding : el.x + el.padding;
      const deco = el.underline ? ' text-decoration="underline"' : '';
      parts.push(`<text fill="${el.color}" font-family="${esc(el.fontFamily)}" font-size="${el.fontSize}" font-weight="${el.bold ? 700 : 400}" font-style="${el.italic ? 'italic' : 'normal'}" letter-spacing="${el.letterSpacing || 0}" text-anchor="${anchor}"${deco}>`);
      lines.forEach((line, i) => {
        const y = top + i * lineH + (lineH - el.fontSize) / 2 + el.fontSize * 0.8;
        parts.push(`<tspan x="${f(tx)}" y="${f(y)}">${esc(line) || ' '}</tspan>`);
      });
      parts.push('</text></g>');
      return parts.join('');
    }
    case 'image': {
      const asset = state.assets[el.assetId];
      if (!asset) return '';
      return `<image x="${f(el.x)}" y="${f(el.y)}" width="${f(el.w)}" height="${f(el.h)}" preserveAspectRatio="none" xlink:href="${asset.src}"${op}${transformAttr(el)}/>`;
    }
    case 'candle': {
      const color = candleIsBull(el) ? el.bullColor : el.bearColor;
      const top = Math.min(el.open, el.close);
      const bot = Math.max(el.open, el.close);
      const h = Math.max(1.5, bot - top);
      return `<g${op} fill="${color}" stroke="${color}"><line x1="${f(el.x)}" y1="${f(el.high)}" x2="${f(el.x)}" y2="${f(el.low)}" stroke-width="${el.wickWidth || 2}"/><rect x="${f(el.x - CANDLE_W / 2)}" y="${f(bot - top < 1.5 ? (top + bot) / 2 - 0.75 : top)}" width="${CANDLE_W}" height="${f(h)}" rx="1.5" stroke="none"/></g>`;
    }
    default:
      return '';
  }
}

/* ---------- PDF (single page, JPEG image) ---------- */
export async function toPDF(canvas) {
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  const bin = atob(dataUrl.split(',')[1]);
  const jpg = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) jpg[i] = bin.charCodeAt(i);

  // Fit onto a page in points, capped to A-series-ish size
  const maxPt = 1400;
  const ratio = Math.min(1, maxPt / Math.max(canvas.width, canvas.height));
  const W = canvas.width * ratio;
  const H = canvas.height * ratio;

  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = (data) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const obj = (n, body) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    if (typeof body === 'string') push(body);
    else body();
    push('\nendobj\n');
  };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W.toFixed(2)} ${H.toFixed(2)}] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>`);
  obj(4, () => {
    push(`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);
    push(jpg);
    push('\nendstream');
  });
  const content = `q ${W.toFixed(2)} 0 0 ${H.toFixed(2)} 0 0 cm /Im1 Do Q`;
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);

  const xref = length;
  push('xref\n0 6\n0000000000 65535 f \n');
  for (let i = 1; i <= 5; i++) push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  return new Blob(chunks, { type: 'application/pdf' });
}

/* ---------- high level ---------- */
export async function exportBoard({ format, elements, background, scale, filename = 'honama-board' }) {
  if (!elements.length) throw new Error('Nothing to export');
  if (format === 'svg') {
    const svg = toSVG(elements, { background });
    download(new Blob([svg], { type: 'image/svg+xml' }), `${filename}.svg`);
    return;
  }
  const canvas = renderToCanvas(elements, { scale, background: background || format === 'pdf' });
  if (format === 'pdf') {
    // PDF cannot be transparent: ensure a background layer
    const withBg = background ? canvas : renderToCanvas(elements, { scale, background: true });
    download(await toPDF(withBg), `${filename}.pdf`);
    return;
  }
  const type = format === 'webp' ? 'image/webp' : 'image/png';
  const blob = await canvasToBlob(canvas, type);
  download(blob, `${filename}.${format}`);
}
