# Sổ tay kiến thức giao dịch

Mỗi ý tưởng (video, Gemini, chủ dự án) → luật cụ thể → backtest 2025–2026, phí 0 (giao dịch tay), 2.5$/lệnh → kết luận.
Chi tiết số liệu ở [nhật ký nghiên cứu](nhat-ky-nghien-cuu.md). Tóm tắt video chủ dự án thêm: `docs/research/`. Kho phụ đề video thô: `data/knowledge.db` (191 video, `service/scripts/fetch_transcripts.py`).

**Tiêu chuẩn "dùng được"** (chốt trước khi chạy): dương riêng 2025 và 2026 · độ tin cậy t ≥ 2 · hơn vào ngẫu nhiên cùng SL/TP · code live chạy lại ra cùng số (`service/scripts/live_replay_study.mjs`).

**Ý tưởng mới làm theo thứ tự:** tra sổ này → viết luật thành câu đo được (vào ở đâu, SL, TP, khung) → script trong `service/scripts/` → ghi nhật ký → thêm dòng vào đây.

## ✅ Dùng (bot đang báo)

| Ý tưởng | Nguồn | Luật | Kết quả (code live) |
|---|---|---|---|
| ICT quét đỉnh hôm qua → ChoCh → FVG | Video ICT | 1H, SHORT, Limit giữa FVG, SL trên râu quét, TP đáy hôm qua | +0.42R, 2025 +119$ / 2026 +85$ |
| Đặt sẵn Limit đón râu quét đáy | Chủ dự án | 1H, LONG, Limit 0.5 ATR dưới đáy, bỏ đáy volume ≥ 2.5x | +0.063R, +145$ / +172$ |
| Hai đỉnh/đáy thuận xu hướng, gồng lãi | Repo | 4H, volume ≥ 2x, SL trailing 3 ATR, không TP | +1.22R, +45$ / +43$ |

## 🧪 Có dấu hiệu, chưa đủ chắc

| Ý tưởng | Kết quả | Thiếu gì |
|---|---|---|
| Gãy nền mạnh → hồi về nền → SHORT (4H) | +0.17R / +0.04R | t ≈ 1; 1H thì không đạt |
| Vai–đầu–vai ngược → LONG khi phá cổ (4H) | SO Trading video 21 | 2025 +26$ (n=14) / 2026 +11$ (n=16) | mẫu quá nhỏ, tách chiều sau khi xem |
| Chốt 50% ở 1R + dời SL hoà vốn (cách thoát cho 📌) | +9$ / +165$, thắng ~53% | 2025 ≈ hoà |

## ❌ Không dùng (đã kiểm)

| Ý tưởng | Nguồn | Vì sao bỏ |
|---|---|---|
| Phá vỡ vùng nhiều đỉnh sau độ nén | SO Trading video 4, 7 | Quá hiếm (19 lệnh/21 tháng), 2026 −15$ |
| Chờ phe bán thất bại 2–3 lần ở vùng cản + nến xác nhận | SO Trading video 17, 14, 22, 23, 25 | 1H 2025 −187$, kém cả vào ngẫu nhiên; 4H âm cả 2 năm |
| Vai–đầu–vai (phá cổ / test lại cổ) 1H | SO Trading video 21 | ≈ vào ngẫu nhiên; test lại cổ âm cả 2 năm |
| Đánh theo nến đầu sau tin Mỹ (CPI/NFP/FOMC) | Chủ dự án | 162 tin: −0.31R / −0.22R; nến đầu hay đảo chiều |
| Lướt vài giây lúc tin ra | Chủ dự án | Đi tiếp 44–65% (tung đồng xu), lời ≤ trượt giá |
| Mở long + short x30 trước tin | Chủ dự án | Tổng = 0 tới khi 1 bên cháy (cần > 3.3%); BTC −13$ đến −34$ |
| Order flow: CVD, OI/Long-Short, tường sổ lệnh | Gemini | CVD +1/−1 không khác nhau, đảo chiều giữa 2 năm |
| "AI meta-scorer" chấm % thắng | Gemini | Trọng số tự đặt, không học từ dữ liệu |
| Toàn cảnh 5 lớp (1D→15m) | Gemini | −0.02R; điểm ≥ 5 còn tệ hơn (−0.23R) |
| Bắt hồi sau rớt nền 15m (108 biến thể) | Chủ dự án | Tất cả âm năm 2025 |
| Ăn 2 đầu: short đỉnh → long hỗ trợ → short thủng | Chủ dự án | Cả 3 chân ≈ 0 hoặc âm |
| Thắng 65% bằng TP ngắn 0.5–0.7R | Chủ dự án | 2025 −165$ đến −225$ |
| Đánh ngược kèo thua 65% | Chủ dự án | Đảo chiều thì đảo luôn R:R → lỗ |
| FVG 1H → quét 15m | Video SMC | 2025 không hơn vào ngẫu nhiên |
| Bắn tỉa 15m sau kèo 1H | Repo | 5.903 lệnh −0.31R |
| 16 mẫu nến "thắng 70%" | TikTok | Mọi mẫu thắng 40–55% |
| Donchian / phá đỉnh 20 ngày | Gemini | Điểm vào ≈ ngẫu nhiên |
| Funding cực đoan, momentum BTC 15m, BTC dẫn altcoin | Repo | ≈ 0 hoặc âm |

## Bài học chung

- **Nguyên tắc từ SO Trading đáng giữ (không phải luật vào lệnh, không backtest được)**: biết đứng ngoài khi không có kèo; có kế hoạch và khung giờ cố định; không vào lệnh ngược để gỡ / trả thù thị trường; không dời SL khi đang lỗ; kiểm chứng phương pháp bằng thống kê trước khi dùng tiền thật (đúng cách repo này làm).

- **Nhìn lại chart thì thấy rõ, lúc đang chạy thì không**: một ngày thắng (CPI 14/10) không chứng minh được luật; phải đếm trên hàng trăm lần.
- **Tỷ lệ thắng một mình vô nghĩa**: hoà vốn = 1 ÷ (1 + R:R). 1:2 chỉ cần thắng 33%.
- **Đổi TP không tạo lợi thế**, chỉ đổi "thắng nhiều ăn ít" ↔ "thắng ít ăn nhiều". Lợi thế đến từ điểm vào.
- **Khung nhỏ (15m, vài giây) gần như tung đồng xu**; lợi thế nằm ở 1H/4H.
- **Đặt sẵn Limit đón râu** ăn được cú quét; **đuổi theo nến** thì không. Giờ tin Mỹ là lúc 📌 ăn đậm nhất.
- **Backtest Limit phải cẩn thận**: không tính TP trên nến khớp; SL trước nếu cùng nến (lỗi này từng làm 1 kèo trông như +0.13R).
