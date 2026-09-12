import {
  state, emit, newId, commit, touch, setSelection, selectedElements, setTool,
} from './store.js';
import {
  dist, hitTest, rotatePoint, translateElement, scaleElement, rotateElement,
  recognizeShape, bboxOfElements, rectsIntersect, isLine, normRect, LINE_KINDS,
} from './geometry.js';
import { selectionFrame, frameHandles, candleHandles, HANDLE_NAMES, refitText } from './render.js';
import { makeCandle, defaultWicks } from './candles.js';
import { importImageFile } from './images.js';

const HANDLE_HIT = 8;
const HOLD_MS = 900;
const clone = (o) => JSON.parse(JSON.stringify(o));

const KIND_LABEL = {
  rect: 'rectangle', ellipse: 'circle', triangle: 'triangle', diamond: 'diamond',
  polygon: 'polygon', star: 'star', line: 'line',
};

export function initInput(app) {
  const { canvas, camera } = app;
  let drag = null;
  const touches = new Map();
  let pinch = null;
  let holdTimer = null;
  let holdPos = null;

  app.spaceDown = false;
  app.pointer = null;

  const screenPt = (e) => ({ x: e.clientX, y: e.clientY });
  const pressureOf = (e) => (state.settings.pressure && e.pointerType === 'pen' ? Math.max(0.05, e.pressure) : 0.5);
  const hitTol = () => 6 / camera.z;

  function topHit(wp, includeLocked = false) {
    const tol = hitTol();
    for (let i = state.elements.length - 1; i >= 0; i--) {
      const el = state.elements[i];
      if (!includeLocked && el.locked) continue;
      if (hitTest(el, wp, tol)) return el;
    }
    return null;
  }

  function setCursor(cls) {
    canvas.className = canvas.className.replace(/\bcursor-\S+/g, '').trim();
    if (cls) canvas.classList.add(`cursor-${cls}`);
  }

  /* ---------- hold-to-snap ---------- */
  function armHold(sp) {
    clearTimeout(holdTimer);
    holdPos = sp;
    if (!state.settings.shapeSnap || state.tool !== 'pen') return;
    holdTimer = setTimeout(trySnap, HOLD_MS);
  }

  function trySnap() {
    if (!state.draft || drag?.type !== 'draw' || drag.snapped) return;
    const rec = recognizeShape(state.draft.points);
    if (!rec) return;
    const d = state.draft;
    const shape = {
      id: d.id,
      type: 'shape',
      kind: rec.kind,
      x: rec.x,
      y: rec.y,
      w: rec.w,
      h: rec.h,
      sides: rec.sides || state.style.sides,
      points: rec.points || state.style.points,
      radius: 0,
      color: d.color,
      size: d.size,
      fill: 'transparent',
      opacity: d.opacity,
      rotation: 0,
    };
    state.draft = shape;
    drag.snapped = true;
    app.ui.toast(`Snapped to ${KIND_LABEL[rec.kind] || rec.kind}`);
    app.requestRender();
  }

  /* ---------- pointer down ---------- */
  function onDown(e) {
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, screenPt(e));
      if (touches.size === 2) {
        cancelDrag();
        const [a, b] = [...touches.values()];
        pinch = { dist: dist(a, b), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
        return;
      }
    }
    if (app.textEditor.el) app.textEditor.close();
    app.ui.closePopovers();

    const sp = screenPt(e);
    const wp = camera.toWorld(sp.x, sp.y);

    if (e.button === 1 || app.spaceDown || state.tool === 'hand') {
      drag = { type: 'pan', last: sp };
      canvas.classList.add('grabbing');
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (app.net && !app.net.canEdit()) {
      if (e.button === 0 || e.button === 2) app.ui.toast('You are view-only in this room');
      return;
    }
    if (e.button === 2 && state.tool === 'candle') {
      canvas.setPointerCapture(e.pointerId);
      rightDownCandle(sp, wp);
      app.requestRender();
      return;
    }
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);

    switch (state.tool) {
      case 'select': downSelect(e, sp, wp); break;
      case 'pen':
      case 'highlighter': startStroke(e, sp, wp); break;
      case 'eraser':
        drag = { type: 'erase', removed: false };
        eraseAt(wp);
        break;
      case 'shape': drag = { type: 'shape', start: wp, el: null }; break;
      case 'text': downText(wp); break;
      case 'candle': startCandle(wp, sp); break;
      case 'image': app.ui.pickImage(); break;
      default: break;
    }
    app.requestRender();
  }

  function startStroke(e, sp, wp) {
    const hl = state.tool === 'highlighter';
    const s = state.style;
    state.draft = {
      id: newId(),
      type: 'stroke',
      tool: state.tool,
      points: [{ x: wp.x, y: wp.y, p: pressureOf(e) }],
      color: hl ? s.highlighterColor : s.color,
      size: hl ? s.highlighterSize : s.size,
      opacity: hl ? s.highlighterOpacity : s.opacity,
    };
    drag = { type: 'draw', snapped: false };
    armHold(sp);
  }

  function addStrokePoint(wp, p) {
    const pts = state.draft.points;
    const last = pts[pts.length - 1];
    const k = 1 - state.settings.smoothing * 0.75;
    const nx = last.x + (wp.x - last.x) * k;
    const ny = last.y + (wp.y - last.y) * k;
    if (Math.hypot(nx - last.x, ny - last.y) < 0.6 / camera.z) return;
    pts.push({ x: nx, y: ny, p: last.p + (p - last.p) * 0.5 });
  }

  function eraseAt(wp) {
    const r = state.style.eraserSize / 2 / camera.z;
    const before = state.elements.length;
    state.elements = state.elements.filter((el) => el.locked || !hitTest(el, wp, r));
    if (state.elements.length !== before) {
      drag.removed = true;
      for (const id of [...state.selection]) if (!state.elements.some((el) => el.id === id)) state.selection.delete(id);
      touch();
    }
  }

  function makeShape(start, w, h) {
    const s = state.style;
    return {
      id: newId(),
      type: 'shape',
      kind: s.shapeKind,
      x: start.x,
      y: start.y,
      w,
      h,
      sides: s.sides,
      points: s.points,
      radius: s.radius,
      color: s.color,
      size: s.size,
      fill: s.fill,
      opacity: s.opacity,
      rotation: 0,
    };
  }

  function makeText(wp) {
    const s = state.style;
    const el = {
      id: newId(),
      type: 'text',
      x: wp.x,
      y: wp.y,
      w: 240,
      h: 0,
      minH: 0,
      text: '',
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      bold: s.bold,
      italic: s.italic,
      underline: s.underline,
      align: s.align,
      valign: s.valign,
      color: s.textColor,
      bg: s.bg,
      radius: s.textRadius,
      padding: s.padding,
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing,
      borderColor: s.borderColor,
      borderWidth: s.borderWidth,
      rotation: 0,
      opacity: 1,
    };
    refitText(el);
    el.y -= el.h / 2;
    return el;
  }

  function downText(wp) {
    const hit = topHit(wp);
    if (hit && hit.type === 'text') {
      setSelection([hit.id]);
      setTool('select');
      app.textEditor.open(hit);
      return;
    }
    const el = makeText(wp);
    state.elements.push(el);
    commit();
    setSelection([el.id]);
    setTool('select');
    app.textEditor.open(el);
  }

  function activeCandle() {
    if (!state.activeCandleId) return null;
    const el = state.elements.find((x) => x.id === state.activeCandleId && x.type === 'candle');
    if (!el) state.activeCandleId = null;
    return el || null;
  }

  function startCandle(wp, sp) {
    // Left-click on a handle of the active (just-formed) candle edits it instead of drawing a new one.
    const active = activeCandle();
    if (active) {
      const part = hitCandleHandle(active, sp);
      if (part) {
        drag = { type: 'candle-edit', el: active, part };
        return;
      }
    }
    state.draft = makeCandle(wp.x, wp.y, state.style);
    drag = { type: 'candle' };
  }

  function rightDownCandle(sp, wp) {
    // Right-click: make the candle under the pointer editable; if on a handle, start dragging it now.
    const active = activeCandle();
    if (active) {
      const part = hitCandleHandle(active, sp);
      if (part) {
        drag = { type: 'candle-edit', el: active, part };
        return;
      }
    }
    const hit = topHit(wp);
    if (hit && hit.type === 'candle') {
      state.activeCandleId = hit.id;
      const part = hitCandleHandle(hit, sp);
      if (part) drag = { type: 'candle-edit', el: hit, part };
      return;
    }
    // Right-click on empty space also picks the nearest candle by x if it's close enough.
    const near = nearestCandle(sp);
    state.activeCandleId = near ? near.id : null;
  }

  function nearestCandle(sp) {
    let best = null;
    let bestD = 24;
    for (const el of state.elements) {
      if (el.type !== 'candle') continue;
      const h = candleHandles(el, camera);
      if (sp.y < Math.min(h.high.y, h.low.y) - 12 || sp.y > Math.max(h.high.y, h.low.y) + 12) continue;
      const d = Math.abs(h.high.x - sp.x);
      if (d < bestD) { bestD = d; best = el; }
    }
    return best;
  }

  function downSelect(e, sp, wp) {
    const sel = selectedElements();

    if (sel.length === 1 && sel[0].type === 'candle') {
      const part = hitCandleHandle(sel[0], sp);
      if (part) {
        drag = { type: 'candle-edit', el: sel[0], part };
        return;
      }
    }
    if (sel.length && !(sel.length === 1 && sel[0].type === 'candle')) {
      const frame = selectionFrame(sel);
      const handle = hitHandle(frame, sp);
      if (handle === 'rotate') {
        const c = { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 };
        drag = { type: 'rotate', center: c, startAngle: Math.atan2(wp.y - c.y, wp.x - c.x), origs: cloneMap(sel), frame };
        return;
      }
      if (handle) {
        drag = { type: 'resize', handle, frame, origs: cloneMap(sel) };
        return;
      }
    }

    const el = topHit(wp);
    if (el) {
      if (e.shiftKey) {
        const next = new Set(state.selection);
        next.has(el.id) ? next.delete(el.id) : next.add(el.id);
        setSelection(next);
      } else if (!state.selection.has(el.id)) {
        setSelection([el.id]);
      }
      drag = { type: 'move', start: wp, origs: cloneMap(selectedElements()), moved: false };
    } else {
      if (!e.shiftKey) setSelection([]);
      drag = { type: 'marquee', start: sp, base: new Set(state.selection) };
    }
  }

  function cloneMap(els) {
    const m = {};
    for (const el of els) m[el.id] = clone(el);
    return m;
  }

  function hitHandle(frame, sp) {
    const handles = frameHandles(frame, camera);
    if (dist(handles.rotate, sp) <= HANDLE_HIT) return 'rotate';
    for (const k of HANDLE_NAMES) if (dist(handles[k], sp) <= HANDLE_HIT) return k;
    return null;
  }

  function hitCandleHandle(el, sp) {
    const h = candleHandles(el, camera);
    for (const k of ['high', 'low', 'open', 'close']) if (dist(h[k], sp) <= HANDLE_HIT) return k;
    return null;
  }

  /* ---------- pointer move ---------- */
  function onMove(e) {
    const sp = screenPt(e);
    app.pointer = sp;
    if (app.net) app.net.sendCursor(camera.toWorld(sp.x, sp.y));

    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, sp);
      if (pinch && touches.size === 2) {
        const [a, b] = [...touches.values()];
        const d = dist(a, b);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        camera.zoomAt(mid.x, mid.y, d / pinch.dist, false);
        camera.panBy(mid.x - pinch.mid.x, mid.y - pinch.mid.y);
        pinch = { dist: d, mid };
        emit('camera');
        app.requestRender();
        return;
      }
    }

    if (!drag) {
      updateHover(sp);
      if (state.tool === 'eraser') app.requestRender();
      return;
    }

    const wp = camera.toWorld(sp.x, sp.y);
    switch (drag.type) {
      case 'pan':
        camera.panBy(sp.x - drag.last.x, sp.y - drag.last.y);
        drag.last = sp;
        emit('camera');
        break;
      case 'draw': {
        if (drag.snapped) break;
        const coalesced = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
        const events = coalesced.length ? coalesced : [e];
        for (const ev of events) addStrokePoint(camera.toWorld(ev.clientX, ev.clientY), pressureOf(ev));
        if (!holdPos || dist(sp, holdPos) > 4) armHold(sp);
        break;
      }
      case 'erase':
        eraseAt(wp);
        break;
      case 'shape': {
        let w = wp.x - drag.start.x;
        let h = wp.y - drag.start.y;
        if (e.shiftKey) {
          const m = Math.max(Math.abs(w), Math.abs(h));
          w = Math.sign(w || 1) * m;
          h = Math.sign(h || 1) * m;
        }
        if (!drag.el) drag.el = makeShape(drag.start, w, h);
        drag.el.w = w;
        drag.el.h = h;
        state.draft = drag.el;
        break;
      }
      case 'candle':
        state.draft.close = wp.y;
        defaultWicks(state.draft);
        break;
      case 'move': {
        const dx = wp.x - drag.start.x;
        const dy = wp.y - drag.start.y;
        if (!drag.moved && Math.hypot(dx, dy) * camera.z < 2) break;
        drag.moved = true;
        for (const el of selectedElements()) {
          Object.assign(el, clone(drag.origs[el.id]));
          translateElement(el, dx, dy);
        }
        touch();
        break;
      }
      case 'marquee': {
        const x = Math.min(sp.x, drag.start.x);
        const y = Math.min(sp.y, drag.start.y);
        const w = Math.abs(sp.x - drag.start.x);
        const h = Math.abs(sp.y - drag.start.y);
        state.marquee = { x, y, w, h };
        const a = camera.toWorld(x, y);
        const b = camera.toWorld(x + w, y + h);
        const rect = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
        const ids = new Set(drag.base);
        for (const el of state.elements) if (!el.locked && rectsIntersect(rect, bboxOfElements([el]))) ids.add(el.id);
        state.selection = ids;
        emit('selection');
        break;
      }
      case 'resize': applyResize(e, wp); break;
      case 'rotate': applyRotate(e, wp); break;
      case 'candle-edit': applyCandleEdit(wp); break;
      default: break;
    }
    if (app.net) app.net.sendDraft();
    app.requestRender();
  }

  function updateHover(sp) {
    if (state.tool === 'candle') {
      if (state.hoverId) { state.hoverId = null; app.requestRender(); }
      const active = activeCandle();
      setCursor(active && hitCandleHandle(active, sp) ? 'ns' : null);
      return;
    }
    if (state.tool !== 'select') {
      if (state.hoverId) { state.hoverId = null; app.requestRender(); }
      if (state.hoverLockedId) { state.hoverLockedId = null; app.requestRender(); }
      return;
    }
    const wp = camera.toWorld(sp.x, sp.y);
    const sel = selectedElements();
    if (sel.length === 1 && sel[0].type === 'candle' && hitCandleHandle(sel[0], sp)) {
      setCursor('ns');
      return;
    }
    if (sel.length && !(sel.length === 1 && sel[0].type === 'candle')) {
      const frame = selectionFrame(sel);
      const h = hitHandle(frame, sp);
      if (h) {
        setCursor(h === 'rotate' ? 'rotate' : cursorForHandle(h, frame.rotation));
        return;
      }
    }
    const el = topHit(wp);
    const id = el ? el.id : null;
    if (id !== state.hoverId) {
      state.hoverId = id;
      app.requestRender();
    }
    if (el) {
      if (state.hoverLockedId) { state.hoverLockedId = null; app.requestRender(); }
      setCursor('move');
      return;
    }
    const lockedEl = topHit(wp, true);
    const lockedId = lockedEl ? lockedEl.id : null;
    if (lockedId !== state.hoverLockedId) {
      state.hoverLockedId = lockedId;
      app.requestRender();
    }
    setCursor(lockedId ? 'locked' : null);
  }

  function cursorForHandle(h, rotation) {
    const base = { n: 90, s: 90, e: 0, w: 0, ne: 45, sw: 45, nw: 135, se: 135 }[h];
    const deg = (((base + (rotation * 180) / Math.PI) % 180) + 180) % 180;
    if (deg < 22.5 || deg >= 157.5) return 'ew';
    if (deg < 67.5) return 'nesw';
    if (deg < 112.5) return 'ns';
    return 'nwse';
  }

  function applyResize(e, wp) {
    const f = drag.frame;
    const c = { x: f.x + f.w / 2, y: f.y + f.h / 2 };
    const lp = rotatePoint(wp.x, wp.y, c.x, c.y, -f.rotation);
    const h = drag.handle;
    const hx = h.includes('e') ? 1 : h.includes('w') ? -1 : 0;
    const hy = h.includes('s') ? 1 : h.includes('n') ? -1 : 0;
    const anchor = {
      x: hx === 1 ? f.x : hx === -1 ? f.x + f.w : c.x,
      y: hy === 1 ? f.y : hy === -1 ? f.y + f.h : c.y,
    };
    const minSize = 4 / camera.z;
    let newW = hx === 0 ? f.w : hx === 1 ? lp.x - f.x : f.x + f.w - lp.x;
    let newH = hy === 0 ? f.h : hy === 1 ? lp.y - f.y : f.y + f.h - lp.y;
    newW = Math.max(newW, minSize);
    newH = Math.max(newH, minSize);
    let sx = f.w > 0 ? newW / f.w : 1;
    let sy = f.h > 0 ? newH / f.h : 1;

    const sel = selectedElements();
    const single = sel.length === 1 ? sel[0] : null;
    const uniform = e.shiftKey || (single && single.type === 'image' && hx && hy);
    if (uniform) {
      const s = hx && hy ? Math.max(sx, sy) : hx ? sx : sy;
      sx = sy = s;
    }
    const corner = !!(hx && hy);
    for (const el of sel) {
      Object.assign(el, clone(drag.origs[el.id]));
      const nc = { x: anchor.x + (c.x - anchor.x) * sx, y: anchor.y + (c.y - anchor.y) * sy };
      const ncw = rotatePoint(nc.x, nc.y, c.x, c.y, f.rotation);
      scaleElement(el, c, sx, sy, { corner, scaleStroke: e.altKey });
      translateElement(el, ncw.x - c.x, ncw.y - c.y);
      if (el.type === 'text') refitText(el);
    }
    touch();
  }

  function applyRotate(e, wp) {
    const c = drag.center;
    let da = Math.atan2(wp.y - c.y, wp.x - c.x) - drag.startAngle;
    if (e.shiftKey) {
      const step = Math.PI / 12;
      const base = drag.frame.rotation || 0;
      da = Math.round((base + da) / step) * step - base;
    }
    for (const el of selectedElements()) {
      Object.assign(el, clone(drag.origs[el.id]));
      rotateElement(el, c.x, c.y, da);
    }
    touch();
  }

  function applyCandleEdit(wp) {
    const el = drag.el;
    const part = drag.part;
    if (part === 'high') el.high = Math.min(wp.y, Math.min(el.open, el.close));
    else if (part === 'low') el.low = Math.max(wp.y, Math.max(el.open, el.close));
    else {
      el[part] = wp.y;
      el.high = Math.min(el.high, Math.min(el.open, el.close));
      el.low = Math.max(el.low, Math.max(el.open, el.close));
    }
    touch();
  }

  /* ---------- pointer up ---------- */
  function onUp(e) {
    if (e.pointerType === 'touch') {
      touches.delete(e.pointerId);
      if (touches.size < 2) pinch = null;
    }
    if (!drag) return;
    clearTimeout(holdTimer);
    const d = drag;
    drag = null;
    canvas.classList.remove('grabbing');

    switch (d.type) {
      case 'draw':
        if (state.draft) {
          const el = state.draft;
          state.draft = null;
          if (el.type === 'shape' && !isLine(el)) Object.assign(el, normRect(el.x, el.y, el.w, el.h));
          state.elements.push(el);
          commit();
        }
        break;
      case 'erase':
        if (d.removed) commit();
        break;
      case 'shape': {
        let el = d.el;
        if (!el || (Math.abs(el.w) * camera.z < 4 && Math.abs(el.h) * camera.z < 4)) {
          const s = state.style.shapeKind;
          const def = 120 / camera.z;
          const straight = s === 'line' || s === 'arrow';
          el = makeShape(d.start, straight ? def * 1.4 : def, straight ? 0 : s === 'connector' ? def * 0.8 : def);
          if (!LINE_KINDS.has(s)) { el.x -= el.w / 2; el.y -= el.h / 2; }
        }
        if (!isLine(el)) Object.assign(el, normRect(el.x, el.y, el.w, el.h));
        state.draft = null;
        state.elements.push(el);
        commit();
        setSelection([el.id]);
        setTool('select');
        break;
      }
      case 'candle':
        if (state.draft) {
          state.elements.push(state.draft);
          state.activeCandleId = state.draft.id;
          state.draft = null;
          commit();
        }
        break;
      case 'move':
        if (d.moved) commit();
        break;
      case 'marquee':
        state.marquee = null;
        break;
      case 'resize':
      case 'rotate':
      case 'candle-edit':
        commit();
        break;
      default:
        break;
    }
    if (app.net) app.net.sendDraft();
    updateHover(screenPt(e));
    app.requestRender();
  }

  function cancelDrag() {
    clearTimeout(holdTimer);
    drag = null;
    state.draft = null;
    state.marquee = null;
    canvas.classList.remove('grabbing');
    if (app.net) app.net.sendDraft();
    app.requestRender();
  }

  /* ---------- wheel ---------- */
  function onWheel(e) {
    e.preventDefault();
    const sp = screenPt(e);
    const mult = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? app.H : 1;
    const dy = e.deltaY * mult;
    const dx = e.deltaX * mult;
    const pinchGesture = e.ctrlKey || e.metaKey;

    if (e.shiftKey && !pinchGesture) {
      camera.panBy(-(dx || dy), 0);
    } else if (e.altKey && !pinchGesture) {
      camera.panBy(0, -dy);
    } else if (pinchGesture || state.settings.wheelZoom) {
      const sens = (pinchGesture ? 0.011 : 0.0022) * state.settings.zoomSensitivity;
      const factor = Math.min(1.45, Math.max(0.69, Math.exp(-dy * sens)));
      camera.zoomAt(sp.x, sp.y, factor);
    } else {
      camera.panBy(-dx, -dy);
    }
    emit('camera');
    app.requestRender();
  }

  function onDblClick(e) {
    if (state.tool !== 'select') return;
    const wp = camera.toWorld(e.clientX, e.clientY);
    const el = topHit(wp);
    if (el && el.type === 'text') {
      setSelection([el.id]);
      app.textEditor.open(el);
    } else if (!el) {
      downText(wp);
    }
  }

  /* ---------- drag & drop images ---------- */
  canvas.addEventListener('dragover', (e) => e.preventDefault());
  canvas.addEventListener('drop', async (e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
    const wp = camera.toWorld(e.clientX, e.clientY);
    for (const f of files) await importImageFile(app, f, wp);
  });

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', () => { if (!drag) { app.pointer = null; app.requestRender(); } });
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', onDblClick);
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (state.tool === 'candle') return; // candle tool keeps its own right-click editing behaviour
    const wp = camera.toWorld(e.clientX, e.clientY);
    const hit = topHit(wp, true);
    app.ui.openContextMenu(e, hit && hit.locked ? hit : null);
  });

  app.cancelDrag = cancelDrag;
}
