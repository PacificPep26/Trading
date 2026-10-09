"""Telegram Bot Notifier for 4h Verified Setup Alerts.
Usage:
  1. python -m service.scripts.telegram_notifier get_chat_id
  2. python -m service.scripts.telegram_notifier scan [CHAT_ID]
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from service.backtest.data import Candle
from service.backtest.patterns import STYLES, build

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "8671237237:AAHA_apGlj03UhrIsJfOQgVap4KtyTzNGbE")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "6282967183")

COINS = [
    "BTC", "ETH", "SOL", "HYPE", "XRP", "DOGE", "BNB", "ADA", "AVAX", "LINK",
    "DOT", "LTC", "SUI", "ARB", "OP", "NEAR", "APT", "INJ", "TIA", "PEPE", "WIF"
]
VN = timezone(timedelta(hours=7))


def telegram_api(method: str, params: dict | None = None):
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/{method}"
    headers = {"Content-Type": "application/json"}
    data = json.dumps(params).encode("utf-8") if params else None
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.load(res)


def get_chat_id():
    res = telegram_api("getUpdates")
    results = res.get("result", [])
    if not results:
        print("❌ Chưa thấy tin nhắn mới từ Bot. Sử dụng Chat ID mặc định:", TELEGRAM_CHAT_ID)
        return TELEGRAM_CHAT_ID
    last_msg = results[-1]
    msg = last_msg.get("message") or last_msg.get("channel_post") or {}
    chat = msg.get("chat", {})
    chat_id = chat.get("id")
    first_name = chat.get("first_name", "")
    username = chat.get("username", "")
    print(f"✅ Kết nối thành công! Chat ID: {chat_id} ({first_name} @{username})")
    return str(chat_id)


def send_telegram(message: str, chat_id: str | None = None):
    target_chat = chat_id or TELEGRAM_CHAT_ID
    if not target_chat:
        print("❌ TELEGRAM_CHAT_ID chưa được thiết lập!")
        return

    try:
        return telegram_api("sendMessage", {
            "chat_id": target_chat,
            "text": message,
            "parse_mode": "Markdown",
            "disable_web_page_preview": True,
        })
    except urllib.error.HTTPError as e:
        print(f"⚠️ Gửi tin nhắn Markdown thất bại ({e}), thử lại dạng Plain Text...")
        return telegram_api("sendMessage", {
            "chat_id": target_chat,
            "text": message,
            "disable_web_page_preview": True,
        })


def get_okx_candles(inst_id: str, bar: str, limit: int = 300) -> list[Candle]:
    url = f"https://www.okx.com/api/v5/market/candles?instId={inst_id}&bar={bar}&limit={limit}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as res:
        data = json.load(res)["data"]
    return [Candle(int(r[0]), float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[6])) for r in data[::-1] if r[8] == "1"]


def get_daily_trend(coin: str) -> int:
    try:
        cs = get_okx_candles(f"{coin}-USDT-SWAP", "1Dutc", 300)
        if len(cs) < 60:
            return 0
        ema = cs[0].c
        for c in cs:
            ema += (2 / 51) * (c.c - ema)
        return 1 if cs[-1].c > ema else -1
    except Exception:
        return 0


def scan_and_notify(chat_id: str | None = None):
    target_chat = chat_id or TELEGRAM_CHAT_ID
    if not target_chat:
        target_chat = get_chat_id()
    if not target_chat:
        return

    print(f"🔎 Đang quét 21 coin trên OKX theo quy tắc 4h cho Chat ID {target_chat}...")
    btc_daily = get_daily_trend("BTC")
    alerts = []

    for coin in COINS:
        try:
            cs = get_okx_candles(f"{coin}-USDT-SWAP", "4H", 300)
            if not cs:
                continue
            ctx = build(cs)
            i = len(cs) - 1
            coin_daily = btc_daily if coin == "BTC" else get_daily_trend(coin)

            for style_key in ["bos", "double_top_bottom"]:
                title, det = STYLES[style_key]
                s = det(ctx, i)
                if not s:
                    continue

                side = s["side"]
                entry = s.get("entry") or cs[i].c
                stop = s["stop"]
                risk_pct = abs(entry - stop) / entry

                # Lọc rủi ro 0.4% - 8%
                if not (0.004 <= risk_pct <= 0.08):
                    continue

                # Quy tắc PLAN.md:
                # 1. BOS chỉ LONG
                if style_key == "bos" and side < 0:
                    continue
                # 2. Hai đỉnh/đáy phải thuận xu hướng ngày BTC & Coin
                if style_key == "double_top_bottom" and not (btc_daily == side and coin_daily == side):
                    continue

                side_str = "🟢 LONG" if side > 0 else "🔴 SHORT"
                tp15 = entry + side * 1.5 * abs(entry - stop)
                sl_dist_pct = risk_pct * 100
                suggested_lev = max(1, min(20, int(2.5 / risk_pct)))

                alerts.append(
                    f"🚨 TÍN HIỆU 4H: {coin}-USDT\n"
                    f"• Setup: {title} ({side_str})\n"
                    f"• Giá nến đóng: {cs[i].c:.4f}\n"
                    f"• Entry tham chiếu: {entry:.4f}\n"
                    f"• Dừng lỗ (SL): {stop:.4f} ({sl_dist_pct:.2f}%)\n"
                    f"• Chốt lời 1.5R: {tp15:.4f}\n"
                    f"• Đòn bẩy gợi ý: ~{suggested_lev}x (mất ~$2.5 với vốn $40)\n"
                    f"⏰ Nến đóng lúc: {datetime.fromtimestamp(cs[i].t / 1000, VN).strftime('%H:%M %d/%m')}"
                )
            time.sleep(0.1)
        except Exception as e:
            print(f"Lỗi khi quét {coin}: {e}")

    if alerts:
        header = f"⚡ CẢNH BÁO SETUP 4H HÔM NAY ({len(alerts)} coin) ⚡\n\n"
        full_msg = header + "\n-------------------\n".join(alerts)
        send_telegram(full_msg, str(target_chat))
        print(f"✅ Đã gửi {len(alerts)} cảnh báo qua Telegram cho Chat ID {target_chat}!")
    else:
        msg = "ℹ️ Báo cáo quét 4h: Hiện tại chưa phát hiện setup 4h mới thỏa mãn bộ lọc (BOS LONG hoặc Hai đỉnh/đáy cùng xu hướng ngày)."
        send_telegram(msg, str(target_chat))
        print("ℹ️ Đã gửi tin nhắn báo cáo quét 4h qua Telegram.")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "scan"
    if mode == "get_chat_id":
        get_chat_id()
    else:
        cid = sys.argv[2] if len(sys.argv) > 2 else None
        scan_and_notify(cid)
