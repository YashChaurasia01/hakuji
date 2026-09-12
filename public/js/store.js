const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}

export function emit(event, data) {
  listeners.get(event)?.forEach((fn) => fn(data));
}

// Add custom @font-face families (declared in /css/fonts.css) to this list.
export const FONT_FAMILIES = [
  { label: 'Sans', value: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Mono', value: '"SF Mono", Menlo, Consolas, monospace' },
  { label: 'Rounded', value: '"Trebuchet MS", "Segoe UI", Verdana, sans-serif' },
  { label: 'Handwriting', value: '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive' },
  { label: 'Condensed', value: '"Arial Narrow", "Roboto Condensed", sans-serif' },
];

export const PRESET_COLORS = [
  '#ffffff', '#a1a1aa', '#52525b', '#000000', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#a855f7', '#ec4899',
];

export const DEFAULT_SHORTCUTS = {
  select: 'v',
  hand: 'h',
  pen: 'p',
  highlighter: 'u',
  eraser: 'e',
  shape: 's',
  text: 't',
  candle: 'c',
  image: 'i',
  undo: 'mod+z',
  redo: 'mod+shift+z',
  delete: 'delete',
  selectAll: 'mod+a',
  duplicate: 'mod+d',
  copy: 'mod+c',
  paste: 'mod+v',
  copyImage: 'mod+shift+c',
  bringForward: ']',
  sendBackward: '[',
  zoomIn: '=',
  zoomOut: '-',
  zoomReset: '0',
  zoomFit: '1',
  export: 'mod+e',
  escape: 'escape',
};

export const ACTION_GROUPS = [
  { title: 'Tools', actions: {
    select: 'Select', hand: 'Hand', pen: 'Pen', highlighter: 'Highlighter', eraser: 'Eraser',
    shape: 'Shapes', text: 'Text', candle: 'Candle', image: 'Image',
  } },
  { title: 'Editing', actions: {
    undo: 'Undo', redo: 'Redo', delete: 'Delete', selectAll: 'Select all', duplicate: 'Duplicate',
    copy: 'Copy', paste: 'Paste', copyImage: 'Copy as image', bringForward: 'Bring forward', sendBackward: 'Send backward', escape: 'Deselect / cancel',
  } },
  { title: 'View', actions: {
    zoomIn: 'Zoom in', zoomOut: 'Zoom out', zoomReset: 'Reset zoom', zoomFit: 'Fit to content', export: 'Export',
  } },
];

export const ACTION_LABELS = Object.assign({}, ...ACTION_GROUPS.map((g) => g.actions));

const LS = {
  shortcuts: 'honama.shortcuts',
  palette: 'honama.palette',
  settings: 'honama.settings',
  board: 'honama.board',
};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

function loadArray(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function loadBoard() {
  const fallback = { bg: '#000000', pattern: 'dots', patternColor: '#262626', spacing: 40 };
  try {
    const raw = localStorage.getItem(LS.board);
    if (!raw) return fallback;
    const saved = { ...fallback, ...JSON.parse(raw) };
    // Migrate boards created before dotted became the default, while preserving an explicit user choice.
    if (saved.pattern === 'none' && localStorage.getItem('honama.board-pattern-preference') !== '1') {
      saved.pattern = 'dots';
      localStorage.setItem(LS.board, JSON.stringify(saved));
    }
    return saved;
  } catch {
    return fallback;
  }
}

export const state = {
  elements: [],
  assets: {},
  selection: new Set(),
  tool: 'pen',
  draft: null,
  hoverId: null,
  hoverLockedId: null,
  editingId: null,
  activeCandleId: null,
  marquee: null,
  style: {
    color: '#ffffff',
    size: 4,
    opacity: 1,
    highlighterColor: '#facc15',
    highlighterSize: 20,
    highlighterOpacity: 0.35,
    eraserSize: 24,
    shapeKind: 'rect',
    fill: 'transparent',
    sides: 6,
    points: 5,
    radius: 0,
    fontFamily: FONT_FAMILIES[0].value,
    fontSize: 24,
    bold: false,
    italic: false,
    underline: false,
    align: 'left',
    valign: 'top',
    textColor: '#ffffff',
    bg: 'transparent',
    textRadius: 8,
    padding: 12,
    lineHeight: 1.4,
    letterSpacing: 0,
    borderColor: 'transparent',
    borderWidth: 0,
    bullColor: '#3b82f6',
    bearColor: '#71717a',
    wickWidth: 2,
  },
  board: loadBoard(),
  settings: load(LS.settings, { wheelZoom: true, shapeSnap: true, pressure: true, smoothing: 0.5, zoomSensitivity: 1 }),
  shortcuts: load(LS.shortcuts, DEFAULT_SHORTCUTS),
  palette: loadArray(LS.palette),
};

export function persist(key) {
  try {
    localStorage.setItem(LS[key], JSON.stringify(state[key]));
  } catch {
    /* storage unavailable */
  }
}

let uid = Date.now();
export const newId = () => (uid++).toString(36) + Math.random().toString(36).slice(2, 6);

/* ---------- history ---------- */
const undoStack = [];
const redoStack = [];
let last = '[]';

export function commit() {
  undoStack.push(last);
  if (undoStack.length > 120) undoStack.shift();
  redoStack.length = 0;
  last = JSON.stringify(state.elements);
  emit('change');
  emit('history');
}

export function touch() {
  emit('change');
}

// When collaborating, undo/redo must not revert other people's work. The network layer
// installs a filter that merges a history snapshot with the current foreign elements.
let historyFilter = null;
export function setHistoryFilter(fn) {
  historyFilter = fn;
}

function restore(snapshot) {
  const target = JSON.parse(snapshot);
  state.elements = historyFilter ? historyFilter(target, state.elements) : target;
  last = JSON.stringify(state.elements);
}

export function undo() {
  if (!undoStack.length) return;
  redoStack.push(last);
  restore(undoStack.pop());
  pruneSelection();
  emit('change');
  emit('selection');
  emit('history');
}

export function redo() {
  if (!redoStack.length) return;
  undoStack.push(last);
  restore(redoStack.pop());
  pruneSelection();
  emit('change');
  emit('selection');
  emit('history');
}

// Remote edits become the new baseline without creating a local undo step.
export function setBaseline() {
  last = JSON.stringify(state.elements);
}

export function resetHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
  last = JSON.stringify(state.elements);
  emit('history');
}

export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

export function pruneSelection() {
  const ids = new Set(state.elements.map((e) => e.id));
  for (const id of [...state.selection]) if (!ids.has(id)) state.selection.delete(id);
}

/* ---------- selection / tools ---------- */
export function setSelection(ids) {
  state.selection = new Set(ids);
  emit('selection');
}

export function selectedElements() {
  return state.elements.filter((e) => state.selection.has(e.id));
}

export function setLocked(ids, locked) {
  const set = new Set(ids);
  for (const el of state.elements) if (set.has(el.id)) el.locked = locked;
  commit();
  emit('selection');
}

export function setTool(tool) {
  if (state.tool === tool) return;
  state.tool = tool;
  if (tool !== 'candle') state.activeCandleId = null;
  emit('tool');
}

export function getElement(id) {
  return state.elements.find((e) => e.id === id);
}

export function removeElements(ids) {
  const set = new Set(ids);
  state.elements = state.elements.filter((e) => !set.has(e.id));
  for (const id of set) state.selection.delete(id);
}

function pruneLockedSelection() {
  let changed = false;
  for (const id of [...state.selection]) {
    const el = getElement(id);
    if (el && el.locked) { state.selection.delete(id); changed = true; }
  }
  if (changed) emit('selection');
}
on('change', pruneLockedSelection);