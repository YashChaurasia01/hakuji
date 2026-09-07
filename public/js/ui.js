import {
  state, on, emit, commit, touch, persist, setTool, setSelection, selectedElements, canUndo, canRedo,
  FONT_FAMILIES, PRESET_COLORS, DEFAULT_SHORTCUTS, ACTION_GROUPS, ACTION_LABELS, removeElements, newId,
} from './store.js';
import { icon, iconSvg } from './icons.js';
import { formatCombo, comboFromEvent, runAction } from './keyboard.js';
import { refitText } from './render.js';
import { CANDLE_PATTERNS, insertPattern, defaultWicks } from './candles.js';
import { importImageFile } from './images.js';
import { exportBoard, renderToCanvas, copyCanvasToClipboard } from './export.js';
import { duplicateSelection, parseClipText, pasteElements } from './clipboard.js';

const $ = (sel, root = document) => root.querySelector(sel);

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

const TOOLS = [
  { id: 'select', name: 'Select' },
  { id: 'hand', name: 'Hand' },
  { id: 'pen', name: 'Pen' },
  { id: 'highlighter', name: 'Highlighter' },
  { id: 'eraser', name: 'Eraser' },
  { id: 'shape', name: 'Shapes', sub: true },
  { id: 'text', name: 'Text' },
  { id: 'candle', name: 'Candle', sub: true },
  { id: 'image', name: 'Image' },
];

const SHAPE_KINDS = [
  { id: 'rect', name: 'Rectangle' }, { id: 'ellipse', name: 'Ellipse' }, { id: 'triangle', name: 'Triangle' },
  { id: 'diamond', name: 'Diamond' }, { id: 'polygon', name: 'Polygon' }, { id: 'star', name: 'Star' },
  { id: 'line', name: 'Line' }, { id: 'arrow', name: 'Arrow' }, { id: 'connector', name: 'Connector' },
];

const SUPPORTS = {
  stroke: new Set(['color', 'size', 'opacity']),
  shape: new Set(['color', 'size', 'opacity', 'fill', 'sides', 'points', 'radius', 'kind']),
  text: new Set(['color', 'opacity', 'fontFamily', 'fontSize', 'bold', 'italic', 'underline', 'align', 'valign', 'bg', 'radius', 'padding', 'lineHeight', 'letterSpacing', 'borderColor', 'borderWidth']),
  image: new Set(['opacity', 'radius']),
  candle: new Set(['opacity', 'bullColor', 'bearColor', 'wickWidth']),
};

