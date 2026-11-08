// Tiny static dev server (no dependencies). Run with: npm run dev
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAudioManifest } from './scripts/audio-manifest.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'site');
const START_PORT = Number(process.env.PORT) || 5173;

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
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.woff2': 'font/woff2',
};

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);

    if (pathname === '/audio-manifest.json') {
      return send(res, 200, JSON.stringify(buildAudioManifest(path.join(ROOT, 'audio'))), MIME['.json']);
    }

    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = path.normalize(path.join(ROOT, pathname));
    if (!file.startsWith(ROOT)) return send(res, 403, 'Forbidden');

    fs.stat(file, (err, stat) => {
      if (err || !stat.isFile()) return send(res, 404, 'Not found');
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      const range = req.headers.range;
      const headers = { 'Content-Type': type, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };

      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        let start = m && m[1] ? parseInt(m[1], 10) : 0;
        let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
        if (m && !m[1] && m[2]) { start = Math.max(0, stat.size - parseInt(m[2], 10)); end = stat.size - 1; }
        if (start > end || start >= stat.size) {
          res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
          return res.end();
        }
        res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
        return fs.createReadStream(file, { start, end }).pipe(res);
      }

      res.writeHead(200, { ...headers, 'Content-Length': stat.size });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  } catch {
    send(res, 400, 'Bad request');
  }
});

function listen(port) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE') listen(port + 1);
    else throw e;
  });
  server.listen(port, () => console.log(`\n  B4SIL running → http://localhost:${port}\n`));
}
listen(START_PORT);
