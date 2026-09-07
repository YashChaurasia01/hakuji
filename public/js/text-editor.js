import { state, commit, touch, emit, removeElements } from './store.js';
import { refitText, layoutText, textContentHeight } from './render.js';

export class TextEditor {
  constructor(app) {
    this.app = app;
    this.layer = document.getElementById('text-layer');
    this.el = null;
    this.ta = null;
  }

  open(el) {
    if (this.el) this.close();
    this.el = el;
    state.editingId = el.id;
    const ta = document.createElement('textarea');
    ta.className = 'text-edit';
    ta.value = el.text || '';
    ta.spellcheck = false;
    ta.setAttribute('aria-label', 'Edit text');
    this.layer.appendChild(ta);
    this.ta = ta;
    this.applyStyle();
    this.sync();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);

    ta.addEventListener('input', () => {
      el.text = ta.value;
      refitText(el);
      touch();
      this.applyStyle();
      this.sync();
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
        return;
      }
      e.stopPropagation();
    });
    ta.addEventListener('pointerdown', (e) => e.stopPropagation());
    emit('selection');
    this.app.requestRender();
  }

  hasSelection() {
    return !!this.ta && this.ta.selectionStart !== this.ta.selectionEnd;
  }

  selectionValue(prop) {
    if (!this.hasSelection()) return undefined;
    const start = this.ta.selectionStart;
    const end = this.ta.selectionEnd;
    const marks = (this.el.marks || []).filter((m) => m.end > start && m.start < end && m[prop] !== undefined);
    if (!marks.length) return undefined;
    const value = marks[marks.length - 1][prop];
    return marks.every((m) => m[prop] === value) ? value : undefined;
  }

  previewSelection(prop, value) {
    if (!this.hasSelection()) return false;
    this.el.previewMark = { start: this.ta.selectionStart, end: this.ta.selectionEnd, [prop]: value };
    this.app.requestRender();
    return true;
  }

  clearSelectionPreview() {
    if (!this.el?.previewMark) return;
    delete this.el.previewMark;
    this.app.requestRender();
  }

  formatSelection(prop, value) {
    if (!this.hasSelection()) return false;
    const start = this.ta.selectionStart;
    const end = this.ta.selectionEnd;
    const old = this.el.marks || [];
    const next = [];
    for (const mark of old) {
      if (mark.end <= start || mark.start >= end) { next.push(mark); continue; }
      if (mark.start < start) next.push({ ...mark, end: start });
      if (mark.end > end) next.push({ ...mark, start: end });
    }
    next.push({ start, end, [prop]: value });
    next.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const mark of next) {
      const previous = merged[merged.length - 1];
      if (previous && previous.end === mark.start && Object.keys(previous).every((key) => key === 'start' || key === 'end' || previous[key] === mark[key]) && Object.keys(mark).every((key) => key === 'start' || key === 'end' || previous[key] === mark[key])) {
        previous.end = mark.end;
      } else merged.push(mark);
    }
    this.el.marks = merged;
    delete this.el.previewMark;
    touch();
    this.app.requestRender();
    return true;
  }

  applyStyle() {
    const { el, ta } = this;
    if (!el || !ta) return;
    const lines = layoutText(el);
    const contentH = lines.length * el.fontSize * el.lineHeight;
    let padTop = el.padding;
    if (el.valign === 'middle') padTop = Math.max(el.padding, (el.h - contentH) / 2);
    else if (el.valign === 'bottom') padTop = Math.max(el.padding, el.h - el.padding - contentH);

    Object.assign(ta.style, {
      width: `${el.w}px`,
      height: `${el.h}px`,
      padding: `${padTop}px ${el.padding}px ${el.padding}px`,
      fontFamily: el.fontFamily,
      fontSize: `${el.fontSize}px`,
      fontWeight: el.bold ? '700' : '400',
      fontStyle: el.italic ? 'italic' : 'normal',
      textDecoration: el.underline ? 'underline' : 'none',
      lineHeight: `${el.fontSize * el.lineHeight}px`,
      letterSpacing: `${el.letterSpacing || 0}px`,
      color: el.color,
      textAlign: el.align,
      borderRadius: `${el.radius || 0}px`,
    });
  }

  sync() {
    const { el, ta } = this;
    if (!el || !ta) return;
    const { camera } = this.app;
    const c = camera.toScreen(el.x + el.w / 2, el.y + el.h / 2);
    ta.style.left = `${c.x}px`;
    ta.style.top = `${c.y}px`;
    ta.style.transform = `translate(-50%, -50%) rotate(${el.rotation || 0}rad) scale(${camera.z})`;
    if (ta.style.height !== `${el.h}px`) ta.style.height = `${el.h}px`;
  }

  close() {
    if (!this.el) return;
    const el = this.el;
    delete el.previewMark;
    this.ta.remove();
    this.ta = null;
    this.el = null;
    state.editingId = null;
    if (!(el.text || '').trim()) {
      removeElements([el.id]);
    } else {
      refitText(el);
    }
    commit();
    emit('selection');
    this.app.requestRender();
  }
}

export { textContentHeight };
