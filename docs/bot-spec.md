# Đặc tả bot — `v3.0.0`

Cập nhật 2026-10-15. Nguồn chân lý về hành vi. Tổng quan và quy tắc làm việc: [CONTEXT.md](CONTEXT.md). Số liệu: [nhật ký](nhat-ky-nghien-cuu.md).

Bot **chỉ báo tin** Telegram; chủ dự án vào lệnh tay trên MEXC. Dữ liệu OKX, 21 coin (`COINS` trong `lib/telegram-alerts.ts`),
quét mỗi 2 phút; chỉ dùng nến đã đóng. Xu hướng ngày = giá đóng ngày UTC so với EMA50.

## 🎯 ICT quét đỉnh hôm qua → SHORT 1H (`ictSweepShort`)

- Ngày UTC: nến 1H đầu tiên vượt đỉnh hôm qua (PDH) = quét. Trong 24 nến sau, nến **đóng** dưới swing đáy gần nhất (xác nhận trước lúc quét) = ChoCh.
- FVG giảm mới nhất giữa quét và ChoCh (high[j] < low[j−2]) → **Sell Limit giữa FVG**; SL = đỉnh cao nhất từ quét tới ChoCh + 0.1 ATR; TP = đáy hôm qua (PDL); bỏ nếu TP < 1.5R.
- Báo đúng lúc nến ChoCh vừa đóng. Chiều LONG (quét PDL) ≈ 0, khung 15m lỗ → không dùng.

## 📌 Limit dưới đáy 1H → LONG (`restingLimit`)

- Đáy 1H vừa xác nhận (3 nến đóng sau đáy), coin tăng ngày; bỏ nếu nến tạo đáy volume ≥ 2.5x TB 20 nến trước.
- Limit = đáy − 0.5 ATR; SL = Limit − 1.5 ATR; TP = đỉnh 1H trước đáy (bỏ nếu < 1R).
- Mỗi coin 1 lệnh chờ: đáy mới thay Limit cũ chưa khớp (tin ghi "huỷ Limit cũ …"); đã khớp thì không đặt thêm. SHORT không đạt → không dùng.

## Kèo SO Trading 1H (`lib/so-setups.ts`) — chủ dự án chọn báo cả 4, tin ghi kèm số backtest

| Tin | Luật (lời thoại video) | Code live 2025 / 2026 |
|---|---|---|
| 🔁 Hồi đỉnh cũ | cấu trúc thuận chiều, giá hồi về đỉnh cũ vừa bị phá, ≥ 2 nến thử mà đóng giữ được, nến mạnh (thân ≥ 60%) vượt các nến thử → vào; SL dưới nến thử thấp nhất − 0.1 ATR; TP1 2R, TP2 3R | +212$ / +195$ ✅ (đạt chuẩn, mỏng) |
| 👤 Vai–đầu–vai | đầu vượt 2 vai ≥ 0.5 ATR, cổ ngang ≤ 0.3 ATR, vai phải không cao hơn vai trái; đóng qua cổ → vào (nến phá > 1.5 ATR thì Limit ở cổ); SL ngoài vai phải; TP = biên độ đầu–cổ, ≥ 1.5R | +78$ / −24$ |
| 🚀 Phá vỡ sau nén | ≥ 2 đỉnh phẳng, 2 đáy cao dần sát vùng ≤ 2 ATR, nến đóng vượt vùng; SL dưới đáy cao dần; TP 2R; bỏ nếu cản bên trái chắn | −9$ / −13$ (hiếm) |
| 🕯 Chòm râu | 3 nến liền râu từ chối ≥ 50%, cực trị cách nhau ≤ 0.3 ATR, ở đáy/đỉnh 24 nến; SL ngoài râu; TP 2R | +11$ / −6$ |

