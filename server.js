import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { createRelay } from './relay.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);

  if (pathname === '/qr') {
    const text = (url.searchParams.get('text') || '').slice(0, 512);
    if (!text) { res.writeHead(400); return res.end('missing text'); }
    try {
      const svg = await QRCode.toString(text, {
        type: 'svg', margin: 1, width: 240,
        color: { dark: '#ececef', light: '#00000000' },
      });
      res.writeHead(200, { ...BASE_HEADERS, 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' });
      return res.end(svg);
    } catch {
      res.writeHead(500);
      return res.end('qr failed');
    }
  }

  if (pathname === '/' || pathname.startsWith('/room/')) pathname = '/index.html';

  const filePath = path.normalize(path.join(PUBLIC, pathname));
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      ...BASE_HEADERS,
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ['.html', '.css', '.js', '.mjs'].includes(ext) ? 'no-cache' : 'public, max-age=86400',
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

createRelay(server);

server.listen(PORT, () => {
  console.log(`HONAMA running on http://localhost:${PORT}`);
});
