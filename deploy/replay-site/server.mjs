// Máy chủ tĩnh tối giản (không phụ thuộc gói ngoài): phục vụ index.html + data/*.json, nén gzip và nhớ trong RAM.
import http from 'http';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json' };
const cache = new Map();

http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const rel = p === '/' ? 'index.html' : p.slice(1);
  const ok = rel === 'index.html' || /^data\/[A-Z0-9]+\.json$/.test(rel); // chỉ phục vụ đúng 2 loại file này
  const file = path.join(ROOT, rel);
  if (!ok || !fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
  if (!cache.has(rel)) cache.set(rel, zlib.gzipSync(fs.readFileSync(file)));
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(rel)], 'Content-Encoding': 'gzip', 'Cache-Control': 'public, max-age=3600' });
  res.end(cache.get(rel));
}).listen(process.env.PORT || 3000, () => console.log('Replay site on', process.env.PORT || 3000));
