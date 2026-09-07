import { state, newId, commit, setSelection, selectedElements } from './store.js';
import { translateElement } from './geometry.js';
import { ensureAssets } from './images.js';

const PREFIX = 'HONAMA_CLIP:';
let internal = null;

function serializeSelection() {
  const els = selectedElements();
  const assets = {};
  for (const el of els) {
    if (el.type === 'image' && state.assets[el.assetId]) assets[el.assetId] = { src: state.assets[el.assetId].src };
  }
  return { elements: JSON.parse(JSON.stringify(els)), assets };
}

export async function copySelection() {
  if (!state.selection.size) return false;
  internal = serializeSelection();
  try {
    await navigator.clipboard.writeText(PREFIX + JSON.stringify(internal));
  } catch {
    /* clipboard write can fail without permission; internal copy still works */
  }
  return true;
}

export async function pasteElements(app, payload, offset) {
  const data = payload || internal;
  if (!data || !data.elements?.length) return false;
  for (const [id, a] of Object.entries(data.assets || {})) {
    if (!state.assets[id]) state.assets[id] = { src: a.src, img: null };
  }
  const dx = offset?.x ?? 24 / app.camera.z;
  const dy = offset?.y ?? 24 / app.camera.z;
  const ids = [];
  for (const raw of data.elements) {
    const el = JSON.parse(JSON.stringify(raw));
    el.id = newId();
    translateElement(el, dx, dy);
    state.elements.push(el);
    ids.push(el.id);
  }
  await ensureAssets();
  commit();
  setSelection(ids);
  return true;
}

export function duplicateSelection(app) {
  if (!state.selection.size) return;
  const data = serializeSelection();
  pasteElements(app, data, { x: 16 / app.camera.z, y: 16 / app.camera.z });
}

export function parseClipText(text) {
  if (!text || !text.startsWith(PREFIX)) return null;
  try {
    return JSON.parse(text.slice(PREFIX.length));
  } catch {
    return null;
  }
}
