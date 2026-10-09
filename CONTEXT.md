# Ngữ cảnh cho trợ lý AI

**Đọc [PLAN.md](PLAN.md) trước**, và khi phân tích/đề xuất lệnh thì làm đúng [docs/quy-trinh-phan-tich.md](docs/quy-trinh-phan-tich.md) (chủ dự án, cách đánh hiện tại, những gì đã kiểm chứng, việc đang mở). File này chỉ ghi quy ước kỹ thuật.

## Dự án là gì

Phòng thí nghiệm cá nhân về giao dịch hợp đồng vĩnh cửu crypto (SOL, BTC, ETH, HYPE và ~20 altcoin): backtest các kiểu vào lệnh trên dữ liệu thật, web phân tích trực tiếp, kho kiến thức từ video/sách. Chỉ để nghiên cứu, không phải lời khuyên đầu tư. Không có chức năng đặt lệnh.

## Cấu trúc

- `app/`, `lib/`: web Next.js 16 (tiếng Việt), triển khai trên Railway. Chỉ một trang: `app/live-scanner.tsx` + API `/api/watchlist`, `/api/live/levels`. Đọc `node_modules/next/dist/docs/` trước khi sửa (bản Next này có thay đổi so với trước, xem `AGENTS.md`).
  - `lib/okx.ts`: dữ liệu công khai OKX (không cần key). `lib/patterns.ts`: bản TypeScript của luật 4h đã backtest (BOS, hai đỉnh/hai đáy), phải giữ **giống hệt** bản Python.
  - `lib/*.json`: kết quả thống kê sinh từ script Python (không sửa tay).
- `service/backtest/`: bộ khung backtest + định nghĩa các kiểu vào lệnh (`patterns.py`, `setups.py`, `structure.py`).
- `service/scripts/`: tải dữ liệu, các nghiên cứu, `market_brief.py` (phân tích nhanh trong chat).
- `data/` (không lên git): nến Binance perp 15m/1h 2023–2026, transcript, sách, bảng phí MEXC.

## Quy ước

- Mọi giá và quyết định dựa trên dữ liệu thật có thời điểm; lỗi thì hiện rõ, không bịa giá.
- Backtest: chỉ dùng nến đã đóng, vào lệnh ở giá mở nến sau, dừng lỗ được tính trước khi cùng nến chạm cả hai, luôn tính phí + trượt giá, so với vào lệnh ngẫu nhiên, 2026 là năm kiểm tra.
- Không lưu key/secret trong code hay git (repo GitHub là public). Biến môi trường để trên Railway.
- Trả lời chủ dự án bằng tiếng Việt, dứt khoát, kèm số liệu kiểm chứng; không hứa dự đoán.
