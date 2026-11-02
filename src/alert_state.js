/**
 * ALERT_STATE.JS - Trạng thái chống gửi trùng cảnh báo, lưu ra file để khởi động lại không gửi lại.
 * persist=false (dry-run/--single-run) chỉ giữ trong bộ nhớ để lần chạy thử không làm cooldown giả.
 */
import fs from 'fs';
import path from 'path';

export function persistentMap(file, persist = true) {
  let data = {};
  if (persist) { try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* chưa có file */ } }
  return {
    get: (k) => data[k],
    set: (k, v) => {
      data[k] = v;
      if (!persist) return;
      try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data)); } catch { /* shortcut: không ghi được file thì chỉ mất chống trùng sau khi khởi động lại */ }
    }
  };
}
