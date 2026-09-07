import { WebSocketServer } from 'ws';
import { randomBytes } from 'node:crypto';

/*
  Relay protocol (JSON over WebSocket, path /ws)

  client -> server
    { t:'create', name, color, board:{elements, assets, board} }
    { t:'join',   code, name, color, token? }
    { t:'ops',    ops:[...] }               board mutations (broadcast + applied to room snapshot)
    { t:'cursor', x, y, tool }              world-space cursor, throttled client-side
    { t:'kick', id } | { t:'perm', id, canDraw } | { t:'lock', locked } | { t:'transfer', id }
    { t:'rename', name } | { t:'ping' }

  server -> client
    { t:'welcome', code, you:{id, token, isHost}, members:[...], board, locked }
    { t:'members', members:[...] }
    { t:'ops', from, ops }
    { t:'cursor', id, x, y, tool }
    { t:'lock', locked }
    { t:'kicked' } | { t:'error', msg } | { t:'pong' }
*/

const ROOM_TTL_MS = 10 * 60 * 1000;
const MAX_MEMBERS = 24;
const MAX_MSG_BYTES = 6 * 1024 * 1024;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const rooms = new Map();

function makeCode() {
  let code = '';
  do {
    code = '';
    const bytes = randomBytes(6);
    for (const b of bytes) code += ALPHABET[b % ALPHABET.length];
  } while (rooms.has(code));
  return code;
}

const token = () => randomBytes(18).toString('base64url');
const uid = () => randomBytes(6).toString('base64url');

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function publicMembers(room) {
  return [...room.members.values()].map((m) => ({
    id: m.id, name: m.name, color: m.color, isHost: m.id === room.hostId, canDraw: m.canDraw, online: !!m.ws,
  }));
}

function broadcast(room, msg, exceptId = null) {
  const raw = JSON.stringify(msg);
  for (const m of room.members.values()) {
    if (m.ws && m.id !== exceptId && m.ws.readyState === m.ws.OPEN) m.ws.send(raw);
  }
}

function applyOps(room, ops) {
  const els = room.board.elements;
  const index = () => new Map(els.map((e, i) => [e.id, i]));
  for (const op of ops) {
    switch (op.op) {
      case 'add': {
        const idx = index();
        for (const el of op.elements || []) {
          if (idx.has(el.id)) els[idx.get(el.id)] = el;
          else els.push(el);
        }
        break;
      }
      case 'update': {
        const idx = index();
        for (const el of op.elements || []) {
          if (idx.has(el.id)) els[idx.get(el.id)] = el;
          else els.push(el);
        }
        break;
      }
      case 'remove': {
        const rm = new Set(op.ids || []);
        room.board.elements = els.filter((e) => !rm.has(e.id));
        break;
      }
      case 'reorder': {
        const order = op.ids || [];
        const byId = new Map(room.board.elements.map((e) => [e.id, e]));
        const next = order.map((id) => byId.get(id)).filter(Boolean);
        const seen = new Set(order);
        for (const e of room.board.elements) if (!seen.has(e.id)) next.push(e);
        room.board.elements = next;
        break;
      }
      case 'replace':
        room.board.elements = Array.isArray(op.elements) ? op.elements : [];
        break;
      case 'assets':
        Object.assign(room.board.assets, op.assets || {});
        break;
      case 'board':
        Object.assign(room.board.board, op.board || {});
        break;
      case 'draft': // transient in-progress stroke; relayed but never stored
      default:
        break;
    }
  }
}

function scheduleCleanup(room) {
  clearTimeout(room.cleanup);
  room.cleanup = setTimeout(() => {
    const anyOnline = [...room.members.values()].some((m) => m.ws);
    if (!anyOnline) rooms.delete(room.code);
  }, ROOM_TTL_MS);
}

function sanitizeName(n) {
  return String(n || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24) || 'Guest';
}
function sanitizeColor(c) {
  return /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#4f8cff';
}

