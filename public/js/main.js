import { state, on, emit } from './store.js';
import { Camera } from './camera.js';
import { drawBackground, drawElement, drawOverlay } from './render.js';
import { bboxOfElements, rectsIntersect } from './geometry.js';
import { TextEditor } from './text-editor.js';
import { initUI } from './ui.js';
import { initInput } from './tools.js';
import { initKeyboard } from './keyboard.js';
import { initNet } from './net.js';
import { drawRemoteCursors } from './presence.js';
import { initRoomUI } from './room-ui.js';

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const camera = new Camera();

const app = {
  canvas,
  ctx,
  camera,
  state,
  dpr: 1,
  W: 0,
  H: 0,
  requestRender,
  viewCenter: () => camera.toWorld(app.W / 2, app.H / 2),
};

app.textEditor = new TextEditor(app);
initUI(app);
initInput(app);
initKeyboard(app);
initNet(app);
initRoomUI(app);

let dirty = true;
function requestRender() {
  dirty = true;
}

function resize() {
  app.dpr = Math.min(window.devicePixelRatio || 1, 3);
  app.W = window.innerWidth;
  app.H = window.innerHeight;
  canvas.width = Math.round(app.W * app.dpr);
  canvas.height = Math.round(app.H * app.dpr);
  canvas.style.width = `${app.W}px`;
  canvas.style.height = `${app.H}px`;
  requestRender();
}

function render() {
  const { dpr, W, H } = app;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawBackground(ctx, state.board, camera, W, H);

  const view = { x: camera.x, y: camera.y, w: W / camera.z, h: H / camera.z };
  ctx.save();
  ctx.setTransform(camera.z * dpr, 0, 0, camera.z * dpr, -camera.x * camera.z * dpr, -camera.y * camera.z * dpr);
  for (const el of state.elements) {
    const bb = bboxOfElements([el]);
    if (bb && !rectsIntersect(view, { x: bb.x - 4, y: bb.y - 4, w: bb.w + 8, h: bb.h + 8 })) continue;
    drawElement(ctx, el, state.assets, { hideText: el.id === state.editingId });
  }
  if (state.draft) drawElement(ctx, state.draft, state.assets);
  if (app.net) for (const d of app.net.drafts.values()) drawElement(ctx, d, state.assets);
  ctx.restore();

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawOverlay(ctx, app);
  if (app.net) drawRemoteCursors(ctx, app);
}

function frame() {
  if (camera.step()) {
    dirty = true;
    emit('camera');
  }
  if (dirty) {
    dirty = false;
    render();
  }
  requestAnimationFrame(frame);
}

on('change', requestRender);
on('selection', requestRender);
on('net', requestRender);
on('tool', requestRender);
on('camera', () => {
  app.textEditor.sync();
  app.ui.updateZoom();
  requestRender();
});

window.addEventListener('resize', resize);
resize();
camera.x = camera.tx = -app.W / 2;
camera.y = camera.ty = -app.H / 2;
requestAnimationFrame(frame);

window.HONAMA = app;
