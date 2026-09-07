import { on } from './store.js';
import { icon } from './icons.js';
import { roomLink, savedName, savedColor } from './net.js';
import { contrastText } from './presence.js';

const $ = (s, r = document) => r.querySelector(s);

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = v;
    else if (k === 'disabled') el.disabled = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

const isComposing = (e) => e.nativeEvent?.isComposing || e.isComposing || e.keyCode === 229;

export function initRoomUI(app) {
  const net = app.net;
  const dialog = $('#friends-dialog');
  const body = $('#friends-body');
  const title = dialog.querySelector('h2');
  const friendsBtn = $('#friends-btn');
  const presence = $('#presence');

  let view = 'home'; // home | create | join | room
  let joinCodePrefill = '';

  app.ui.openRoom = (initialView) => {
    if (initialView) view = initialView;
    else view = net.status === 'offline' ? 'home' : 'room';
    render();
    if (!dialog.open) dialog.showModal();
  };

  /* ---------- views ---------- */
  function render() {
    body.innerHTML = '';
    if (net.status === 'offline' && view === 'room') view = 'home';
    if (net.status === 'offline' && net.lastError) view = 'join';
    if (net.code && net.status !== 'offline') view = 'room';
    else if (net.status === 'connecting') {
      // Socket is opening; keep the create/join form (its button shows progress).
      if (view !== 'create' && view !== 'join') view = 'home';
    }
    title.textContent = view === 'room' ? `Room ${net.code}` : 'Play with friends';
    const v = { home: viewHome, create: viewCreate, join: viewJoin, room: viewRoom }[view] || viewHome;
    body.append(v());
  }

  function viewHome() {
    return h('div', { class: 'room-home' },
      h('p', { class: 'hint' }, 'Draw on the same board in real time. Everyone sees each other\u2019s cursor, and the host manages who can draw.'),
      h('div', { class: 'room-cards' },
        h('button', { class: 'room-card', onclick: () => { view = 'create'; render(); } },
          icon('users', 20), h('strong', {}, 'Create a room'), h('span', {}, 'Host this board and invite others with a code, link or QR.')),
        h('button', { class: 'room-card', onclick: () => { view = 'join'; render(); } },
          icon('link', 20), h('strong', {}, 'Join a room'), h('span', {}, 'Enter a 6-character code you received from a host.')),
      ),
    );
  }

  function nameField() {
    const input = h('input', {
      class: 'text-input', type: 'text', maxlength: 24, placeholder: 'Your display name', value: savedName(), autocomplete: 'nickname', 'aria-label': 'Display name',
    });
    return { row: h('div', { class: 'field' }, h('span', { class: 'label' }, 'Your name'), input), input };
  }

  function viewCreate() {
    const name = nameField();
    const btn = h('button', { class: 'btn primary' }, 'Create room');
    const submit = () => {
      const n = name.input.value.trim();
      if (!n) { name.input.focus(); name.input.classList.add('invalid'); return; }
      btn.disabled = true;
      btn.textContent = 'Creating…';
      net.create(n);
    };
    btn.addEventListener('click', submit);
    name.input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !isComposing(e)) submit(); });
    setTimeout(() => name.input.focus(), 30);
    return h('div', { class: 'room-form' },
      backLink(),
      name.row,
      h('p', { class: 'hint' }, 'Your current board is shared with everyone who joins. You stay the host and can lock the board or manage members at any time.'),
      h('footer', { class: 'dialog-foot' }, btn),
    );
  }

  function viewJoin() {
    const name = nameField();
    const code = h('input', {
      class: 'text-input code-input', type: 'text', maxlength: 6, placeholder: 'ABC123', value: joinCodePrefill, autocapitalize: 'characters', spellcheck: 'false', 'aria-label': 'Room code',
    });
    code.addEventListener('input', () => { code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    const btn = h('button', { class: 'btn primary' }, 'Join room');
    const err = h('p', { class: 'form-error', hidden: true });
    const submit = () => {
      const n = name.input.value.trim();
      const c = code.value.trim();
      if (!n) { name.input.focus(); return; }
      if (c.length < 6) { code.focus(); return; }
      btn.disabled = true;
      btn.textContent = 'Joining…';
      err.hidden = true;
      joinCodePrefill = c;
      net.join(c, n);
    };
    btn.addEventListener('click', submit);
    for (const i of [name.input, code]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !isComposing(e)) submit(); });
    setTimeout(() => (joinCodePrefill ? name.input : code).focus(), 30);
    if (net.lastError) {
      err.textContent = net.lastError;
      err.hidden = false;
      code.classList.add('invalid');
      net.lastError = null;
      joinCodePrefill = '';
    }
    return h('div', { class: 'room-form' },
      backLink(),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Room code'), code),
      name.row,
      err,
      h('footer', { class: 'dialog-foot' }, btn),
    );
  }

  function backLink() {
    return h('button', { class: 'link-btn', onclick: () => { view = 'home'; render(); } }, '\u2190 Back');
  }

  function viewRoom() {
    const link = roomLink(net.code);
    const codeBox = h('button', { class: 'room-code', 'data-tip': 'Copy code', onclick: () => copy(net.code, 'Code copied') },
      ...net.code.split('').map((ch) => h('span', {}, ch)));
    const qr = h('img', { class: 'qr', src: `/qr?text=${encodeURIComponent(link)}`, alt: `QR code to join room ${net.code}`, width: 120, height: 120 });
    const linkRow = h('div', { class: 'link-row' },
      h('input', { class: 'text-input', type: 'text', readonly: true, value: link, 'aria-label': 'Room link', onclick: (e) => e.target.select() }),
      h('button', { class: 'icon-btn', 'data-tip': 'Copy link', 'aria-label': 'Copy link', onclick: () => copy(link, 'Link copied') }, icon('copy', 16)),
      navigator.share && h('button', { class: 'icon-btn', 'data-tip': 'Share', 'aria-label': 'Share link', onclick: () => navigator.share({ title: 'Join my HONAMA board', url: link }).catch(() => {}) }, icon('link', 16)),
    );

    const status = h('div', { class: `conn ${net.status}` },
      h('span', { class: 'dot' }),
      net.status === 'online' ? 'Connected' : net.status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…',
    );

    const lockRow = net.isHost && h('label', { class: 'setting-row compact' },
      h('div', {}, h('div', { class: 'title' }, 'Lock board'), h('div', { class: 'desc' }, 'Only you can draw while locked.')),
      h('button', {
        class: `switch${net.locked ? ' on' : ''}`, role: 'switch', 'aria-checked': net.locked, 'aria-label': 'Lock board',
        onclick: () => net.setLock(!net.locked),
      }),
    );

    return h('div', { class: 'room-view' },
      h('div', { class: 'share-grid' },
        h('div', { class: 'share-left' },
          h('span', { class: 'label' }, 'Room code'),
          codeBox,
          h('span', { class: 'label' }, 'Invite link'),
          linkRow,
          status,
        ),
        h('div', { class: 'share-right' }, qr, h('span', { class: 'label' }, 'Scan to join')),
      ),
      h('div', { class: 'members-head' },
        h('span', { class: 'label' }, `Members (${net.members.filter((m) => m.online).length})`),
        lockRow,
      ),
      memberList(),
      h('footer', { class: 'dialog-foot between' },
        h('button', { class: 'btn danger-ghost', onclick: () => { net.leave(); view = 'home'; render(); } }, net.isHost ? 'Leave room' : 'Leave room'),
        h('button', { class: 'btn primary', onclick: () => dialog.close() }, 'Back to board'),
      ),
    );
  }

  function memberList() {
    const list = h('div', { class: 'member-list' });
    const sorted = [...net.members].sort((a, b) => (b.isHost - a.isHost) || (b.online - a.online) || a.name.localeCompare(b.name));
    for (const m of sorted) {
      const isMe = m.id === net.you?.id;
      const controls = [];
      if (net.isHost && !isMe) {
        controls.push(h('button', {
          class: `chip-btn${m.canDraw ? ' on' : ''}`, 'data-tip': m.canDraw ? 'Can draw — click to make view-only' : 'View-only — click to allow drawing',
          'aria-pressed': m.canDraw, onclick: () => net.setPerm(m.id, !m.canDraw),
        }, icon('pen', 13), m.canDraw ? 'Draw' : 'View'));
        controls.push(h('button', { class: 'icon-btn sm', 'data-tip': 'Make host', 'aria-label': `Make ${m.name} host`, onclick: () => { if (confirm(`Transfer host to ${m.name}?`)) net.transfer(m.id); } }, icon('users', 14)));
        controls.push(h('button', { class: 'icon-btn sm danger', 'data-tip': 'Remove', 'aria-label': `Remove ${m.name}`, onclick: () => { if (confirm(`Remove ${m.name} from the room?`)) net.kick(m.id); } }, icon('x', 14)));
      } else if (!m.isHost) {
        controls.push(h('span', { class: `perm ${m.canDraw ? 'draw' : 'view'}` }, m.canDraw ? 'Draw' : 'View'));
      }
      list.append(h('div', { class: `member${m.online ? '' : ' offline'}` },
        avatar(m),
        h('div', { class: 'member-name' },
          h('span', { class: 'nm' }, m.name, isMe && h('em', {}, ' (you)')),
          m.isHost && h('span', { class: 'tag host' }, 'Host'),
          !m.online && h('span', { class: 'tag' }, 'Away'),
        ),
        h('div', { class: 'member-controls' }, ...controls),
      ));
    }
    return list;
  }

  function avatar(m, size = 26) {
    return h('span', {
      class: 'avatar', style: `--c:${m.color};--fg:${contrastText(m.color)};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px`,
      title: m.name,
    }, m.name.trim().charAt(0).toUpperCase() || '?');
  }

  async function copy(text, msg) {
    try {
      await navigator.clipboard.writeText(text);
      app.ui.toast(msg);
    } catch {
      app.ui.toast('Copy blocked by browser');
    }
  }

  /* ---------- topbar presence strip ---------- */
  function renderPresence() {
    presence.innerHTML = '';
    const inRoom = net.status !== 'offline';
    friendsBtn.classList.toggle('in-room', inRoom);
    friendsBtn.querySelector('span:last-child').textContent = inRoom ? net.code || 'Room' : 'Play with friends';
    friendsBtn.dataset.tip = inRoom ? 'Room settings' : '';
    presence.hidden = !inRoom;
    if (!inRoom) return;
    const online = net.members.filter((m) => m.online);
    const shown = online.slice(0, 5);
    for (const m of shown) presence.append(avatar(m, 24));
    if (online.length > shown.length) presence.append(h('span', { class: 'avatar more' }, `+${online.length - shown.length}`));
    if (net.status === 'reconnecting') presence.append(h('span', { class: 'conn reconnecting mini' }, h('span', { class: 'dot' })));
    if (!net.canDraw) presence.append(h('span', { class: 'tag view-only' }, 'View-only'));
  }

  let lastKey = '';
  on('net', () => {
    renderPresence();
    if (!dialog.open) return;
    // Re-render only on meaningful transitions so typing in the form is never interrupted.
    const key = `${net.status}|${net.code}|${net.isHost}|${net.locked}|${net.canDraw}|${net.members.map((m) => `${m.id}:${m.online}:${m.canDraw}:${m.isHost}:${m.name}`).join(',')}|${net.lastError}`;
    if (key === lastKey) return;
    lastKey = key;
    if (net.status === 'connecting' && !net.lastError) return;
    render();
  });
  renderPresence();

  // Arrived via /room/CODE: prefill the join form and open it right away.
  if (net.pendingInvite) {
    joinCodePrefill = net.pendingInvite;
    net.pendingInvite = null;
    app.ui.openRoom('join');
  }
}