export function initUI(app) {
  const tooltip = $('#tooltip');
  const popRoot = $('#popover-root');
  const panel = $('#style-panel');
  const subbar = $('#subbar');
  const toolbar = $('#toolbar');

  /* ---------- helpers exposed on app.ui ---------- */
  const ui = {
    toast(msg, ms = 1800) {
      const t = h('div', { class: 'toast' }, msg);
      $('#toasts').append(t);
      setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
    },
    closePopovers() {
      popRoot.innerHTML = '';
      document.querySelectorAll('.icon-btn.open').forEach((b) => b.classList.remove('open'));
    },
    pickImage() {
      $('#image-input').click();
    },
    openExport() { openExportDialog(); },
    openShortcuts() { openShortcutsDialog(); },
    openSettings() { openSettingsDialog(); },
    refreshPanel: renderPanel,
    updateZoom() {
      $('#zoom-value').textContent = `${Math.round(app.camera.tz * 100)}%`;
    },
  };
  app.ui = ui;

  /* ---------- icon fill for static buttons ---------- */
  const staticIcons = {
    '#menu-btn': 'menu', '#board-btn': 'grid', '#shortcuts-btn': 'keyboard', '#export-btn': 'download',
    '#undo-btn': 'undo', '#redo-btn': 'redo', '#zoom-out-btn': 'zoomOut', '#zoom-in-btn': 'zoomIn', '#zoom-fit-btn': 'fit',
  };
  for (const [sel, name] of Object.entries(staticIcons)) $(sel).append(icon(name));
  document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = iconSvg(el.dataset.icon, 16); });
  document.querySelectorAll('[data-close]').forEach((b) => {
    if (!b.textContent.trim()) b.append(icon('x'));
    b.addEventListener('click', () => b.closest('dialog').close());
  });

  /* ---------- toolbar ---------- */
  for (const t of TOOLS) {
    const b = h('button', {
      class: 'icon-btn', 'data-tool': t.id, 'data-tip': t.name, 'data-action': t.id, 'aria-label': t.name,
      onclick: () => { if (t.id === 'image') ui.pickImage(); else setTool(t.id); },
    }, icon(t.id));
    if (t.sub) b.append(h('span', { class: 'sub-dot' }));
    toolbar.append(b);
  }

  function syncTool() {
    toolbar.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === state.tool));
    app.canvas.className = `tool-${state.tool}`;
    renderSubbar();
    renderPanel();
  }

  /* ---------- sub toolbar ---------- */
  function renderSubbar() {
    subbar.innerHTML = '';
    if (state.tool === 'shape') {
      subbar.hidden = false;
      for (const k of SHAPE_KINDS) {
        subbar.append(h('button', {
          class: `icon-btn${state.style.shapeKind === k.id ? ' active' : ''}`, 'data-tip': k.name, 'aria-label': k.name,
          onclick: () => { state.style.shapeKind = k.id; renderSubbar(); renderPanel(); },
        }, icon(k.id)));
      }
    } else if (state.tool === 'candle') {
      subbar.hidden = false;
      subbar.append(h('span', { class: 'label-chip' }, 'Patterns'));
      for (const p of CANDLE_PATTERNS) {
        subbar.append(h('button', {
          class: 'btn small', 'data-tip': `Insert ${p.name}`, onclick: () => insertPattern(app, p),
        }, p.name));
      }
    } else {
      subbar.hidden = true;
    }
  }

  /* ---------- tooltips ---------- */
  let tipTimer = null;
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (!t) return;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => showTip(t), 350);
  });
  document.addEventListener('pointerout', (e) => {
    if (e.target.closest?.('[data-tip]')) { clearTimeout(tipTimer); hideTip(); }
  });
  document.addEventListener('pointerdown', () => { clearTimeout(tipTimer); hideTip(); }, true);

  function showTip(el) {
    tooltip.innerHTML = '';
    tooltip.append(document.createTextNode(el.dataset.tip));
    const action = el.dataset.action;
    if (action && state.shortcuts[action]) tooltip.append(h('kbd', {}, formatCombo(state.shortcuts[action])));
    const r = el.getBoundingClientRect();
    tooltip.classList.add('show');
    const tr = tooltip.getBoundingClientRect();
    let x = r.left + r.width / 2;
    let y = r.top - 8;
    let translate = 'translate(-50%, -100%)';
    if (y - tr.height < 4) { y = r.bottom + 8; translate = 'translate(-50%, 0)'; }
    x = Math.min(window.innerWidth - tr.width / 2 - 6, Math.max(tr.width / 2 + 6, x));
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
    tooltip.style.transform = translate;
  }
  function hideTip() { tooltip.classList.remove('show'); }

  /* ---------- popovers ---------- */
  function openPopover(anchor, content, { align = 'right', className = '' } = {}) {
    ui.closePopovers();
    const pop = h('div', { class: `popover ${className}`, role: 'dialog' }, content);
    popRoot.append(pop);
    anchor.classList?.add('open');
    const r = anchor.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    let x;
    let y;
    if (align === 'right') { x = r.right + 8; y = r.top; }
    else if (align === 'below') { x = r.left; y = r.bottom + 8; }
    else if (align === 'below-right') { x = r.right - pr.width; y = r.bottom + 8; }
    x = Math.max(8, Math.min(window.innerWidth - pr.width - 8, x));
    y = Math.max(8, Math.min(window.innerHeight - pr.height - 8, y));
    pop.style.left = `${x}px`;
    pop.style.top = `${y}px`;
    return pop;
  }
  document.addEventListener('pointerdown', (e) => {
    if (!popRoot.children.length) return;
    if (e.target.closest('.popover') || e.target.closest('.open')) return;
    ui.closePopovers();
  });

  /* ---------- color picker ---------- */
  function swatchButton(getColor, onOpen) {
    const b = h('button', { class: 'swatch-btn', 'aria-label': 'Choose colour', onclick: (e) => onOpen(e.currentTarget) }, h('span', { class: 'fill' }));
    const update = () => {
      const c = getColor();
      b.classList.toggle('transparent', !c || c === 'transparent');
      b.querySelector('.fill').style.background = c && c !== 'transparent' ? c : '';
    };
    update();
    b.update = update;
    return b;
  }

  function colorPopover(anchor, current, onPick, { allowTransparent = false } = {}) {
    let value = current;
    const grid = h('div', { class: 'color-grid' });
    const redraw = () => {
      grid.innerHTML = '';
      for (const c of PRESET_COLORS) {
        grid.append(h('button', {
          class: c === value ? 'active' : '', style: `background:${c}`, 'aria-label': c,
          onmouseenter: () => app.textEditor?.previewSelection('color', c),
          onmouseleave: () => app.textEditor?.clearSelectionPreview(),
          onclick: () => pick(c),
        }));
      }
    };
    const saved = h('div', { class: 'color-grid' });
    const redrawSaved = () => {
      saved.innerHTML = '';
      for (const c of state.palette) {
        saved.append(h('button', {
          class: `remove-hover${c === value ? ' active' : ''}`, style: `background:${c}`, 'aria-label': `${c} (click to use, right-click to remove)`,
          onclick: () => pick(c),
          oncontextmenu: (e) => { e.preventDefault(); state.palette = state.palette.filter((x) => x !== c); persist('palette'); redrawSaved(); },
        }));
      }
      saved.append(h('button', {
        class: 'add', 'aria-label': 'Save current colour',
        onclick: () => {
          if (!value || value === 'transparent' || state.palette.includes(value)) return;
          state.palette.push(value);
          if (state.palette.length > 18) state.palette.shift();
          persist('palette');
          redrawSaved();
          ui.toast('Colour saved');
        },
      }, icon('plus', 14)));
    };
    const hex = h('input', { type: 'text', value: value === 'transparent' ? '' : value, placeholder: '#RRGGBB', 'aria-label': 'Hex colour' });
    const native = h('input', { type: 'color', class: 'native-color', value: value && value !== 'transparent' ? value : '#ffffff', 'aria-label': 'Custom colour' });
    native.addEventListener('input', () => pick(native.value, true));
    native.addEventListener('change', () => pick(native.value));
    hex.addEventListener('change', () => {
      let v = hex.value.trim();
      if (!v.startsWith('#')) v = `#${v}`;
      if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) pick(v);
    });

    function pick(c, transient = false) {
      value = c;
      hex.value = c === 'transparent' ? '' : c;
      if (c !== 'transparent') native.value = c.length === 7 ? c : native.value;
      redraw();
      redrawSaved();
      onPick(c, transient);
    }

    redraw();
    redrawSaved();
    const content = [
      h('div', { class: 'pop-label' }, 'Colours'),
      grid,
      h('div', { class: 'pop-label' }, 'Saved'),
      saved,
      h('div', { class: 'pop-label' }, 'Custom'),
      h('div', { class: 'hex-row' }, native, hex, allowTransparent && h('button', {
        class: 'swatch-btn transparent', 'data-tip': 'Transparent', 'aria-label': 'Transparent', onclick: () => pick('transparent'),
      }, h('span', { class: 'fill' }))),
    ];
    openPopover(anchor, content);
  }

  /* ---------- property panel ---------- */
  function styleKey(prop) {
    const sel = selectedElements();
    const tool = state.tool;
    const textCtx = sel.length ? sel.every((e) => e.type === 'text') : tool === 'text';
    if (!sel.length && tool === 'highlighter') {
      if (prop === 'color') return 'highlighterColor';
      if (prop === 'size') return 'highlighterSize';
      if (prop === 'opacity') return 'highlighterOpacity';
    }
    if (!sel.length && tool === 'eraser' && prop === 'size') return 'eraserSize';
    if (textCtx && prop === 'color') return 'textColor';
    if (textCtx && prop === 'radius') return 'textRadius';
    if (prop === 'kind') return 'shapeKind';
    return prop;
  }

  function getProp(prop) {
    if (app.textEditor?.el && app.textEditor.hasSelection() && ['color', 'fontFamily', 'fontSize'].includes(prop)) {
      const marked = app.textEditor.selectionValue(prop);
      if (marked !== undefined) return marked;
    }
    const sel = selectedElements();
    if (sel.length) {
      const el = sel.find((e) => SUPPORTS[e.type]?.has(prop));
      if (el) return el[prop];
    }
    return state.style[styleKey(prop)];
  }

  function setProp(prop, value, transient = false) {
    const textSelection = app.textEditor?.el && app.textEditor.hasSelection() && ['color', 'fontFamily', 'fontSize'].includes(prop);
    if (textSelection) {
      app.textEditor.formatSelection(prop, value);
      if (!transient) commit();
      renderPanel();
      return;
    }
    const sel = selectedElements();
    state.style[styleKey(prop)] = value;
    if (!sel.length) { renderSubbar(); return; }
    for (const el of sel) {
      if (!SUPPORTS[el.type]?.has(prop)) continue;
      el[prop] = value;
      if (el.type === 'text') refitText(el);
    }
    if (app.textEditor.el) app.textEditor.applyStyle();
    transient ? touch() : commit();
  }

  function section(title, ...rows) {
    return h('div', { class: 'section' }, title && h('h3', {}, title), rows);
  }

  function colorRow(label, prop, opts = {}) {
    const sw = swatchButton(() => getProp(prop), (anchor) => {
      colorPopover(anchor, getProp(prop) || 'transparent', (c, transient) => { setProp(prop, c, transient); sw.update(); }, opts);
    });
    return h('div', { class: 'row' }, h('span', { class: 'label' }, label), sw);
  }

  function sliderRow(label, prop, min, max, step = 1, fmt = (v) => v) {
    const val = getProp(prop) ?? min;
    const range = h('input', { type: 'range', min, max, step, value: val, 'aria-label': label });
    const num = h('input', { type: 'number', class: 'num', min, max, step, value: fmt(val), 'aria-label': `${label} value` });
    range.addEventListener('mouseenter', () => {
      if (prop === 'fontSize' && app.textEditor?.hasSelection()) app.textEditor.previewSelection(prop, +range.value);
    });
    range.addEventListener('mousemove', () => {
      if (prop === 'fontSize' && app.textEditor?.hasSelection()) app.textEditor.previewSelection(prop, +range.value);
    });
    range.addEventListener('mouseleave', () => app.textEditor?.clearSelectionPreview());
    range.addEventListener('input', () => { num.value = fmt(+range.value); setProp(prop, +range.value, true); });
    range.addEventListener('change', () => setProp(prop, +range.value));
    num.addEventListener('change', () => {
      const v = Math.min(max, Math.max(min, +num.value || 0));
      range.value = v;
      num.value = fmt(v);
      setProp(prop, v);
    });
    return h('div', { class: 'row' }, h('span', { class: 'label' }, label), h('div', { class: 'slider' }, range, num));
  }

  function segRow(label, prop, options, { toggle = false } = {}) {
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': label });
    const current = getProp(prop);
    for (const o of options) {
      const active = toggle ? !!getProp(o.prop) : current === o.value;
      seg.append(h('button', {
        class: active ? 'active' : '', 'data-tip': o.name, 'aria-label': o.name, 'aria-pressed': active,
        onclick: () => {
          if (toggle) setProp(o.prop, !getProp(o.prop));
          else setProp(prop, o.value);
          renderPanel();
        },
      }, icon(o.icon, 16)));
    }
    return h('div', { class: 'row' }, label && h('span', { class: 'label' }, label), seg);
  }

  function selectRow(label, prop, options) {
    const sel = h('select', { class: 'select', 'aria-label': label });
    const current = getProp(prop);
    for (const o of options) {
      const option = h('option', { value: o.value, selected: o.value === current }, o.label);
      option.addEventListener('mouseenter', () => app.textEditor?.previewSelection(prop, o.value));
      option.addEventListener('mouseleave', () => app.textEditor?.clearSelectionPreview());
      sel.append(option);
    }
    sel.addEventListener('mouseenter', () => {
      if (app.textEditor?.hasSelection()) app.textEditor.previewSelection(prop, sel.value);
    });
    sel.addEventListener('mouseleave', () => app.textEditor?.clearSelectionPreview());
    sel.addEventListener('change', () => setProp(prop, sel.value));
    return h('div', { class: 'section' }, h('span', { class: 'label', style: 'color:var(--muted);font-size:12px' }, label), sel);
  }

  function shapeKindGrid() {
    const grid = h('div', { class: 'shape-grid' });
    const cur = getProp('kind');
    for (const k of SHAPE_KINDS) {
      grid.append(h('button', {
        class: cur === k.id ? 'active' : '', 'data-tip': k.name, 'aria-label': k.name,
        onclick: () => { setProp('kind', k.id); renderPanel(); },
      }, icon(k.id, 18)));
    }
    return grid;
  }

  function renderPanel() {
    const sel = selectedElements();
    const tool = state.tool;
    panel.innerHTML = '';
    const types = new Set(sel.map((e) => e.type));
    const only = (t) => sel.length && types.size === 1 && types.has(t);
    const show = [];

    if (!sel.length && (tool === 'select' || tool === 'hand' || tool === 'image')) {
      panel.hidden = true;
      return;
    }

    if ((!sel.length && (tool === 'pen' || tool === 'highlighter')) || only('stroke')) {
      const hl = sel.length ? sel.every((e) => e.tool === 'highlighter') : tool === 'highlighter';
      show.push(section(hl ? 'Highlighter' : 'Pen',
        colorRow('Colour', 'color'),
        sliderRow('Size', 'size', 1, hl ? 80 : 40),
        sliderRow('Opacity', 'opacity', 0.05, 1, 0.05, (v) => Math.round(v * 100)),
      ));
    } else if (!sel.length && tool === 'eraser') {
      show.push(section('Eraser', sliderRow('Size', 'size', 4, 120)));
    } else if ((!sel.length && tool === 'shape') || only('shape')) {
      const kind = getProp('kind');
      const rows = [shapeKindGrid()];
      if (kind === 'polygon') rows.push(sliderRow('Sides', 'sides', 3, 24));
      if (kind === 'star') rows.push(sliderRow('Points', 'points', 3, 20));
      if (kind === 'rect') rows.push(sliderRow('Corner radius', 'radius', 0, 200));
      show.push(section('Shape', ...rows));
      show.push(section('Style',
        colorRow('Stroke', 'color'),
        !['line', 'arrow', 'connector'].includes(kind) && colorRow('Fill', 'fill', { allowTransparent: true }),
        sliderRow('Stroke width', 'size', 0, 40),
        sliderRow('Opacity', 'opacity', 0.05, 1, 0.05, (v) => Math.round(v * 100)),
      ));
    } else if ((!sel.length && tool === 'text') || only('text')) {
      show.push(section('Text',
        selectRow('Font', 'fontFamily', FONT_FAMILIES),
        sliderRow('Size', 'fontSize', 8, 200),
        segRow('Style', null, [
          { prop: 'bold', name: 'Bold', icon: 'bold' }, { prop: 'italic', name: 'Italic', icon: 'italic' }, { prop: 'underline', name: 'Underline', icon: 'underline' },
        ], { toggle: true }),
        segRow('Align', 'align', [
          { value: 'left', name: 'Align left', icon: 'alignLeft' }, { value: 'center', name: 'Align centre', icon: 'alignCenter' }, { value: 'right', name: 'Align right', icon: 'alignRight' },
        ]),
        segRow('Vertical', 'valign', [
          { value: 'top', name: 'Top', icon: 'alignTop' }, { value: 'middle', name: 'Middle', icon: 'alignMiddle' }, { value: 'bottom', name: 'Bottom', icon: 'alignBottom' },
        ]),
        sliderRow('Line height', 'lineHeight', 0.8, 3, 0.05),
        sliderRow('Letter spacing', 'letterSpacing', -5, 30, 0.5),
      ));
      show.push(section('Box',
        colorRow('Text colour', 'color'),
        colorRow('Background', 'bg', { allowTransparent: true }),
        colorRow('Border', 'borderColor', { allowTransparent: true }),
        sliderRow('Border width', 'borderWidth', 0, 20),
        sliderRow('Corner radius', 'radius', 0, 120),
        sliderRow('Padding', 'padding', 0, 80),
        sliderRow('Opacity', 'opacity', 0.05, 1, 0.05, (v) => Math.round(v * 100)),
      ));
    } else if ((!sel.length && tool === 'candle') || only('candle')) {
      show.push(section('Candle',
        colorRow('Bullish', 'bullColor'),
        colorRow('Bearish', 'bearColor'),
        sliderRow('Wick width', 'wickWidth', 1, 8),
        sliderRow('Opacity', 'opacity', 0.05, 1, 0.05, (v) => Math.round(v * 100)),
        sel.length > 0 && h('div', { class: 'actions' }, h('button', {
          class: 'btn full', onclick: () => { sel.forEach(defaultWicks); commit(); },
        }, icon('reset', 14), 'Reset wicks')),
        !sel.length && h('p', { class: 'hint' }, 'Left-drag draws a candle: up for bullish, down for bearish. The last candle stays editable — drag its O, C, H, L handles. Right-click any candle to edit it.'),
      ));
    } else if (only('image')) {
      show.push(section('Image',
        sliderRow('Corner radius', 'radius', 0, 300),
        sliderRow('Opacity', 'opacity', 0.05, 1, 0.05, (v) => Math.round(v * 100)),
      ));
    } else if (sel.length) {
      show.push(section(`${sel.length} items`,
        sliderRow('Opacity', 'opacity', 0.05, 1, 0.05, (v) => Math.round(v * 100)),
      ));
    }

    if (sel.length) {
      show.push(section('Arrange',
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onclick: () => runAction(app, 'bringForward') }, icon('bringForward', 14), 'Forward'),
          h('button', { class: 'btn', onclick: () => runAction(app, 'sendBackward') }, icon('sendBackward', 14), 'Backward'),
          h('button', { class: 'btn', onclick: () => duplicateSelection(app) }, icon('duplicate', 14), 'Duplicate'),
          h('button', { class: 'btn', onclick: () => runAction(app, 'copyImage') }, icon('clipboard', 14), 'Copy PNG'),
          h('button', { class: 'btn full danger', onclick: () => runAction(app, 'delete') }, icon('trash', 14), 'Delete'),
        ),
      ));
    }

    panel.hidden = false;
    panel.append(...show.filter(Boolean));
  }

  /* ---------- board settings popover ---------- */
  $('#board-btn').addEventListener('click', (e) => {
    const b = state.board;
    const save = (transient = false) => { if (!transient) { persist('board'); emit('board'); } app.requestRender(); };
    const bgSw = swatchButton(() => b.bg, (anchor) => colorPopover(anchor, b.bg, (c, t) => { b.bg = c; bgSw.update(); save(t); }));
    const pSw = swatchButton(() => b.patternColor, (anchor) => colorPopover(anchor, b.patternColor, (c, t) => { b.patternColor = c; pSw.update(); save(t); }));
    const patterns = [
      { id: 'none', name: 'Plain', icon: 'none' }, { id: 'lines', name: 'Ruled', icon: 'lines' },
      { id: 'dots', name: 'Dotted', icon: 'dots' }, { id: 'grid', name: 'Squared', icon: 'grid' },
    ];
    const seg = h('div', { class: 'seg wide', role: 'group', 'aria-label': 'Pattern' });
    const drawSeg = () => {
      seg.innerHTML = '';
      for (const p of patterns) {
        seg.append(h('button', {
          class: b.pattern === p.id ? 'active' : '', 'data-tip': p.name, 'aria-label': p.name, 'aria-pressed': b.pattern === p.id,
          onclick: () => { b.pattern = p.id; localStorage.setItem('honama.board-pattern-preference', '1'); drawSeg(); save(); },
        }, icon(p.icon, 16)));
      }
    };
    drawSeg();
    const spacing = h('input', { type: 'range', min: 10, max: 160, step: 2, value: b.spacing, 'aria-label': 'Spacing' });
    const spacingVal = h('span', { class: 'value' }, b.spacing);
    spacing.addEventListener('input', () => { b.spacing = +spacing.value; spacingVal.textContent = b.spacing; save(true); });
    spacing.addEventListener('change', () => save());
    const content = [
      h('div', { class: 'pop-label' }, 'Board'),
      h('div', { class: 'row' }, h('span', { class: 'label' }, 'Background'), bgSw),
      seg,
      h('div', { class: 'row' }, h('span', { class: 'label' }, 'Pattern colour'), pSw),
      h('div', { class: 'row' }, h('span', { class: 'label' }, 'Spacing'), h('div', { class: 'slider' }, spacing, spacingVal)),
    ];
    openPopover(e.currentTarget, content, { align: 'below-right', className: 'board-pop' });
  });

  /* ---------- menu ---------- */
  $('#menu-btn').addEventListener('click', (e) => {
    const item = (name, ic, action, cb, cls = '') => h('button', {
      class: cls, role: 'menuitem', onclick: () => { ui.closePopovers(); cb(); },
    }, icon(ic, 16), name, action && state.shortcuts[action] && h('kbd', {}, formatCombo(state.shortcuts[action])));
    const content = [
      item('Import image', 'image', 'image', () => ui.pickImage()),
      item('Export…', 'download', 'export', () => openExportDialog()),
      item('Select all', 'selectAll', 'selectAll', () => runAction(app, 'selectAll')),
      h('div', { class: 'sep' }),
      item('Board background', 'grid', null, () => $('#board-btn').click()),
      item('Keyboard shortcuts', 'keyboard', null, () => openShortcutsDialog()),
      item('Settings', 'settings', null, () => openSettingsDialog()),
      h('div', { class: 'sep' }),
      item('Play with friends', 'users', null, () => openFriendsDialog()),
      h('div', { class: 'sep' }),
      item('Founder', 'founder', null, () => window.open('https://yashexe.vercel.app', '_blank')),
      item('Clear board', 'trash', null, () => {
        if (!state.elements.length) return;
        if (confirm('Clear the whole board? You can undo this.')) {
          removeElements(state.elements.map((el) => el.id));
          commit();
          emit('selection');
        }
      }, 'danger'),
    ];
    openPopover(e.currentTarget, content, { align: 'below', className: 'menu' });
  });

  $('#shortcuts-btn').addEventListener('click', openShortcutsDialog);
  $('#export-btn').addEventListener('click', openExportDialog);
  $('#friends-btn').addEventListener('click', openFriendsDialog);

  /* ---------- history / zoom bars ---------- */
  $('#undo-btn').addEventListener('click', () => runAction(app, 'undo'));
  $('#redo-btn').addEventListener('click', () => runAction(app, 'redo'));
  $('#zoom-in-btn').addEventListener('click', () => runAction(app, 'zoomIn'));
  $('#zoom-out-btn').addEventListener('click', () => runAction(app, 'zoomOut'));
  $('#zoom-value').addEventListener('click', () => runAction(app, 'zoomReset'));
  $('#zoom-fit-btn').addEventListener('click', () => runAction(app, 'zoomFit'));
  function syncHistory() {
    $('#undo-btn').disabled = !canUndo();
    $('#redo-btn').disabled = !canRedo();
  }

  /* ---------- image input ---------- */
  $('#image-input').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    for (const f of files) await importImageFile(app, f);
    e.target.value = '';
  });

  /* ---------- export dialog ---------- */
  const exportDialog = $('#export-dialog');
  function openExportDialog() {
    const hasSel = state.selection.size > 0;
    const selRadio = exportDialog.querySelector('input[name="scope"][value="selection"]');
    selRadio.disabled = !hasSel;
    selRadio.parentElement.style.opacity = hasSel ? '1' : '0.4';
    if (hasSel) selRadio.checked = true;
    else exportDialog.querySelector('input[name="scope"][value="all"]').checked = true;
    exportDialog.showModal();
  }
  const exportOpts = () => {
    const v = (n) => exportDialog.querySelector(`input[name="${n}"]:checked`)?.value;
    const elements = v('scope') === 'selection' ? selectedElements() : state.elements;
    return { format: v('fmt'), elements, background: v('bg') === 'board', scale: +v('scale') };
  };
  $('#export-download').addEventListener('click', async () => {
    const o = exportOpts();
    if (!o.elements.length) { ui.toast('Nothing to export'); return; }
    try {
      await exportBoard(o);
      exportDialog.close();
    } catch (err) {
      ui.toast(err.message || 'Export failed');
    }
  });
  $('#export-copy').addEventListener('click', async () => {
    const o = exportOpts();
    if (!o.elements.length) { ui.toast('Nothing to copy'); return; }
    try {
      await copyCanvasToClipboard(renderToCanvas(o.elements, { scale: o.scale, background: o.background }));
      ui.toast('Copied image to clipboard');
      exportDialog.close();
    } catch {
      ui.toast('Clipboard blocked by browser');
    }
  });

  /* ---------- shortcuts dialog ---------- */
  const shortcutsDialog = $('#shortcuts-dialog');
  function renderShortcutList() {
    const list = $('#shortcut-list');
    list.innerHTML = '';
    for (const g of ACTION_GROUPS) {
      list.append(h('div', { class: 'shortcut-group' }, g.title));
      for (const [action, name] of Object.entries(g.actions)) {
        const key = h('button', { class: 'key', 'aria-label': `Change shortcut for ${name}` }, formatCombo(state.shortcuts[action]));
        key.addEventListener('click', () => listenForKey(key, action));
        list.append(h('div', { class: 'shortcut-row' }, h('span', { class: 'name' }, name), key));
      }
    }
  }
  function listenForKey(btn, action) {
    btn.classList.add('listening');
    btn.textContent = 'Press keys…';
    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const combo = comboFromEvent(e);
      if (!combo) return;
      window.removeEventListener('keydown', handler, true);
      if (combo === 'escape' && action !== 'escape') { renderShortcutList(); return; }
      for (const [a, k] of Object.entries(state.shortcuts)) if (k === combo && a !== action) state.shortcuts[a] = '';
      state.shortcuts[action] = combo;
      persist('shortcuts');
      renderShortcutList();
      ui.toast(`${ACTION_LABELS[action]} → ${formatCombo(combo)}`);
    };
    window.addEventListener('keydown', handler, true);
  }
  $('#shortcuts-reset').addEventListener('click', () => {
    state.shortcuts = { ...DEFAULT_SHORTCUTS };
    persist('shortcuts');
    renderShortcutList();
  });
  function openShortcutsDialog() { renderShortcutList(); shortcutsDialog.showModal(); }

  /* ---------- settings dialog ---------- */
  const settingsDialog = $('#settings-dialog');
  function openSettingsDialog() {
    const body = $('#settings-body');
    body.innerHTML = '';
    const s = state.settings;
    const toggle = (title, desc, key) => {
      const sw = h('button', { class: `switch${s[key] ? ' on' : ''}`, role: 'switch', 'aria-checked': !!s[key], 'aria-label': title });
      sw.addEventListener('click', () => { s[key] = !s[key]; sw.classList.toggle('on', s[key]); sw.setAttribute('aria-checked', s[key]); persist('settings'); });
      return h('div', { class: 'setting-row' }, h('div', {}, h('div', { class: 'title' }, title), h('div', { class: 'desc' }, desc)), sw);
    };
    const slider = (title, desc, key, min, max, step) => {
      const r = h('input', { type: 'range', min, max, step, value: s[key], 'aria-label': title, style: 'width:120px' });
      r.addEventListener('input', () => { s[key] = +r.value; });
      r.addEventListener('change', () => persist('settings'));
      return h('div', { class: 'setting-row' }, h('div', {}, h('div', { class: 'title' }, title), h('div', { class: 'desc' }, desc)), r);
    };
    body.append(
      toggle('Scroll to zoom', 'Off: scroll pans, Ctrl/⌘ + scroll zooms', 'wheelZoom'),
      slider('Zoom sensitivity', 'How fast the wheel zooms', 'zoomSensitivity', 0.3, 2.5, 0.1),
      toggle('Shape snapping', 'Hold the pen still for a second to convert a rough sketch into a clean shape', 'shapeSnap'),
      toggle('Pen pressure', 'Vary stroke width with stylus pressure', 'pressure'),
      slider('Stroke smoothing', 'Higher values give calmer, rounder lines', 'smoothing', 0, 0.9, 0.05),
    );
    settingsDialog.showModal();
  }

  /* ---------- friends dialog (phase 2) ---------- */
  function openFriendsDialog() {
    app.ui.openRoom?.();
  }

  /* ---------- paste ---------- */
  document.addEventListener('paste', async (e) => {
    const t = e.target;
    if (t && t.matches && t.matches('input, textarea')) return;
    const items = [...(e.clipboardData?.items || [])];
    const imgItem = items.find((i) => i.type.startsWith('image/'));
    if (imgItem) {
      e.preventDefault();
      await importImageFile(app, imgItem.getAsFile());
      return;
    }
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    const payload = parseClipText(text);
    if (payload) { await pasteElements(app, payload); return; }
    if (await pasteElements(app)) return;
    // plain text → text element
    const c = app.viewCenter();
    const s = state.style;
    const el = {
      id: newId(),
      type: 'text', x: c.x - 140, y: c.y, w: 280, h: 0, minH: 0, text: text.slice(0, 5000),
      fontFamily: s.fontFamily, fontSize: s.fontSize, bold: s.bold, italic: s.italic, underline: s.underline,
      align: s.align, valign: s.valign, color: s.textColor, bg: s.bg, radius: s.textRadius, padding: s.padding,
      lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, borderColor: s.borderColor, borderWidth: s.borderWidth,
      rotation: 0, opacity: 1,
    };
    refitText(el);
    el.y -= el.h / 2;
    state.elements.push(el);
    commit();
    setSelection([el.id]);
    setTool('select');
  });

  /* ---------- subscriptions ---------- */
  on('tool', syncTool);
  on('selection', renderPanel);
  on('history', syncHistory);
  on('change', () => { if (app.textEditor.el) app.textEditor.applyStyle(); });
  syncTool();
  syncHistory();
  ui.updateZoom();
}
