import {
  state, emit, commit, undo, redo, setSelection, selectedElements, setTool, removeElements,
} from './store.js';
import { bboxOfElements } from './geometry.js';
import { copySelection, pasteElements, duplicateSelection } from './clipboard.js';
import { renderToCanvas, copyCanvasToClipboard } from './export.js';

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function comboFromEvent(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('mod');
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');
  let k = (e.key || '').toLowerCase();
  if (k === ' ') k = 'space';
  if (k === '+') k = '=';
  if (['control', 'meta', 'shift', 'alt'].includes(k)) return null;
  parts.push(k);
  return parts.join('+');
}

const KEY_LABEL = {
  delete: 'Del', backspace: '⌫', escape: 'Esc', '=': '+', space: 'Space',
  arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', enter: '↵',
};

export function formatCombo(combo) {
  if (!combo) return '—';
  return combo.split('+').map((p) => {
    if (p === 'mod') return isMac ? '⌘' : 'Ctrl';
    if (p === 'shift') return isMac ? '⇧' : 'Shift';
    if (p === 'alt') return isMac ? '⌥' : 'Alt';
    return KEY_LABEL[p] || p.toUpperCase();
  }).join(isMac ? '' : '+');
}

export function actionForCombo(combo) {
  for (const [action, key] of Object.entries(state.shortcuts)) if (key === combo) return action;
  return null;
}

export function initKeyboard(app) {
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && t.matches && t.matches('input, textarea, select, [contenteditable="true"]')) return;
    if (document.querySelector('dialog[open]')) return;

    if (e.key === ' ' && !e.repeat) {
      app.spaceDown = true;
      app.canvas.classList.add('space-pan');
      e.preventDefault();
      return;
    }
    const combo = comboFromEvent(e);
    if (!combo) return;
    let action = actionForCombo(combo);
    if (!action && combo === 'backspace') action = 'delete';
    if (!action) return;
    if (action === 'paste' && combo === 'mod+v') return; // handled by the paste event
    e.preventDefault();
    runAction(app, action);
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') {
      app.spaceDown = false;
      app.canvas.classList.remove('space-pan');
    }
  });

  window.addEventListener('blur', () => {
    app.spaceDown = false;
    app.canvas.classList.remove('space-pan');
  });
}

const EDIT_ACTIONS = new Set(['undo', 'redo', 'delete', 'duplicate', 'paste', 'bringForward', 'sendBackward', 'image']);

export function runAction(app, action) {
  const { camera } = app;
  const cx = app.W / 2;
  const cy = app.H / 2;
  if (EDIT_ACTIONS.has(action) && app.net && !app.net.canEdit()) {
    app.ui.toast('You are view-only in this room');
    return;
  }
  switch (action) {
    case 'select': case 'hand': case 'pen': case 'highlighter': case 'eraser':
    case 'shape': case 'text': case 'candle':
      setTool(action);
      break;
    case 'image':
      app.ui.pickImage();
      break;
    case 'undo': undo(); break;
    case 'redo': redo(); break;
    case 'delete':
      if (state.selection.size) {
        removeElements([...state.selection]);
        commit();
        emit('selection');
      }
      break;
    case 'selectAll':
      setSelection(state.elements.map((e) => e.id));
      if (state.elements.length) setTool('select');
      break;
    case 'duplicate': duplicateSelection(app); break;
    case 'copy': copySelection().then((ok) => ok && app.ui.toast('Copied')); break;
    case 'paste': pasteElements(app); break;
    case 'copyImage': {
      const els = selectedElements();
      if (!els.length) { app.ui.toast('Select something first'); break; }
      const canvas = renderToCanvas(els, { scale: 2, background: false });
      copyCanvasToClipboard(canvas).then(() => app.ui.toast('Copied as image')).catch(() => app.ui.toast('Clipboard blocked by browser'));
      break;
    }
    case 'bringForward': reorder(1); break;
    case 'sendBackward': reorder(-1); break;
    case 'zoomIn': camera.stepZoom(1, cx, cy); emit('camera'); break;
    case 'zoomOut': camera.stepZoom(-1, cx, cy); emit('camera'); break;
    case 'zoomReset': camera.setZoom(1, cx, cy); emit('camera'); break;
    case 'zoomFit': {
      const els = state.selection.size ? selectedElements() : state.elements;
      camera.fitTo(bboxOfElements(els), app.W, app.H);
      emit('camera');
      break;
    }
    case 'export': app.ui.openExport(); break;
    case 'escape':
      if (app.textEditor.el) app.textEditor.close();
      else if (state.selection.size) setSelection([]);
      else if (state.tool !== 'select') setTool('select');
      app.ui.closePopovers();
      break;
    default: break;
  }
  app.requestRender();
}

function reorder(dir) {
  if (!state.selection.size) return;
  const els = state.elements;
  const selected = els.filter((e) => state.selection.has(e.id));
  const rest = els.filter((e) => !state.selection.has(e.id));
  if (dir > 0) {
    // move selected one step above the highest non-selected element that is currently above them
    const maxIdx = Math.max(...selected.map((e) => els.indexOf(e)));
    const nextAbove = els.slice(maxIdx + 1).find((e) => !state.selection.has(e.id));
    const insertAt = nextAbove ? rest.indexOf(nextAbove) + 1 : rest.length;
    rest.splice(insertAt, 0, ...selected);
  } else {
    const minIdx = Math.min(...selected.map((e) => els.indexOf(e)));
    const nextBelow = [...els.slice(0, minIdx)].reverse().find((e) => !state.selection.has(e.id));
    const insertAt = nextBelow ? rest.indexOf(nextBelow) : 0;
    rest.splice(insertAt, 0, ...selected);
  }
  state.elements = rest;
  commit();
}
