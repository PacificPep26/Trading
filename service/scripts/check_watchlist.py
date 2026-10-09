import json
import sys
import urllib.request

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

def check():
    url = "https://helpvictor.up.railway.app/api/watchlist"
    data = json.load(urllib.request.urlopen(url))
    print(f"BTC Daily Trend: {data.get('btcDaily')} (1 = TĂNG, -1 = GIẢM)")
    print(f"Tổng số coin quét được: {len(data.get('coins', []))}")
    print("\n--- CÁC COIN CÓ SETUP TRÊN WATCHLIST ---")
    hit = False
    for c in data.get("coins", []):
        setups = c.get("setups", [])
        if setups:
            hit = True
            print(f"👉 {c['coin']} (Giá đóng nến gần nhất: {c['close']}):")
            for s in setups:
                print(f"   • Style: {s.get('style')} | Side: {'LONG' if s.get('side') > 0 else 'SHORT'} | State: {s.get('state')}")
                print(f"   • Mức kích hoạt: {s.get('entry')} | Dừng lỗ: {s.get('stop')}")
                print(f"   • DistancePct: {s.get('distancePct'):.4f} (Cách {abs(s.get('distancePct')*100):.2f}%)")
                print(f"   • Khuyến nghị: {s.get('blocked') or 'ĐẠT TIÊU CHUẨN'}")
    if not hit:
        print("Không có coin nào có setup.")

    # Lấy ticker OP có User-Agent
    req = urllib.request.Request("https://www.okx.com/api/v5/market/ticker?instId=OP-USDT-SWAP", headers={"User-Agent": "Mozilla/5.0"})
    op_tick = json.load(urllib.request.urlopen(req))["data"][0]
    cur = float(op_tick['last'])
    print(f"\n⚡ GIÁ LIVE THỰC TẾ OP HIỆN TẠI (OKX): {cur}")
    print(f"   Mức cần phá để kích hoạt: 0.11814")
    dist = (cur - 0.11814) / cur * 100
    print(f"   Khoảng cách hiện tại tới mức phá vỡ: {dist:+.2f}%")
    if cur > 0.11814:
        print("   => Giá VẪN ĐANG NẰM TRÊN 0.11814 (+3.6% nữa mới tới) -> CHƯA THỦNG ĐÁY -> CHƯA ĐƯỢC VÀO LỆNH!")
    else:
        print("   => Giá đã thủng 0.11814! Chờ nến 4h đóng lúc 15:00 để xác nhận.")

if __name__ == "__main__":
    check()

