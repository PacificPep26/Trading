// Sao chép src/ của bot vào deploy/viewer/src để trang xem dùng đúng engine/radar (chạy lại mỗi khi engine đổi).
import fs from 'fs';
const dst = 'deploy/viewer/src';
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync('src', dst, { recursive: true });
console.log('Đã sao chép src/ ->', dst);