export function createRelay(server) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MSG_BYTES });

  wss.on('connection', (ws) => {
    let room = null;
    let me = null;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    const leave = () => {
      if (!room || !me) return;
      me.ws = null;
      if (room.hostId === me.id) {
        // Host disconnected: promote the longest-present online member.
        const next = [...room.members.values()].find((m) => m.ws && m.id !== me.id);
        if (next) room.hostId = next.id;
      }
      broadcast(room, { t: 'members', members: publicMembers(room) });
      scheduleCleanup(room);
      room = null;
      me = null;
    };

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg.t !== 'string') return;

      if (msg.t === 'ping') return send(ws, { t: 'pong' });

      if (msg.t === 'create') {
        if (room) leave();
        const code = makeCode();
        const board = msg.board && typeof msg.board === 'object' ? msg.board : {};
        room = {
          code,
          hostId: null,
          locked: false,
          members: new Map(),
          board: {
            elements: Array.isArray(board.elements) ? board.elements : [],
            assets: board.assets && typeof board.assets === 'object' ? board.assets : {},
            board: board.board && typeof board.board === 'object' ? board.board : {},
          },
          cleanup: null,
        };
        rooms.set(code, room);
        me = { id: uid(), token: token(), name: sanitizeName(msg.name), color: sanitizeColor(msg.color), canDraw: true, ws };
        room.hostId = me.id;
        room.members.set(me.id, me);
        send(ws, {
          t: 'welcome', code, you: { id: me.id, token: me.token, isHost: true },
          members: publicMembers(room), board: room.board, locked: room.locked,
        });
        return;
      }

      if (msg.t === 'join') {
        if (room) leave();
        const code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const target = rooms.get(code);
        if (!target) return send(ws, { t: 'error', code: 'NO_ROOM', msg: 'Room not found. Check the code and try again.' });

        // Reconnect with a previous token keeps identity, host role and permissions.
        const existing = msg.token && [...target.members.values()].find((m) => m.token === msg.token);
        if (existing) {
          if (existing.ws && existing.ws !== ws) { try { existing.ws.close(4001, 'replaced'); } catch { /* noop */ } }
          me = existing;
          me.ws = ws;
          me.name = sanitizeName(msg.name || me.name);
        } else {
          const online = [...target.members.values()].filter((m) => m.ws).length;
          if (online >= MAX_MEMBERS) return send(ws, { t: 'error', code: 'FULL', msg: 'This room is full.' });
          me = { id: uid(), token: token(), name: sanitizeName(msg.name), color: sanitizeColor(msg.color), canDraw: !target.locked, ws };
          target.members.set(me.id, me);
        }
        room = target;
        clearTimeout(room.cleanup);
        send(ws, {
          t: 'welcome', code: room.code, you: { id: me.id, token: me.token, isHost: room.hostId === me.id },
          members: publicMembers(room), board: room.board, locked: room.locked,
        });
        broadcast(room, { t: 'members', members: publicMembers(room) }, me.id);
        return;
      }

      if (!room || !me) return;
      const isHost = room.hostId === me.id;

      switch (msg.t) {
        case 'ops': {
          if (!Array.isArray(msg.ops) || !msg.ops.length) return;
          if (!me.canDraw && !isHost) return send(ws, { t: 'error', code: 'READONLY', msg: 'You are view-only in this room.' });
          applyOps(room, msg.ops);
          broadcast(room, { t: 'ops', from: me.id, ops: msg.ops }, me.id);
          return;
        }
        case 'cursor':
          if (typeof msg.x !== 'number' || typeof msg.y !== 'number') return;
          broadcast(room, { t: 'cursor', id: me.id, x: msg.x, y: msg.y, tool: String(msg.tool || '').slice(0, 16) }, me.id);
          return;
        case 'rename':
          me.name = sanitizeName(msg.name);
          broadcast(room, { t: 'members', members: publicMembers(room) });
          return;
        case 'kick': {
          if (!isHost) return;
          const target = room.members.get(msg.id);
          if (!target || target.id === me.id) return;
          if (target.ws) { send(target.ws, { t: 'kicked' }); try { target.ws.close(4000, 'kicked'); } catch { /* noop */ } }
          room.members.delete(target.id);
          broadcast(room, { t: 'members', members: publicMembers(room) });
          return;
        }
        case 'perm': {
          if (!isHost) return;
          const target = room.members.get(msg.id);
          if (!target || target.id === me.id) return;
          target.canDraw = !!msg.canDraw;
          broadcast(room, { t: 'members', members: publicMembers(room) });
          return;
        }
        case 'lock': {
          if (!isHost) return;
          room.locked = !!msg.locked;
          for (const m of room.members.values()) if (m.id !== room.hostId) m.canDraw = !room.locked;
          broadcast(room, { t: 'lock', locked: room.locked });
          broadcast(room, { t: 'members', members: publicMembers(room) });
          return;
        }
        case 'transfer': {
          if (!isHost) return;
          const target = room.members.get(msg.id);
          if (!target || !target.ws) return;
          room.hostId = target.id;
          target.canDraw = true;
          broadcast(room, { t: 'members', members: publicMembers(room) });
          return;
        }
        default:
          return;
      }
    });

    ws.on('close', leave);
    ws.on('error', leave);
  });

  // Heartbeat: drop dead sockets so member lists stay accurate.
  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 25000);
  wss.on('close', () => clearInterval(beat));

  return wss;
}
