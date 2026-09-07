import {
  state, on, emit, setHistoryFilter, resetHistory, pruneSelection, persist,
} from './store.js';
import { loadImage } from './images.js';

const SESSION_KEY = 'honama.room';
const NAME_KEY = 'honama.name';
const COLOR_KEY = 'honama.color';

export const MEMBER_COLORS = [
  '#4f8cff', '#f97316', '#22c55e', '#ec4899', '#eab308', '#14b8a6', '#a855f7', '#ef4444', '#06b6d4', '#84cc16',
];

const CURSOR_INTERVAL = 40;
const DRAFT_INTERVAL = 60;
const LIVE_INTERVAL = 45;

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

export function roomLink(code) {
  return `${location.origin}/room/${code}`;
}

export function savedName() {
  return localStorage.getItem(NAME_KEY) || '';
}

export function savedColor() {
  let c = localStorage.getItem(COLOR_KEY);
  if (!c) {
    c = MEMBER_COLORS[Math.floor(Math.random() * MEMBER_COLORS.length)];
    localStorage.setItem(COLOR_KEY, c);
  }
  return c;
}

export function initNet(app) {
  const net = {
    ws: null,
    status: 'offline', // offline | connecting | online | reconnecting
    code: null,
    you: null,
    isHost: false,
    canDraw: true,
    locked: false,
    members: [],
    cursors: new Map(), // id -> { x, y, tool, at }
    drafts: new Map(),  // id -> element being drawn remotely
    lastError: null,
  };
  app.net = net;

  let pending = null;        // { t:'create'|'join', ... } to send once socket opens
  let intentionalClose = false;
  let retry = 0;
  let retryTimer = null;
  let pingTimer = null;

  // Snapshot of what the room last saw from us: id -> serialized element.
  let sent = new Map();
  let sentOrder = [];
  const foreign = new Set(); // element ids last modified remotely (excluded from our undo)
  let liveTimer = null;
  let cursorAt = 0;
  let draftAt = 0;
  let draftSentNull = true;

  const emitNet = () => emit('net');

  /* ---------- history integration ---------- */
  setHistoryFilter((target, current) => {
    if (net.status === 'offline') return target;
    const mine = target.filter((e) => !foreign.has(e.id));
    const theirs = current.filter((e) => foreign.has(e.id));
    // Keep foreign elements at their current stacking position relative to each other, after ours.
    return [...mine, ...theirs];
  });

  /* ---------- outbound diffing ---------- */
  function snapshotFromState() {
    const map = new Map();
    for (const el of state.elements) map.set(el.id, JSON.stringify(el));
    return map;
  }

  function flushLocalChanges() {
    if (!connected() || !canEdit()) return;
    const now = snapshotFromState();
    const ops = [];
    const added = [];
    const updated = [];
    const removed = [];
    for (const [id, json] of now) {
      const prev = sent.get(id);
      if (prev === undefined) added.push(JSON.parse(json));
      else if (prev !== json) updated.push(JSON.parse(json));
    }
    for (const id of sent.keys()) if (!now.has(id)) removed.push(id);
    if (added.length) ops.push({ op: 'add', elements: added });
    if (updated.length) ops.push({ op: 'update', elements: updated });
    if (removed.length) ops.push({ op: 'remove', ids: removed });
    for (const el of [...added, ...updated]) foreign.delete(el.id);

    const order = state.elements.map((e) => e.id);
    const sameOrder = order.length === sentOrder.length && order.every((id, i) => id === sentOrder[i]);
    if (!sameOrder && !added.length && !removed.length) ops.push({ op: 'reorder', ids: order });
    else if (!sameOrder && (added.length || removed.length) && updated.length === 0 && order.length > 1) {
      // Additions/removals may also change stacking (e.g. paste to top); send order so peers match.
      ops.push({ op: 'reorder', ids: order });
    }

    const newAssets = {};
    for (const el of added) {
      if (el.type === 'image' && state.assets[el.assetId] && !sentAssets.has(el.assetId)) {
        newAssets[el.assetId] = { src: state.assets[el.assetId].src };
        sentAssets.add(el.assetId);
      }
    }
    if (Object.keys(newAssets).length) ops.unshift({ op: 'assets', assets: newAssets });

    sent = now;
    sentOrder = order;
    if (ops.length) send({ t: 'ops', ops });
  }
  const sentAssets = new Set();

  function scheduleLive() {
    if (liveTimer) return;
    liveTimer = setTimeout(() => { liveTimer = null; flushLocalChanges(); }, LIVE_INTERVAL);
  }

  on('change', () => {
    if (!connected()) return;
    scheduleLive();
  });
  on('history', () => {
    if (!connected()) return;
    clearTimeout(liveTimer);
    liveTimer = null;
    flushLocalChanges();
  });
  on('board', () => {
    if (!connected() || !canEdit()) return;
    send({ t: 'ops', ops: [{ op: 'board', board: { ...state.board } }] });
  });

  /* ---------- presence ---------- */
  net.sendCursor = (wp) => {
    if (!connected()) return;
    const t = performance.now();
    if (t - cursorAt < CURSOR_INTERVAL) return;
    cursorAt = t;
    send({ t: 'cursor', x: round(wp.x), y: round(wp.y), tool: state.tool });
  };

  net.sendDraft = () => {
    if (!connected() || !canEdit()) return;
    const d = state.draft;
    const t = performance.now();
    if (d) {
      if (t - draftAt < DRAFT_INTERVAL) return;
      draftAt = t;
      draftSentNull = false;
      send({ t: 'ops', ops: [{ op: 'draft', el: d }] });
    } else if (!draftSentNull) {
      draftSentNull = true;
      send({ t: 'ops', ops: [{ op: 'draft', el: null }] });
    }
  };

  /* ---------- inbound ---------- */
  function applyRemoteOps(from, ops) {
    let changed = false;
    for (const op of ops) {
      switch (op.op) {
        case 'draft':
          if (op.el) net.drafts.set(from, op.el); else net.drafts.delete(from);
          app.requestRender();
          break;
        case 'assets':
          for (const [id, a] of Object.entries(op.assets || {})) {
            if (!state.assets[id]) {
              state.assets[id] = { src: a.src, img: null };
              loadImage(a.src).then((img) => { state.assets[id].img = img; app.requestRender(); }).catch(() => {});
            }
          }
          break;
        case 'add':
        case 'update': {
          const idx = new Map(state.elements.map((e, i) => [e.id, i]));
          for (const el of op.elements || []) {
            if (idx.has(el.id)) state.elements[idx.get(el.id)] = el;
            else state.elements.push(el);
            foreign.add(el.id);
            sent.set(el.id, JSON.stringify(el));
          }
          changed = true;
          break;
        }
        case 'remove': {
          const rm = new Set(op.ids || []);
          state.elements = state.elements.filter((e) => !rm.has(e.id));
          for (const id of rm) { sent.delete(id); foreign.delete(id); }
          if (state.activeCandleId && rm.has(state.activeCandleId)) state.activeCandleId = null;
          changed = true;
          break;
        }
        case 'reorder': {
          const byId = new Map(state.elements.map((e) => [e.id, e]));
          const next = (op.ids || []).map((id) => byId.get(id)).filter(Boolean);
          const seen = new Set(op.ids || []);
          for (const e of state.elements) if (!seen.has(e.id)) next.push(e);
          state.elements = next;
          changed = true;
          break;
        }
        case 'replace':
          state.elements = Array.isArray(op.elements) ? op.elements : [];
          for (const e of state.elements) foreign.add(e.id);
          changed = true;
          break;
        case 'board':
          Object.assign(state.board, op.board || {});
          persist('board', true);
          app.requestRender();
          break;
        default:
          break;
      }
    }
    if (changed) {
      sentOrder = state.elements.map((e) => e.id);
      pruneSelection();
      if (app.textEditor.el && !state.elements.some((e) => e.id === state.editingId)) app.textEditor.close();
      emit('change');
      emit('selection');
    }
  }

  async function adoptBoard(board) {
    state.elements = Array.isArray(board.elements) ? board.elements : [];
    state.assets = {};
    for (const [id, a] of Object.entries(board.assets || {})) {
      state.assets[id] = { src: a.src, img: null };
      loadImage(a.src).then((img) => { state.assets[id].img = img; app.requestRender(); }).catch(() => {});
    }
    if (board.board && Object.keys(board.board).length) {
      Object.assign(state.board, board.board);
      persist('board', true);
    }
    foreign.clear();
    for (const e of state.elements) foreign.add(e.id);
    sent = snapshotFromState();
    sentOrder = state.elements.map((e) => e.id);
    state.selection = new Set();
    state.activeCandleId = null;
    resetHistory();
    emit('change');
    emit('selection');
  }

  function handle(msg) {
    switch (msg.t) {
      case 'welcome': {
        const wasCreate = pending?.t === 'create';
        pending = null;
        retry = 0;
        net.status = 'online';
        net.code = msg.code;
        net.you = msg.you;
        net.isHost = !!msg.you.isHost;
        net.locked = !!msg.locked;
        net.members = msg.members || [];
        const me = net.members.find((m) => m.id === msg.you.id);
        net.canDraw = me ? me.canDraw || net.isHost : true;
        net.lastError = null;
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ code: msg.code, token: msg.you.token }));
        if (wasCreate) {
          foreign.clear();
          sent = snapshotFromState();
          sentOrder = state.elements.map((e) => e.id);
          for (const el of state.elements) if (el.type === 'image') sentAssets.add(el.assetId);
        } else {
          adoptBoard(msg.board || {});
          for (const id of Object.keys(msg.board?.assets || {})) sentAssets.add(id);
        }
        if (location.pathname !== `/room/${msg.code}`) history.replaceState(null, '', `/room/${msg.code}`);
        emitNet();
        app.ui.toast(wasCreate ? `Room ${msg.code} created` : `Joined room ${msg.code}`);
        break;
      }
      case 'members': {
        net.members = msg.members || [];
        const me = net.members.find((m) => m.id === net.you?.id);
        if (me) {
          const becameHost = me.isHost && !net.isHost;
          net.isHost = me.isHost;
          const prevDraw = net.canDraw;
          net.canDraw = me.canDraw || me.isHost;
          if (becameHost) app.ui.toast('You are now the host');
          else if (prevDraw !== net.canDraw) app.ui.toast(net.canDraw ? 'You can draw now' : 'You are now view-only');
          if (!net.canDraw) app.cancelDrag?.();
        }
        const ids = new Set(net.members.map((m) => m.id));
        for (const id of [...net.cursors.keys()]) if (!ids.has(id)) net.cursors.delete(id);
        for (const id of [...net.drafts.keys()]) if (!ids.has(id)) net.drafts.delete(id);
        emitNet();
        app.requestRender();
        break;
      }
      case 'ops':
        applyRemoteOps(msg.from, msg.ops || []);
        break;
      case 'cursor':
        net.cursors.set(msg.id, { x: msg.x, y: msg.y, tool: msg.tool, at: performance.now() });
        app.requestRender();
        break;
      case 'lock':
        net.locked = !!msg.locked;
        emitNet();
        break;
      case 'kicked':
        intentionalClose = true;
        cleanup('You were removed from the room');
        break;
      case 'error':
        net.lastError = msg.msg;
        if (msg.code === 'NO_ROOM' || msg.code === 'FULL') {
          intentionalClose = true;
          pending = null;
          // The join form shows this inline; only toast when the dialog is closed.
          cleanup(document.querySelector('#friends-dialog[open]') ? null : msg.msg, true);
          net.lastError = msg.msg;
        } else {
          app.ui.toast(msg.msg);
        }
        emitNet();
        break;
      default:
        break;
    }
  }

  /* ---------- socket lifecycle ---------- */
  function connect() {
    if (net.ws && (net.ws.readyState === WebSocket.OPEN || net.ws.readyState === WebSocket.CONNECTING)) return;
    intentionalClose = false;
    net.status = net.code ? 'reconnecting' : 'connecting';
    emitNet();
    const ws = new WebSocket(wsUrl());
    net.ws = ws;
    ws.addEventListener('open', () => {
      if (pending) ws.send(JSON.stringify(pending));
      clearInterval(pingTimer);
      pingTimer = setInterval(() => send({ t: 'ping' }), 20000);
    });
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      handle(msg);
    });
    ws.addEventListener('close', () => {
      clearInterval(pingTimer);
      net.ws = null;
      if (intentionalClose) return;
      if (!net.code && !pending) { net.status = 'offline'; emitNet(); return; }
      // Reconnect with backoff, re-joining the same room with our token.
      const session = readSession();
      if (session) pending = { t: 'join', code: session.code, token: session.token, name: savedName(), color: savedColor() };
      net.status = 'reconnecting';
      emitNet();
      const delay = Math.min(8000, 500 * 2 ** retry++);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, delay);
    });
    ws.addEventListener('error', () => { /* close handler runs next */ });
  }

  function send(msg) {
    if (net.ws && net.ws.readyState === WebSocket.OPEN) net.ws.send(JSON.stringify(msg));
  }

  function cleanup(toast, keepCode = false) {
    clearTimeout(retryTimer);
    clearInterval(pingTimer);
    clearTimeout(liveTimer);
    liveTimer = null;
    if (net.ws) { try { net.ws.close(); } catch { /* noop */ } }
    net.ws = null;
    net.status = 'offline';
    if (!keepCode) net.code = null;
    net.you = null;
    net.isHost = false;
    net.canDraw = true;
    net.locked = false;
    net.members = [];
    net.cursors.clear();
    net.drafts.clear();
    foreign.clear();
    sentAssets.clear();
    sessionStorage.removeItem(SESSION_KEY);
    if (location.pathname.startsWith('/room/')) history.replaceState(null, '', '/');
    if (toast) app.ui.toast(toast, 2600);
    emitNet();
    app.requestRender();
  }

  function readSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; }
  }

  const connected = () => net.status === 'online' && net.ws && net.ws.readyState === WebSocket.OPEN;
  const canEdit = () => net.status === 'offline' || net.canDraw;
  net.connected = connected;
  net.canEdit = canEdit;

  /* ---------- public API ---------- */
  net.create = (name) => {
    localStorage.setItem(NAME_KEY, name);
    intentionalClose = true;
    if (net.ws) { try { net.ws.close(); } catch { /* noop */ } net.ws = null; }
    net.code = null;
    const board = {
      elements: state.elements,
      assets: Object.fromEntries(Object.entries(state.assets).map(([id, a]) => [id, { src: a.src }])),
      board: { ...state.board },
    };
    pending = { t: 'create', name, color: savedColor(), board };
    connect();
  };

  net.join = (code, name) => {
    localStorage.setItem(NAME_KEY, name);
    intentionalClose = true;
    if (net.ws) { try { net.ws.close(); } catch { /* noop */ } net.ws = null; }
    net.code = null;
    net.lastError = null;
    pending = { t: 'join', code: String(code).toUpperCase().replace(/[^A-Z0-9]/g, ''), name, color: savedColor() };
    connect();
  };

  net.leave = () => {
    intentionalClose = true;
    cleanup('Left the room');
  };

  net.kick = (id) => send({ t: 'kick', id });
  net.setPerm = (id, canDraw) => send({ t: 'perm', id, canDraw });
  net.setLock = (locked) => send({ t: 'lock', locked });
  net.transfer = (id) => send({ t: 'transfer', id });
  net.rename = (name) => { localStorage.setItem(NAME_KEY, name); send({ t: 'rename', name }); };

  // Prune stale cursors so a frozen tab does not leave a ghost pointer.
  setInterval(() => {
    const now = performance.now();
    let changed = false;
    for (const [id, c] of net.cursors) if (now - c.at > 15000) { net.cursors.delete(id); changed = true; }
    if (changed) app.requestRender();
  }, 5000);

  // Auto-resume a room after a reload; a /room/CODE link is handled by the UI (asks for a name).
  const session = readSession();
  const urlCode = location.pathname.match(/^\/room\/([A-Z0-9]{4,10})$/i)?.[1]?.toUpperCase();
  if (session && (!urlCode || urlCode === session.code)) {
    pending = { t: 'join', code: session.code, token: session.token, name: savedName(), color: savedColor() };
    net.code = session.code;
    connect();
  } else if (urlCode) {
    net.pendingInvite = urlCode;
  }

  return net;
}

const round = (v) => Math.round(v * 100) / 100;
