# Quy trình phân tích cho trợ lý AI

Dùng khi chủ dự án hỏi "check X", "vào được không", "quét coin", hoặc gửi ảnh lệnh. Luật nằm ở [PLAN.md](../PLAN.md) mục "Kết luận hiện tại"; file này là **cách làm từng bước** để mọi câu trả lời theo cùng một luật.

## Bước 1: lấy dữ liệu thật (không đoán từ ảnh)
- Tín hiệu đang có (giống hệt web): `curl -s https://helpvictor.up.railway.app/api/watchlist`. Mỗi setup có `state` (triggered/pending), `side`, `entry`, `stop`, `tp15`, `tp2`, `blocked` (lý do KHÔNG ĐÁNH); kèm `btcDaily` và `daily` của coin.
- Chi tiết một coin: `PYTHONIOENCODING=utf-8 python -m service.scripts.market_brief COIN` (4h: xu hướng, đỉnh/đáy, setup 4h; 1h/15m chỉ để tham khảo).
- Giá tức thời / nến gần nhất: OKX public API `https://www.okx.com/api/v5/market/ticker?instId=COIN-USDT-SWAP`, `/market/candles?instId=...&bar=15m|1H|4H|1Dutc`.
- Ghi rõ giờ dữ liệu (giờ VN) trong câu trả lời.

## Bước 2: áp luật (theo đúng thứ tự)
1. Có setup 4h `triggered` ở nến 4h vừa đóng, `blocked` rỗng, giá chưa chạy quá 0,5R? → **VÀO**.
2. Có setup `pending` → **THEO DÕI**: nói mức kích hoạt và giờ nến 4h đóng kế tiếp (3/7/11/15/19/23h VN).
3. Setup bị `blocked` (BOS SHORT, ngược xu hướng ngày) → **KHÔNG ĐÁNH**, nêu lý do.
4. Không có gì → **ĐỨNG NGOÀI**. Không tìm "lệnh thay thế".

**Không bao giờ đề xuất** các kiểu đã kiểm chứng là lỗ: vùng hồi 1h, Fibonacci, bật hỗ trợ/kháng cự, VWAP, bắt đáy sau cú quét, đu sóng 15m đòn bẩy cao, chốt ngay trên nền cũ, đuổi giá. Nếu chủ dự án hỏi một kiểu chưa có trong bảng kiểm chứng → nói rõ "chưa backtest", đề nghị backtest trước, không đưa giá vào.

## Bước 3: tính cỡ lệnh (luôn kèm theo)
- Cỡ lệnh chủ dự án dùng: **ký quỹ 10$ × x10 = vị thế 100$** (khuyến nghị gốc: rủi ro 2,5% vốn) (vốn hiện tại do chủ dự án báo; mặc định ~40–57$).
- `khoảng SL = |entry − stop| / entry`; `vị thế = rủi ro$ ÷ khoảng SL`; `đòn bẩy = vị thế ÷ ký quỹ dùng`.
- Kiểm tra giá thanh lý (≈ entry × (1 ∓ 1/đòn bẩy)) nằm **xa hơn** SL.
- Nêu số $: mất ở SL, lời ở TP 1,5R (và TP2 nếu có). Coin nhỏ: không quá ~5x; SOL/BTC/ETH tối đa 10–15x, nhưng đòn bẩy thực tế do khoảng SL quyết định.
- Nếu chủ dự án muốn rủi ro lớn hơn (họ từng chọn mất ~28$/lệnh): tôn trọng, nói số $ rõ một lần, không lặp lại cảnh báo.

## Bước 4: trả lời theo mẫu
```
Kết luận: VÀO / THEO DÕI / KHÔNG ĐÁNH / ĐỨNG NGOÀI  (giờ dữ liệu)
Lý do: <tín hiệu 4h nào, xu hướng ngày BTC & coin>
Lệnh: LONG/SHORT COIN · vào … · SL … · TP: lệnh ★ (coin cùng xu hướng ngày) 1R · lệnh thường 0,5R
Cỡ lệnh: vị thế …$ · đòn bẩy …x · mất …$ ở SL · lời …$ ở TP 0,5R · sàn: MEXC nếu coin phí 0%
Kế hoạch hỏng khi: <một điều kiện, ví dụ nến 4h đóng trên …>
```

## Khi chủ dự án đang có lệnh
- Chỉ nêu **mức làm hỏng kế hoạch** và việc cần làm (giữ / dời SL / chốt nửa). Không liệt kê rủi ro ngắn hạn kiểu "giá có thể hồi" (từng làm họ thoát sớm lệnh đúng).
- Gợi ý quản lý đã kiểm chứng: chạm 0,5R → dời SL về giá vào (hoặc chốt nửa), dùng trailing stop OKX.
- Ghi mọi lệnh vào [docs/nhat-ky-giao-dich.md](nhat-ky-giao-dich.md).

## Khi có kết luận mới
Backtest + tìm nguồn ngoài đối chiếu (ghi ở `docs/research/`), rồi sửa **cùng lúc**: PLAN.md, `app/knowledge.tsx`, scanner/`lib/patterns.ts` (giữ khớp Python, chạy `pytest tests/test_parity.py`), file này.
