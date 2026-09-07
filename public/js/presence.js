// Draws other members' cursors (with name tags) on top of the board in screen space.
export function drawRemoteCursors(ctx, app) {
  const { net, camera } = app;
  if (!net || net.status === 'offline' || !net.cursors.size) return;
  const byId = new Map(net.members.map((m) => [m.id, m]));
  ctx.save();
  ctx.font = '600 11px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  for (const [id, c] of net.cursors) {
    const m = byId.get(id);
    if (!m) continue;
    const p = camera.toScreen(c.x, c.y);
    if (p.x < -40 || p.y < -40 || p.x > app.W + 40 || p.y > app.H + 40) {
      drawEdgeIndicator(ctx, app, p, m.color);
      continue;
    }
    drawArrow(ctx, p.x, p.y, m.color);
    const label = m.name;
    const w = ctx.measureText(label).width + 14;
    const x = p.x + 12;
    const y = p.y + 14;
    ctx.fillStyle = m.color;
    roundRect(ctx, x, y, w, 20, 6);
    ctx.fill();
    ctx.fillStyle = contrastText(m.color);
    ctx.textAlign = 'left';
    ctx.fillText(label, x + 7, y + 10.5);
  }
  ctx.restore();
}

function drawArrow(ctx, x, y, color) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 12, y + 10);
  ctx.lineTo(x + 6.5, y + 10.5);
  ctx.lineTo(x + 4, y + 16);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  ctx.lineWidth = 1.25;
  ctx.stroke();
}

// Member is off-screen: show a small dot pinned to the viewport edge pointing toward them.
function drawEdgeIndicator(ctx, app, p, color) {
  const margin = 14;
  const x = Math.min(app.W - margin, Math.max(margin, p.x));
  const y = Math.min(app.H - margin, Math.max(margin, p.y));
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.fill();
  ctx.globalAlpha = 1;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function contrastText(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.6 ? '#0b0b0d' : '#ffffff';
}
