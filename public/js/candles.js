import { CANDLE_W } from './geometry.js';
import { state, newId, commit, setSelection, setTool } from './store.js';

// Prices are in abstract units (higher = higher price). o/c/h/l per candle.
export const CANDLE_PATTERNS = [
  { id: 'doji', name: 'Doji', candles: [{ o: 5, c: 5, h: 7, l: 3 }] },
  { id: 'hammer', name: 'Hammer', candles: [{ o: 5, c: 5.6, h: 5.8, l: 2 }] },
  { id: 'shooting', name: 'Shooting star', candles: [{ o: 5.6, c: 5, h: 8.6, l: 4.8 }] },
  { id: 'engulf-bull', name: 'Bullish engulfing', candles: [
    { o: 6, c: 4.8, h: 6.4, l: 4.4 }, { o: 4.5, c: 7, h: 7.4, l: 4.2 },
  ] },
  { id: 'engulf-bear', name: 'Bearish engulfing', candles: [
    { o: 4.8, c: 6, h: 6.4, l: 4.4 }, { o: 6.5, c: 4, h: 6.8, l: 3.7 },
  ] },
  { id: 'morning', name: 'Morning star', candles: [
    { o: 7, c: 4.5, h: 7.3, l: 4.2 }, { o: 4.2, c: 3.9, h: 4.6, l: 3.5 }, { o: 4.4, c: 6.9, h: 7.2, l: 4.2 },
  ] },
  { id: 'evening', name: 'Evening star', candles: [
    { o: 4.5, c: 7, h: 7.3, l: 4.2 }, { o: 7.3, c: 7.6, h: 8, l: 7 }, { o: 7.1, c: 4.6, h: 7.3, l: 4.3 },
  ] },
  { id: 'three-soldiers', name: 'Three white soldiers', candles: [
    { o: 3, c: 4.6, h: 4.9, l: 2.8 }, { o: 4.3, c: 6, h: 6.3, l: 4.1 }, { o: 5.7, c: 7.4, h: 7.7, l: 5.5 },
  ] },
  { id: 'three-crows', name: 'Three black crows', candles: [
    { o: 7.4, c: 5.8, h: 7.6, l: 5.5 }, { o: 6.1, c: 4.4, h: 6.3, l: 4.1 }, { o: 4.7, c: 3, h: 4.9, l: 2.8 },
  ] },
  { id: 'hns', name: 'Head & shoulders', candles: [
    { o: 2, c: 3.4, h: 3.7, l: 1.8 }, { o: 3.4, c: 4.8, h: 5.2, l: 3.2 }, { o: 4.8, c: 3.6, h: 5.1, l: 3.3 },
    { o: 3.6, c: 2.8, h: 3.8, l: 2.5 }, { o: 2.8, c: 4.6, h: 4.9, l: 2.6 }, { o: 4.6, c: 6.4, h: 6.9, l: 4.4 },
    { o: 6.4, c: 5, h: 6.7, l: 4.7 }, { o: 5, c: 3.2, h: 5.2, l: 2.9 }, { o: 3.2, c: 4.4, h: 4.7, l: 3 },
    { o: 4.4, c: 5, h: 5.3, l: 4.2 }, { o: 5, c: 3.6, h: 5.2, l: 3.3 }, { o: 3.6, c: 2.2, h: 3.8, l: 1.8 },
  ] },
  { id: 'double-top', name: 'Double top', candles: [
    { o: 2, c: 3.6, h: 3.9, l: 1.8 }, { o: 3.6, c: 5.4, h: 5.9, l: 3.4 }, { o: 5.4, c: 4.2, h: 5.8, l: 4 },
    { o: 4.2, c: 3.2, h: 4.4, l: 3 }, { o: 3.2, c: 4.6, h: 4.9, l: 3 }, { o: 4.6, c: 5.5, h: 5.9, l: 4.4 },
    { o: 5.5, c: 4.1, h: 5.7, l: 3.8 }, { o: 4.1, c: 2.4, h: 4.3, l: 2.1 },
  ] },
];

export function defaultWicks(el) {
  const body = Math.abs(el.open - el.close);
  const wick = Math.max(8, body * 0.35);
  el.high = Math.min(el.open, el.close) - wick;
  el.low = Math.max(el.open, el.close) + wick;
}

export function makeCandle(x, y, style) {
  const el = {
    id: newId(),
    type: 'candle',
    x,
    open: y,
    close: y,
    high: y - 12,
    low: y + 12,
    bullColor: style.bullColor,
    bearColor: style.bearColor,
    wickWidth: style.wickWidth,
    opacity: 1,
  };
  return el;
}

export function insertPattern(app, pattern) {
  const unit = 24;
  const gap = CANDLE_W + 10;
  const center = app.viewCenter();
  const n = pattern.candles.length;
  const startX = center.x - ((n - 1) * gap) / 2;
  const mid = (Math.max(...pattern.candles.map((c) => c.h)) + Math.min(...pattern.candles.map((c) => c.l))) / 2;
  const s = state.style;
  const ids = [];
  pattern.candles.forEach((c, i) => {
    const toY = (price) => center.y - (price - mid) * unit;
    const el = {
      id: newId(),
      type: 'candle',
      x: startX + i * gap,
      open: toY(c.o),
      close: toY(c.c),
      high: toY(c.h),
      low: toY(c.l),
      bullColor: s.bullColor,
      bearColor: s.bearColor,
      wickWidth: s.wickWidth,
      opacity: 1,
    };
    state.elements.push(el);
    ids.push(el.id);
  });
  commit();
  setSelection(ids);
  setTool('select');
}
