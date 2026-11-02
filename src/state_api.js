/**
 * STATE_API.JS - API chỉ-đọc để trang xem (viewer) lấy lệnh đang mở/chờ/lịch sử thật của bot.
 * Bắt buộc token; chỉ GET /api/state. Không bao giờ trả khóa hay cấu hình bí mật.
 */
import http from 'http';
import fs from 'fs';

export function createStateServer(getState, { token }) {
  if (!token) throw new Error('state_api: cần VIEWER_TOKEN, không mở API không có khóa');
  return http.createServer((req, res) => {
    const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    if (req.url.split('?')[0] !== '/api/state') return send(404, { error: 'not found' });
    if (req.method !== 'GET') return send(405, { error: 'method not allowed' });
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'unauthorized' });
    try { send(200, { ...getState(), updatedAt: Date.now() }); } catch (e) { send(500, { error: e.message }); }
  });
}

/** Chạy trên PORT (Railway) nếu có VIEWER_TOKEN. Lắng nghe '::' để nhận cả mạng riêng IPv6 của Railway. */
export function startStateApi(getState) {
  const token = process.env.VIEWER_TOKEN, port = process.env.PORT;
  if (!token || !port) return null;
  const srv = createStateServer(getState, { token });
  srv.listen(Number(port), '::', () => console.log(`[STATE API] Đang lắng nghe cổng ${port} (chỉ đọc, cần token)`));
  return srv;
}

export function readHistory(file, limit = 30) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')).slice(-limit); } catch { return []; }
}