Cả 2 chiều; vào Market ở giá đóng (paper khớp giá mở nến kế, `market: true`); sổ `data/paper-so-<kiểu>.json`. Bản backtest Python dời SL theo đáy mới cho 🚀 — tin/paper live dùng SL cố định.

## 🔨 Nến high test 4H → lệnh chờ phá (`highTestSetup`, Jason Graystone)

Cấu trúc 4H thuận chiều, nến vừa đóng chạm swing vừa bị phá (≤ 0.2 ATR), râu từ chối ≥ 2 thân và ≥ 60% nến → **buy stop trên đỉnh nến / sell stop dưới đáy**, hiệu lực 3 nến 4H (huỷ nếu chạm SL trước); SL ngoài nến + 0.1 ATR; TP 2R. Cả 2 chiều. Sổ `data/paper-hightest.json`. Code live 2025 +303$ / 2026 +132$.

## Sổ paper 🎯 📌 (`lib/resting-limit.ts`)

Chờ khớp 24 nến 1H; nến chạm Limit là khớp ở giá Limit (hoặc giá mở nếu mở vượt); huỷ nếu giá chạm TP trước khi khớp;
nến khớp mà chạm SL = thua; không tính TP trên nến khớp; tối đa 48 nến; trượt 0.04%.

## 📊 Hai đỉnh/đáy 4H, SL trailing (`isSwingSetupOk` + `lib/swing-4h.ts`)

- Nến 4H vừa đóng qua neckline hai đỉnh/đáy (`analyse`), thuận xu hướng ngày **cả coin lẫn BTC**, volume nến ≥ 2x TB20,
  SL 1.5–6%, 2 nến BTC 1H gần nhất không chạy ngược ≥ 0.7%, |funding| ≤ 0.03%, giá chưa trôi > 0.25%.
- Vào giá hiện tại, **không TP**. Sau mỗi nến 4H đóng: SL = giá đóng tốt nhất từ lúc vào − 3×ATR14 (chỉ siết) → tin `📈 dời SL`; chạm SL → `🚪 đóng` kèm R.

## Tin Telegram

```
📋 KÈO MỚI 16:15
🔴 SHORT SOL · 🎯 ICT Limit 104,5 · quét đỉnh hôm qua
   SL 106,2 (−1.6%) · TP1 102,8 · TP2 100,1 · x6
🟢 LONG NEAR · 📌 Limit 4,933
   SL 4,779 (−3.1%) · TP1 5,087 · TP2 5,181 · x10
🟢 LONG SOL · 📊 4H hai đáy 118,2
   SL 115,0 (−2.7%) · không TP, bot nhắc dời SL · x10
```

- TP1 = 1R: chốt 50% rồi dời SL về giá vào; TP2 = mục tiêu. `x` = đòn bẩy gợi ý min(10, 0.8 ÷ %SL).
- Mỗi coin + chiều tối đa 1 tin kèo / 6 giờ (trừ tin thay Limit). Tin sổ paper: `🧪 … KHỚP / ĐÓNG`, `⌛` hết 24h, `↗️` chạy tới TP trước; 4H: `📈 dời SL`, `🚪 đóng`.
- Tin Mỹ: `⏰` trước giờ CPI/NFP/FOMC ≤ 60 phút, `⚡` khi nến 5m đầu của BTC đóng — chỉ là thông tin (đánh theo nến đầu và lướt vài giây đều lỗ).
- Webhook: gõ tên coin → trạng thái 3 kèo; `thống kê` → 3 sổ paper so với backtest; `theo dõi SUI 1.041 1.029 1.085 btc 82750` / `bỏ theo dõi`.

## Giới hạn

Chỉ 2 năm dữ liệu (Binance futures, lệch nhẹ so với OKX/MEXC); kèo chọn sau khi xem giai đoạn này → thực tế thường thấp hơn.
📌 thắng ~35% (chuỗi thua 5–7 lệnh là bình thường); 4H chỉ ~1–2 lệnh/tháng; ICT chỉ chiều SHORT.
