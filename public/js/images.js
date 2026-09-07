import { state, newId, commit, setSelection, setTool } from './store.js';

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export async function addImageFromSrc(app, src, center) {
  const img = await loadImage(src);
  const assetId = newId();
  state.assets[assetId] = { img, src };
  const maxW = Math.min(640, (app.W * 0.6) / app.camera.z);
  const scale = Math.min(1, maxW / img.naturalWidth);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  const el = {
    id: newId(),
    type: 'image',
    assetId,
    x: center.x - w / 2,
    y: center.y - h / 2,
    w,
    h,
    rotation: 0,
    opacity: 1,
    radius: 0,
  };
  state.elements.push(el);
  commit();
  setSelection([el.id]);
  setTool('select');
  return el;
}

export async function importImageFile(app, file, center) {
  if (!file || !file.type.startsWith('image/')) return null;
  const src = await readFileAsDataURL(file);
  return addImageFromSrc(app, src, center || app.viewCenter());
}

// Re-hydrate <img> objects for assets referenced by elements (after paste of a snapshot).
export async function ensureAssets() {
  const jobs = [];
  for (const el of state.elements) {
    if (el.type !== 'image') continue;
    const asset = state.assets[el.assetId];
    if (asset && !asset.img && asset.src) jobs.push(loadImage(asset.src).then((img) => { asset.img = img; }));
  }
  await Promise.all(jobs);
}
